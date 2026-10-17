use std::net::SocketAddr;
use std::thread::JoinHandle;
use tokio::sync::watch;
use tauri::Manager;

use axum::{Json, Router, routing::post};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};

pub const MCP_PORT: u16 = 43126;
use crate::macros_fs;

/// Known node types and the fields each one reads at runtime. Served via the
/// `node_help` tool so MCP clients can build valid macros without the source.
const NODE_HELP: &str = r##"Node types and their `fields` keys:
- manual-start: {} (no fields) — every macro needs at least one; the only entry point.
- hotkey-trigger: { key } — single char ("e"), digit ("6"), or named key: space, enter, esc, tab, shift, ctrl, alt, backspace, delete, home, end, pageup, pagedown, f1-f12, arrows (up/down/left/right). Bad key -> status "error" but flow continues.
- timer-trigger: { mode: "interval"|"clock", intervalMs, clockTime: "HH:MM" }
- if: { variable, operator: "equals"|"not equals"|"contains"|"greater than"|"less than", value, pollMs } — routes out-connection 1 on match, out-connection 2 on no match.
- while: same fields as if — loops body until condition fails; status "exited" when done.
- pixel-scan: { fromX, fromY, toX, toY, color: "#RRGGBB", rTol, gTol, bTol, centerOnXVar, centerOnYVar } — matches out-1 on found, out-2 on not found; sets whereX/whereY/centerX/centerY outputs.
- pixel-watch: same as pixel-scan plus { timeoutMs } — waits until the pixel appears or times out.
- logic-gate: { mode: "and"|"or" }
- key-press: { key: "a"|"enter"|"space"|named|"f1-f12"|arrows }
- key-hold: { key, durationMs }
- ipc-command: { command } — sends to the AHK IPC listener.
- mouse-move: { x, y }
- mouse-click: { button: "left"|"right"|"middle", count, delayMs }
- mouse-drag: { fromX, fromY, toX, toY, button, durationMs }
- mouse-hold-sweep: same as mouse-drag plus { pauseMs }
- loop: { intervalMs, loopCount } (loopCount 0 = infinite) — first out-connection is the body, second is after the loop. Use `break` to exit early.
- break: {} (no fields)
- variable: { name, value } — referenced elsewhere as $name.
- delay: { ms }
- pause: {} — current branch blocks until force-stop.
- log: { message } — supports $var substitution.
- script: { code: JS source, timeoutMs, heapMb } — sets `result` output.

Connections reference node `id`s: {"from": "<id>", "to": "<id>"}.
Variable substitution: $name or $nodeId.outputName.

A minimal valid macro needs a manual-start node and one outgoing connection from it."##;

fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("settings.json"))
}

/// Read the persisted `mcpEnabled` setting. Defaults to `true` so the server
/// is on unless the user (or an existing install) says otherwise.
fn mcp_enabled(app: &AppHandle) -> bool {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|settings| {
            settings
                .get("mcpEnabled")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(true)
}

fn write_mcp_enabled(app: &AppHandle, enabled: bool) {
    let Some(path) = settings_path(app) else {
        return;
    };
    let mut settings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    settings.insert("mcpEnabled".into(), Value::Bool(enabled));
    if let Ok(payload) = serde_json::to_string_pretty(&Value::Object(settings)) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&path, payload);
    }
}

static MCP_HANDLE: std::sync::Mutex<Option<(JoinHandle<()>, watch::Sender<()>)>> =
    std::sync::Mutex::new(None);

pub fn spawn(app: AppHandle) {
    if !mcp_enabled(&app) {
        log::info!("[mcp] disabled by setting, not starting");
        return;
    }
    spawn_server(app);
}

pub fn start(app: AppHandle) -> Result<(), String> {
    {
        let guard = MCP_HANDLE.lock().map_err(|e| e.to_string())?;
        if guard
            .as_ref()
            .map(|(h, _)| !h.is_finished())
            .unwrap_or(false)
        {
            return Err("MCP server already running".into());
        }
    }
    spawn_server(app);
    Ok(())
}

pub fn stop(app: AppHandle) -> Result<(), String> {
    write_mcp_enabled(&app, false);
    let mut guard = MCP_HANDLE.lock().map_err(|e| e.to_string())?;
    if let Some((_, tx)) = guard.take() {
        let _ = tx.send(()); // graceful shutdown of axum::serve
    }
    Ok(())
}

