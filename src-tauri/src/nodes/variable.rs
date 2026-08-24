use crate::engine::Engine;
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let name = field_str(node, "name");
    let value = field_str(node, "value");

    if name.is_empty() {
        engine.set_output(&node.id, "status", serde_json::json!("error"));
        return Ok(engine.outgoing(&node.id));
    }

if let Ok(mut vars) = engine.variables.lock() {
        vars.insert(name, serde_json::json!(value));
    }
    engine.set_output(&node.id, "status", serde_json::json!("set"));

    Ok(engine.outgoing(&node.id))
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

