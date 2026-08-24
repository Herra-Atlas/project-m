use crate::engine::Engine;
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    loop {
        if engine.stop_requested.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    engine.set_output(&node.id, "status", serde_json::json!("resumed"));
    Ok(engine.outgoing(&node.id))
}