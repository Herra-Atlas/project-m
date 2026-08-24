use crate::engine::Engine;
use crate::macro_data::Node;
use serde_json::{json, Map, Value};
use std::time::Duration;
use tauri::Emitter;

/// Sandboxed QuickJS runtime that runs user-supplied JavaScript inside a
/// `script` node. ~1 ms cold-start, no installation (linked into the binary).
///
/// Exposed JS API (set up via the prelude below):
///   $vars.<name>            read / write a global variable
///   $out.<name> = value     write this node's typed output (any name)
///   $log(msg)               push to the editor log
///   $sleep(ms)              block this script for `ms` milliseconds
///   $engine.output(key)     read any other node's output (e.g. "n-green.firstMatchX")
///   $engine.var(name)       read a global variable (alias for $vars.<name>)
///   $stop()                 request the macro stop
///
/// Sandbox: no fs, no net, no require/import. Heap + stack + execution time
/// are capped via QuickJS limits. The Context is !Send, so the engine is
/// never borrowed from inside a JS callback — we snapshot state into JS
/// globals before eval and read back the writes after eval returns.
pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let code = field_str(node, "code");
    if code.trim().is_empty() {
        engine.set_output(&node.id, "status", json!("ok"));
        engine.set_output(&node.id, "result", json!(""));
        return Ok(engine.outgoing(&node.id));
    }

    let timeout_ms: u64 = crate::nodes::field_u64(node, "timeoutMs", 5_000);
    let heap_mb: usize = crate::nodes::field_u64(node, "heapMb", 8).min(128) as usize;

    let node_id = node.id.clone();

    let vars_snapshot: Map<String, Value> = engine
        .variables
        .lock()
        .map(|v| v.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let outs_snapshot: Map<String, Value> = engine
        .outputs
        .lock()
        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    let outcome = tokio::task::spawn_blocking(move || {
        execute_in_quickjs(&code, &node_id, vars_snapshot, outs_snapshot, timeout_ms, heap_mb)
    })
    .await;

    match outcome {
        Ok(out) if out.status == "ok" => {
            if let Ok(mut vars) = engine.variables.lock() {
                for (k, v) in out.var_writes {
                    vars.insert(k, v);
                }
            }
            if let Ok(mut outs) = engine.outputs.lock() {
                for (k, v) in out.out_writes {
                    let key = format!("{}.{}", node.id, k);
                    outs.insert(key, v);
                }
            }
            for msg in out.logs {
                let _ = engine.app_handle.emit(
                    "log",
                    json!({ "message": msg, "nodeId": node.id }),
                );
            }
            if out.stop_requested {
                engine
                    .stop_requested
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            }
            engine.set_output(&node.id, "status", json!(out.status));
            engine.set_output(&node.id, "result", json!(out.result));
        }
        Ok(out) => {
            eprintln!("[script] node={} error: {}", node.id, out.result);
            let _ = engine.app_handle.emit(
                "log",
                json!({ "message": format!("script error: {}", out.result), "nodeId": node.id }),
            );
            engine.set_output(&node.id, "status", json!("error"));
            engine.set_output(&node.id, "result", json!(out.result));
        }
        Err(join_err) => {
            let msg = format!("script task panicked: {}", join_err);
            let _ = engine.app_handle.emit(
                "log",
                json!({ "message": msg.clone(), "nodeId": node.id }),
            );
            engine.set_output(&node.id, "status", json!("error"));
            engine.set_output(&node.id, "result", json!(msg));
        }
    }

    Ok(engine.outgoing(&node.id))
}

#[derive(Debug, Default)]
struct ExecOutcome {
    status: String,
    result: String,
    var_writes: Vec<(String, Value)>,
    out_writes: Vec<(String, Value)>,
    logs: Vec<String>,
    stop_requested: bool,
}