pub fn is_running() -> bool {
    match MCP_HANDLE.lock() {
        Ok(guard) => guard
            .as_ref()
            .map(|(h, _)| !h.is_finished())
            .unwrap_or(false),
        Err(_) => false,
    }
}
fn spawn_server(app: AppHandle) {
    let (shutdown_tx, mut shutdown_rx) = watch::channel(());
    let handle = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("mcp tokio runtime");
        runtime.block_on(async move {
            let addr = SocketAddr::from(([127, 0, 0, 1], MCP_PORT));
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    log::warn!("[mcp] failed to bind {addr}: {e}");
                    return;
                }
            };
            log::info!("[mcp] listening on http://{addr}/mcp");
            let router = Router::new().route(
                "/mcp",
                    post(move |body: Option<Json<Value>>| {
                    let app = app.clone();
                    async move {
                        let payload =
                            dispatch(app, body.map(|Json(v)| v).unwrap_or(json!({})));
                        axum::Json(payload)
                    }
                }),
            );
            if let Err(e) = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.changed().await;
                    log::info!("[mcp] shutting down");
                })
                .await
            {
                log::warn!("[mcp] serve error: {e}");
            }
        });
    });
    if let Ok(mut guard) = MCP_HANDLE.lock() {
        *guard = Some((handle, shutdown_tx));
    }
}

/// Tell the UI that a macro changed on disk via MCP so it can refresh its
/// library without a manual reload.
fn notify_macros_changed(app: &AppHandle, id: &str, action: &str) {
    if let Err(e) = app.emit(
        "macros-changed",
        json!({"id": id, "action": action}),
    ) {
        log::warn!("[mcp] failed to emit macros-changed: {e}");
    }
}

fn dispatch(app: AppHandle, req: Value) -> Value {
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let result = match req.get("method").and_then(|m| m.as_str()) {
        Some("initialize") => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "project-m", "version": "0.1.0"}
        })),
        Some("ping") => Ok(json!({})),
        Some("tools/list") => Ok(json!({"tools": tools_json()})),
        Some("tools/call") => call_tool(app, req.get("params").cloned().unwrap_or(json!({}))),
        _ => Err(json!({"code": -32601, "message": "method not found"})),
    };
    match result {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err(err) => json!({"jsonrpc": "2.0", "id": id, "error": err}),
    }
}

fn call_tool(app: AppHandle, params: Value) -> Result<Value, Value> {
    let name = params
        .get("name")
        .and_then(|n| n.as_str())
        .ok_or(json!({"code": -32602, "message": "missing tool name"}))?;
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let field = |args: &Value, key: &str| -> Result<String, Value> {
        args.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or(json!({"code": -32602, "message": format!("missing argument '{key}'")}))
    };
    let json_field = |args: &Value, key: &str| -> Result<Value, Value> {
        args.get(key)
            .cloned()
            .ok_or(json!({"code": -32602, "message": format!("missing argument '{key}'")}))
    };
    let text = |body: String| json!({"content": [{"type": "text", "text": body}]});
    let listing = |items: Vec<Value>| {
        json!({"content": [{"type": "text", "text": serde_json::to_string(&items).unwrap_or_default()}]})
    };

    match name {
        "list_macros" => {
            let items = macros_fs::list_macros(&app)
                .map_err(|e| json!({"code": -32603, "message": e}))?
                .into_iter()
                .filter_map(|raw| serde_json::from_str::<Value>(raw.as_str()).ok())
                .map(|m| {
                    json!({
                        "id": m.get("id").and_then(|v| v.as_str()).unwrap_or_default(),
                        "title": m.get("title").and_then(|v| v.as_str()).unwrap_or_default(),
                        "description": m.get("description").and_then(|v| v.as_str()).unwrap_or_default(),
                    })
                })
                .collect();
            Ok(listing(items))
        }
        "get_macro" => {
            let id = field(&args, "id")?;
            macros_fs::read_macro(&app, &id)
                .map_err(|e| json!({"code": -32603, "message": e}))?
                .map(|raw| text(raw))
                .ok_or_else(|| json!({"code": -32602, "message": format!("macro '{id}' not found")}))
        }
        "create_macro" => {
            let id = field(&args, "id")?;
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or(&id);
            let body = json!({
                "id": id,
                "title": title,
                "description": args.get("description").and_then(|v| v.as_str()).unwrap_or_default(),
                "nodes": [],
                "connections": [],
            });
            macros_fs::write_macro(&app, &id, &serde_json::to_string_pretty(&body).unwrap_or_default())
                .map_err(|e| json!({"code": -32603, "message": e}))?;
            notify_macros_changed(&app, &id, "created");
            Ok(listing(vec![json!({"id": id})]))
        }
        "save_macro" => {
            let id = field(&args, "id")?;
            let body = json_field(&args, "macro")?;
            // Keep the envelope's id in sync with the requested id so the
            // folder name and file content never drift apart.
            let mut obj = body
                .as_object()
                .cloned()
                .ok_or(json!({"code": -32602, "message": "'macro' must be a JSON object with 'id', 'nodes' and 'connections'"}))?;
            obj.insert("id".into(), Value::String(id.clone()));
            let payload = serde_json::to_string_pretty(&Value::Object(obj)).unwrap_or_default();
            macros_fs::write_macro(&app, &id, &payload)
                .map_err(|e| json!({"code": -32603, "message": e}))?;
            notify_macros_changed(&app, &id, "saved");
            Ok(listing(vec![json!({"id": id, "saved": true})]))
        }
        "delete_macro" => {
            let id = field(&args, "id")?;
            macros_fs::delete_macro(&app, &id).map_err(|e| json!({"code": -32603, "message": e}))?;
            notify_macros_changed(&app, &id, "deleted");
            Ok(listing(vec![json!({"id": id, "deleted": true})]))
        }
        "validate_macro" => {
            let id = field(&args, "id")?;
            let raw = macros_fs::read_macro(&app, &id)
                .map_err(|e| json!({"code": -32603, "message": e}))?
                .ok_or_else(|| json!({"code": -32602, "message": format!("macro '{id}' not found")}))?;
            let m: Value = serde_json::from_str(&raw)
                .map_err(|e| json!({"code": -32602, "message": format!("invalid macro JSON: {e}")}))?;
            Ok(text(serde_json::to_string(&validate(&m)).unwrap_or_default()))
        }
        "node_help" => Ok(text(NODE_HELP.to_string())),
        _ => Err(json!({"code": -32602, "message": format!("unknown tool '{name}'")})),
    }
}

