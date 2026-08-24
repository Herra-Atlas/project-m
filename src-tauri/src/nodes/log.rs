use crate::engine::Engine;
use crate::macro_data::Node;
use serde_json::json;
use tauri::Emitter;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let message = field_str(node, "message");
    eprintln!("[macro] {}", message);
    let _ = engine
        .app_handle
        .emit("log", json!({ "message": message, "nodeId": node.id }));
    engine.set_output(&node.id, "status", serde_json::json!("logged"));
    Ok(engine.outgoing(&node.id))
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