impl ExecOutcome {
    fn ok() -> Self {
        Self { status: "ok".to_string(), ..Default::default() }
    }
    fn err(msg: impl Into<String>) -> Self {
        Self { status: "error".to_string(), result: msg.into(), ..Default::default() }
    }
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn json_to_js<'js>(
    ctx: &rquickjs::Ctx<'js>,
    v: &Value,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    use rquickjs::{Array, Object, Value as JsValue};
    match v {
        Value::Null => Ok(JsValue::new_null(ctx.clone())),
        Value::Bool(b) => Ok(JsValue::new_bool(ctx.clone(), *b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(JsValue::new_number(ctx.clone(), i as f64))
            } else if let Some(f) = n.as_f64() {
                Ok(JsValue::new_number(ctx.clone(), f))
            } else {
                Ok(JsValue::new_null(ctx.clone()))
            }
        }
        Value::String(s) => Ok(rquickjs::String::from_str(ctx.clone(), s)?.into_value()),
        Value::Array(arr) => {
            let a = Array::new(ctx.clone())?;
            for (i, item) in arr.iter().enumerate() {
                a.set(i, json_to_js(ctx, item)?)?;
            }
            Ok(a.into_value())
        }
        Value::Object(map) => {
            let o = Object::new(ctx.clone())?;
            for (k, val) in map {
                o.set(k.as_str(), json_to_js(ctx, val)?)?;
            }
            Ok(o.into_value())
        }
    }
}

fn js_value_to_json(v: &rquickjs::Value<'_>) -> Value {
    if v.is_null() || v.is_undefined() {
        Value::Null
    } else if let Some(b) = v.as_bool() {
        Value::Bool(b)
    } else if let Some(i) = v.as_int() {
        Value::Number(i.into())
    } else if let Some(f) = v.as_float() {
        serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null)
    } else if let Some(s) = v.as_string() {
        match s.to_string() {
            Ok(s) => Value::String(s),
            Err(_) => Value::Null,
        }
    } else {
        Value::Null
    }
}