fn validate(m: &Value) -> Value {
    let nodes = m.get("nodes").and_then(|n| n.as_array());
    let node_vals = nodes.cloned().unwrap_or_default();
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    if nodes.is_none() {
        errors.push("missing 'nodes' array".into());
    }
    if m.get("connections").and_then(|c| c.as_array()).is_none() {
        errors.push("missing 'connections' array".into());
    }
    let ids: Vec<&str> = node_vals
        .iter()
        .filter_map(|n| n.get("id").and_then(|v| v.as_str()))
        .collect();
    for n in &node_vals {
        let id = n.get("id").and_then(|v| v.as_str()).unwrap_or("<no id>");
        match n.get("type").and_then(|v| v.as_str()) {
            Some(t) => {
                let known = [
                    "manual-start", "hotkey-trigger", "timer-trigger", "if", "while",
                    "pixel-scan", "pixel-watch", "logic-gate", "key-press", "key-hold",
                    "ipc-command", "mouse-move", "mouse-click", "mouse-drag",
                    "mouse-hold-sweep", "loop", "break", "variable", "delay", "pause",
                    "log", "script",
                ];
                if !known.contains(&t) {
                    errors.push(format!("node '{id}' has unknown type '{t}'"));
                }
                if ids.iter().filter(|i| **i == id).count() > 1 {
                    errors.push(format!("duplicate node id '{id}'"));
                }
            }
            None => errors.push(format!("node '{id}' is missing 'type'")),
        }
        if n.get("fields").map(|f| !f.is_object() && !f.is_null()) == Some(true) {
            errors.push(format!("node '{id}' has non-object 'fields'"));
        }
    }
    let id_set: Vec<&str> = ids.clone();
    if let Some(conns) = m.get("connections").and_then(|c| c.as_array()) {
        for c in conns {
            let from = c.get("from").and_then(|v| v.as_str()).unwrap_or("<missing>");
            let to = c.get("to").and_then(|v| v.as_str()).unwrap_or("<missing>");
            if !id_set.contains(&from) {
                errors.push(format!("connection from '{from}' references a missing node"));
            }
            if !id_set.contains(&to) {
                errors.push(format!("connection to '{to}' references a missing node"));
            }
        }
    }
    if !node_vals
        .iter()
        .any(|n| n.get("type").and_then(|v| v.as_str()) == Some("manual-start"))
    {
        errors.push("no 'manual-start' node — the macro cannot run".into());
    }
    if m.get("id").and_then(|v| v.as_str()).is_none() {
        warnings.push("missing top-level 'id'".into());
    }
    json!({"errors": errors, "warnings": warnings, "valid": errors.is_empty()})
}

fn tools_json() -> Value {
    json!([
    {
        "name": "list_macros",
        "description": "List all macros with id, title and description.",
        "inputSchema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_macro",
        "description": "Read a macro's full JSON (nodes, connections, fields).",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}
    },
    {
        "name": "create_macro",
        "description": "Create a new empty macro (id, title, description). Edit it afterwards via save_macro.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"}
            },
            "required": ["id"]
        }
    },
    {
        "name": "save_macro",
        "description": "Write a full macro body. Must be { id, title, description, nodes, connections }. Each node: { id, type, x, y, fields }. Each connection: { from, to }. Use node_help to learn valid node types and field keys; usually run after validate_macro.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "macro": {"type": "object"}
            },
            "required": ["id", "macro"]
        }
    },
    {
        "name": "delete_macro",
        "description": "Delete a macro.", 
        "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}
    },
    {
        "name": "validate_macro",
        "description": "Validate an existing macro: unknown node types, duplicate ids, dangling connections, missing manual-start. Returns { errors, warnings, valid }.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}
    },
    {
        "name": "node_help",
        "description": "Describe every node type and the `fields` keys it accepts, plus connection and variable-substitution syntax. Call before building a macro.",
        "inputSchema": {"type": "object", "properties": {}}
    }
    ])
}
