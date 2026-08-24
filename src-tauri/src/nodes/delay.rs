use crate::engine::Engine;
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let ms = crate::nodes::field_u64(node, "ms", 500);
    if ms > 0 {
        tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
    }
    engine.set_output(&node.id, "status", serde_json::json!("elapsed"));
    Ok(engine.outgoing(&node.id))
}