fn execute_in_quickjs(
    code: &str,
    _node_id: &str,
    vars_snapshot: Map<String, Value>,
    outs_snapshot: Map<String, Value>,
    timeout_ms: u64,
    heap_mb: usize,
) -> ExecOutcome {
    use rquickjs::{Array, Context, Function, Object, Runtime, Value as JsValue};

    let runtime = match Runtime::new() {
        Ok(r) => r,
        Err(e) => return ExecOutcome::err(format!("runtime: {}", e)),
    };
    runtime.set_memory_limit(heap_mb * 1024 * 1024);
    runtime.set_max_stack_size(512 * 1024);
    // Wall-clock timeout via interrupt handler. QuickJS calls this between
    // every few opcodes; returning true aborts with an exception.
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    runtime.set_interrupt_handler(Some(Box::new(move || std::time::Instant::now() >= deadline)));

    let context = match Context::full(&runtime) {
        Ok(c) => c,
        Err(e) => return ExecOutcome::err(format!("context: {}", e)),
    };

    let run_result: Result<
        (
            String,
            Vec<(String, Value)>,
            Vec<(String, Value)>,
            Vec<String>,
            bool,
        ),
        rquickjs::Error,
    > = context.with(|ctx| -> rquickjs::Result<(
        String,
        Vec<(String, Value)>,
        Vec<(String, Value)>,
        Vec<String>,
        bool,
    )> {
        // host.* low-level functions: only sleep, which doesn't touch engine state.
        let sleep_fn = Function::new(
            ctx.clone(),
            |ms: i64| {
                let ms = ms.max(0) as u64;
                std::thread::sleep(Duration::from_millis(ms));
            },
        )?;
        ctx.globals().set("__host_sleep", sleep_fn)?;

        // Snapshot objects the script can read from.
        let vars_obj = Object::new(ctx.clone())?;
        for (k, v) in &vars_snapshot {
            vars_obj.set(k.as_str(), json_to_js(&ctx, v)?)?;
        }
        ctx.globals().set("__initial_vars", vars_obj)?;

        let outs_obj = Object::new(ctx.clone())?;
        for (k, v) in &outs_snapshot {
            outs_obj.set(k.as_str(), json_to_js(&ctx, v)?)?;
        }
        ctx.globals().set("__initial_outputs", outs_obj)?;

        // Write buffers the script mutates; we drain them after eval.
        let writes_vars = Object::new(ctx.clone())?;
        ctx.globals().set("__writes_vars", writes_vars)?;
        let writes_out = Object::new(ctx.clone())?;
        ctx.globals().set("__writes_out", writes_out)?;
        let log_buf = Array::new(ctx.clone())?;
        ctx.globals().set("__log_buf", log_buf.clone())?;
        let stop_flag = JsValue::new_bool(ctx.clone(), false);
        ctx.globals().set("__stop_flag", stop_flag)?;

        // Prelude: define the nice API the user code uses.
        let prelude = r#"
            (function() {
                const $vars = new Proxy({}, {
                    get: function(_, name) {
                        if (typeof name !== 'string') return undefined;
                        if (__writes_vars[name] !== undefined) return __writes_vars[name];
                        return __initial_vars[name];
                    },
                    set: function(_, name, value) {
                        __writes_vars[name] = value;
                        return true;
                    },
                    has: function(_, name) {
                        return typeof name === 'string' && (__writes_vars[name] !== undefined || __initial_vars[name] !== undefined);
                    },
                });
                const $out = new Proxy({}, {
                    get: function(_, name) {
                        if (typeof name !== 'string') return undefined;
                        return __writes_out[name];
                    },
                    set: function(_, name, value) {
                        __writes_out[name] = value;
                        return true;
                    },
                    has: function(_, name) {
                        return typeof name === 'string' && __writes_out[name] !== undefined;
                    },
                });
                const $log = function(msg) {
                    __log_buf.push(String(msg));
                };
                const $sleep = function(ms) {
                    return __host_sleep(+ms | 0);
                };
                const $engine = Object.freeze({
                    output: function(key) { return __initial_outputs[key]; },
                    var:    function(n)   { return __initial_vars[n]; },
                    stop:   function()    { __stop_flag = true; },
                });
            })();
        "#;
        ctx.eval::<(), _>(prelude)?;

        let wrapped = format!("(function() {{\n{}\n}})()", code);
        let raw: rquickjs::Value = ctx.eval(wrapped)?;

        let mut var_writes: Vec<(String, Value)> = Vec::new();
        let writes_vars = ctx.globals().get::<_, Object>("__writes_vars")?;
        for key in writes_vars.keys::<String>() {
            let k = match key {
                Ok(k) => k,
                Err(_) => continue,
            };
            let v: rquickjs::Value = writes_vars
                .get(&k)
                .unwrap_or_else(|_| JsValue::new_undefined(ctx.clone()));
            var_writes.push((k, js_value_to_json(&v)));
        }

        let mut out_writes: Vec<(String, Value)> = Vec::new();
        let writes_out = ctx.globals().get::<_, Object>("__writes_out")?;
        for key in writes_out.keys::<String>() {
            let k = match key {
                Ok(k) => k,
                Err(_) => continue,
            };
            let v: rquickjs::Value = writes_out
                .get(&k)
                .unwrap_or_else(|_| JsValue::new_undefined(ctx.clone()));
            out_writes.push((k, js_value_to_json(&v)));
        }

        let log_arr: Array = ctx.globals().get("__log_buf")?;
        let mut logs: Vec<String> = Vec::new();
        for i in 0..log_arr.len() {
            if let Ok(item) = log_arr.get::<rquickjs::Value>(i) {
                if let Some(s) = item.as_string() {
                    if let Ok(s) = s.to_string() {
                        logs.push(s);
                    }
                }
            }
        }

        let stop: bool = ctx
            .globals()
            .get::<_, rquickjs::Value>("__stop_flag")
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let result_str = if raw.is_null() || raw.is_undefined() {
            String::new()
        } else if let Some(s) = raw.as_string() {
            s.to_string().unwrap_or_default()
        } else {
            format!("{:?}", raw)
        };

        Ok((result_str, var_writes, out_writes, logs, stop))
    });

    match run_result {
        Ok((result_str, var_writes, out_writes, logs, stop)) => {
            let mut o = ExecOutcome::ok();
            o.result = result_str;
            o.var_writes = var_writes;
            o.out_writes = out_writes;
            o.logs = logs;
            o.stop_requested = stop;
            o
        }
        Err(e) => ExecOutcome::err(e.to_string()),
    }
}