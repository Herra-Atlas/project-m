use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::runtime::{Builder, Runtime};

use crate::macro_data::{MacroData, Node};
use crate::nodes;

fn push_value(out: &mut String, v: &Value) {
    match v {
        Value::String(s) => out.push_str(s),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(f) = n.as_f64() {
                out.push_str(&f.to_string());
            }
        }
        Value::Bool(b) => out.push_str(&b.to_string()),
        _ => {}
    }
}

/// Shared execution context for a running macro.
///
/// `Engine` is `Clone`: every field is either an `Arc` (cheap clone) or
/// trivially cloneable. Cloneability lets us hand a copy to every parallel
/// task — they all share the same outputs/variables/stop-flag behind
/// `Arc<Mutex<...>>` / `Arc<Atomic...>`. That makes it safe to spawn many
/// children concurrently from `execute_node`.
#[derive(Clone)]
pub struct Engine {
    pub(crate) nodes: Arc<Vec<Node>>,
    pub(crate) connections: Arc<Vec<crate::macro_data::Connection>>,
    pub(crate) variables: Arc<Mutex<HashMap<String, Value>>>,
    pub(crate) outputs: Arc<Mutex<HashMap<String, Value>>>,
    pub(crate) stop_requested: Arc<AtomicBool>,
    pub(crate) break_signal: Arc<AtomicUsize>,
    pub runtime: Arc<Runtime>,
    pub app_handle: AppHandle,
}

impl Engine {
    pub fn new(stop_requested: Arc<AtomicBool>, app_handle: AppHandle) -> Self {
        // Multi-threaded runtime is required because `execute_node` and
        // `loop_node` use `tokio::task::JoinSet::spawn` to run children in
        // parallel. `JoinSet` delegates to `tokio::spawn`, which panics on
        // a current-thread runtime because it requires `Send` futures.
        let runtime = Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .expect("failed to build tokio multi-thread runtime");
        Self {
            nodes: Arc::new(Vec::new()),
            connections: Arc::new(Vec::new()),
            variables: Arc::new(Mutex::new(HashMap::new())),
            outputs: Arc::new(Mutex::new(HashMap::new())),
            stop_requested,
            break_signal: Arc::new(AtomicUsize::new(0)),
            runtime: Arc::new(runtime),
            app_handle,
        }
    }

    pub fn load(&mut self, data: MacroData) {
        self.nodes = Arc::new(data.nodes);
        self.connections = Arc::new(data.connections);
        if let Ok(mut vars) = self.variables.lock() {
            vars.clear();
        }
        if let Ok(mut outs) = self.outputs.lock() {
            outs.clear();
        }
        self.break_signal.store(0, Ordering::SeqCst);

        // Pre-load variables defined in `variable` nodes so they are
        // available to the engine from the very first node, even if the
        // variable node itself is not connected in the execution flow.
        if let Ok(mut vars) = self.variables.lock() {
            for n in self.nodes.iter() {
                if n.node_type == "variable" {
                    let name = n
                        .fields
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if name.is_empty() {
                        continue;
                    }
                    let value = n
                        .fields
                        .get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    vars.insert(name, serde_json::json!(value));
                }
            }
        }

        log::info!(
            "Loaded macro: {} nodes, {} connections, {} pre-loaded variables",
            self.nodes.len(),
            self.connections.len(),
            self.variables.lock().map(|v| v.len()).unwrap_or(0)
        );
        for n in self.nodes.iter() {
            log::info!("  Node: id={}, type={}, fields={}", n.id, n.node_type, n.fields);
        }
    }

    pub fn outgoing(&self, node_id: &str) -> Vec<String> {
        self.connections
            .iter()
            .filter(|c| c.from == node_id)
            .map(|c| c.to.clone())
            .collect()
    }

    pub fn get_node(&self, node_id: &str) -> Option<Node> {
        self.nodes.iter().find(|n| n.id == node_id).cloned()
    }

    /// Resolve a single `$name` or `$nodeId.outputName` reference to its
    /// string form. Used by `if`/`while` to evaluate their `variable` field.
    pub fn resolve_reference(&self, input: &str) -> Option<String> {
        let resolved = self.substitute(input);
        if resolved == input {
            None
        } else {
            Some(resolved)
        }
    }

    /// Write a node-scoped output. The key is stored as `{nodeId}.{name}`
    /// so `$nodeId.name` references resolve unambiguously.
    pub fn set_output(&self, node_id: &str, name: &str, value: Value) {
        if let Ok(mut outs) = self.outputs.lock() {
            outs.insert(format!("{}.{}", node_id, name), value);
        }
    }

    /// Read a node-scoped output.
    pub fn get_output(&self, node_id: &str, name: &str) -> Option<Value> {
        self.outputs
            .lock()
            .ok()
            .and_then(|o| o.get(&format!("{}.{}", node_id, name)).cloned())
    }

