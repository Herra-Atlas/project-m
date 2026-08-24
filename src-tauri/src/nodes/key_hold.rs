use crate::engine::Engine;
use crate::macro_data::Node;
use crate::input::Input;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let key = field_str(node, "key");
    let duration_ms = crate::nodes::field_u64(node, "durationMs", 500);

    if !key.is_empty() {
        let mut input = Input::new();
        input.key_down(&key);
        if duration_ms > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(duration_ms)).await;
        }
        input.key_up(&key);
    }
    engine.set_output(&node.id, "status", serde_json::json!("held"));
    Ok(engine.outgoing(&node.id))
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

