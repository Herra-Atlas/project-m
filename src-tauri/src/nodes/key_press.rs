use crate::engine::Engine;
use crate::macro_data::Node;
use crate::input::Input;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let key = field_str(node, "key");
    if !key.is_empty() {
        let mut input = Input::new();
        input.key_press(&key);
    }
    engine.set_output(&node.id, "status", serde_json::json!("pressed"));
    Ok(engine.outgoing(&node.id))
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