    /// Substitute $name and $nodeId.outputName references in a string.
    ///
    /// - `$name` looks up `name` in flat variables first, then in flat outputs.
    /// - `$nodeId.outputName` looks up `{nodeId}.{outputName}` in outputs,
    ///   so a log node can reference a specific prior node without clashing
    ///   with whatever other node ran most recently.
    pub fn substitute(&self, input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut chars = input.chars().peekable();
        while let Some(c) = chars.next() {
            if c != '$' {
                out.push(c);
                continue;
            }
            let first = chars.peek().copied();
            if !matches!(first, Some(ch) if ch.is_ascii_alphabetic() || ch == '_') {
                out.push('$');
                continue;
            }
            let mut ident = String::new();
            while let Some(&nc) = chars.peek() {
                if nc.is_ascii_alphanumeric() || nc == '_' || nc == '-' {
                    ident.push(nc);
                    chars.next();
                } else {
                    break;
                }
            }
            let mut field: Option<String> = None;
            if chars.peek().copied() == Some('.') {
                chars.next();
                let mut f = String::new();
                while let Some(&nc) = chars.peek() {
                    if nc.is_ascii_alphanumeric() || nc == '_' {
                        f.push(nc);
                        chars.next();
                    } else {
                        break;
                    }
                }
                if !f.is_empty() {
                    field = Some(f);
                }
            }
            let key: Option<String> = match &field {
                Some(f) => Some(format!("{}.{}", ident, f)),
                None => None,
            };
            let value: Option<String> = if let Some(k) = key {
                self.outputs
                    .lock()
                    .ok()
                    .and_then(|o| o.get(&k).map(|v| push_to_string(v)))
            } else {
                let v = self
                    .variables
                    .lock()
                    .ok()
                    .and_then(|vars| vars.get(&ident).map(|v| push_to_string(v)));
                if v.is_some() {
                    v
                } else {
                    self.outputs
                        .lock()
                        .ok()
                        .and_then(|o| o.get(&ident).map(|v| push_to_string(v)))
                }
            };
            if let Some(v) = value {
                out.push_str(&v);
            } else {
                out.push('$');
                out.push_str(&ident);
                if let Some(f) = field {
                    out.push('.');
                    out.push_str(&f);
                }
            }
        }
        out
    }

    /// Walk a JSON value, substituting $name in every string leaf.
    pub fn substitute_value(&self, value: &mut Value) {
        match value {
            Value::String(s) => {
                if s.contains('$') {
                    *s = self.substitute(s);
                }
            }
            Value::Object(map) => {
                for v in map.values_mut() {
                    self.substitute_value(v);
                }
            }
            Value::Array(arr) => {
                for v in arr.iter_mut() {
                    self.substitute_value(v);
                }
            }
            _ => {}
        }
    }

    pub fn run(&mut self) -> Result<(), String> {
        log::info!("Engine run started");
        let start_id = self
            .nodes
            .iter()
            .find(|n| n.node_type == "manual-start")
            .map(|n| n.id.clone())
            .ok_or("No manual-start node found")?;

        log::info!("Found manual-start node: {}", start_id);

        let engine = self.clone();
        let runtime = self.runtime.clone();
        runtime.block_on(async move {
            execute_node(engine, &start_id, &mut Vec::new()).await
        })?;
        log::info!("Engine run completed");
        if let Ok(mut outs) = self.outputs.lock() {
            outs.clear();
        }
        Ok(())
    }
}

fn push_to_string(v: &Value) -> String {
    let mut s = String::new();
    push_value(&mut s, v);
    s
}

/// Execute a single node and then run all of its children IN PARALLEL.
///
/// Previously children were awaited sequentially (`for next_id in next_ids {
/// execute_node(...).await?; }`). With this change, when a node has multiple
/// outgoing connections every branch runs concurrently on the tokio runtime.
/// This is what the user needs for "loop body has a mouse-click and a
/// hotkey-trigger — both should be active at the same time".
///
/// `path` is per-branch cycle detection: each parallel task carries its own
/// stack of visited nodes. Cross-branch cycles are not detected (rare in
/// practice).
pub(crate) fn execute_node<'a>(
    engine: Engine,
    node_id: &'a str,
    path: &'a mut Vec<String>,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if engine.stop_requested.load(Ordering::SeqCst) {
            log::info!("Stop requested, aborting");
            return Ok(());
        }
        if path.contains(&node_id.to_string()) {
            log::warn!("Cycle detected at node {}, skipping", node_id);
            return Ok(());
        }
        path.push(node_id.to_string());

        let node = match engine.get_node(node_id) {
            Some(n) => n,
            None => {
                log::warn!("Node {} not found", node_id);
                path.pop();
                return Ok(());
            }
        };

        log::info!("Executing node: {} (type: {})", node_id, node.node_type);
        let _ = engine.app_handle.emit("node-executing", json!({ "nodeId": node_id }));

        let mut resolved = node.clone();
        if matches!(resolved.node_type.as_str(), "if" | "while") {
            if let (Some(original), Some(map)) = (node.fields.get("variable"), resolved.fields.as_object_mut()) {
                map.insert("variable".to_string(), original.clone());
            }
        }
        engine.substitute_value(&mut resolved.fields);

        let next_ids = nodes::run_node(&resolved, engine.clone()).await?;
        log::info!("Node {} completed, next: {:?}", node_id, next_ids);

        let outputs_snapshot: Vec<(String, Value)> = engine
            .outputs
            .lock()
            .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();
        let _ = engine.app_handle.emit(
            "node-outputs",
            json!({
                "nodeId": node_id,
                "outputs": outputs_snapshot,
            }),
        );

        if !next_ids.is_empty() {
            let mut joinset: tokio::task::JoinSet<()> = tokio::task::JoinSet::new();
            for next_id in next_ids {
                let eng = engine.clone();
                joinset.spawn(async move {
                    // Each parallel branch gets its own path vec.
                    let mut local_path: Vec<String> = Vec::new();
                    if let Err(e) = execute_node(eng, &next_id, &mut local_path).await {
                        log::error!("Parallel child error: {}", e);
                    }
                });
            }
            // Wait for all children to complete. Bail early if stop is set so
            // we don't keep expensive branches running after the user clicked
            // Stop.
            while let Some(res) = joinset.join_next().await {
                if let Err(e) = res {
                    log::error!("Join error: {}", e);
                }
                if engine.stop_requested.load(Ordering::SeqCst) {
                    joinset.abort_all();
                    break;
                }
            }
        }

        path.pop();
        Ok(())
    })
}