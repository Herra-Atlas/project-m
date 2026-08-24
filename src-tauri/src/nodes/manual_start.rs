use crate::engine::Engine;
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    engine.set_output(&node.id, "status", serde_json::json!("started"));
    Ok(engine.outgoing(&node.id))
}