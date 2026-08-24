use crate::engine::Engine;
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let mode = field_str(node, "mode");
    engine.set_output(&node.id, "mode", serde_json::json!(mode));
    engine.set_output(&node.id, "status", serde_json::json!("true"));
    Ok(engine.outgoing(&node.id))
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

