use crate::engine::Engine;
use crate::macro_data::Node;
use crate::input::Input;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let from_x = crate::nodes::field_i64(node, "fromX", 0);
    let from_y = crate::nodes::field_i64(node, "fromY", 0);
    let to_x = crate::nodes::field_i64(node, "toX", 100);
    let to_y = crate::nodes::field_i64(node, "toY", 100);
    let button = field_str(node, "button");
    let duration_ms = crate::nodes::field_u64(node, "durationMs", 0);
    let pause_ms = crate::nodes::field_u64(node, "pauseMs", 0);

    let mut input = Input::new();
    input.mouse_move(from_x as i32, from_y as i32);
    input.mouse_down(&button);

    if duration_ms > 0 {
        let steps = (duration_ms / 16).max(1);
        for i in 1..=steps {
            let t = i as f64 / steps as f64;
            let cx = from_x + ((to_x - from_x) * t as i64);
            let cy = from_y + ((to_y - from_y) * t as i64);
            input.mouse_move(cx as i32, cy as i32);
            tokio::time::sleep(tokio::time::Duration::from_millis(16)).await;
            if engine.stop_requested.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
        }
    } else {
        input.mouse_move(to_x as i32, to_y as i32);
    }

    if pause_ms > 0 {
        tokio::time::sleep(tokio::time::Duration::from_millis(pause_ms)).await;
    }

    input.mouse_up(&button);
    engine.set_output(&node.id, "status", serde_json::json!("swept"));
    Ok(engine.outgoing(&node.id))
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

