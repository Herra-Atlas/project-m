use std::sync::atomic::Ordering;
use std::time::Duration;

use crate::engine::Engine;
use crate::macro_data::Node;
use crate::input::Input;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let button = field_str(node, "button");
    let count = crate::nodes::field_u64(node, "count", 1) as u32;
    let delay_ms = crate::nodes::field_u64(node, "delayMs", 16);

    let mut input = Input::new();
    for i in 0..count {
        if i > 0 && delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }
        if engine.stop_requested.load(Ordering::SeqCst) {
            break;
        }
        input.mouse_click(&button, 1);
    }

    engine.set_output(&node.id, "status", serde_json::json!("clicked"));
    Ok(engine.outgoing(&node.id))
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

