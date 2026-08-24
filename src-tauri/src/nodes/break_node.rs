use crate::engine::Engine;
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    // Increment the break signal so the nearest enclosing loop exits on its next
    // iteration. Does NOT abort the whole macro — outer loops continue.
    engine.break_signal.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    engine.set_output(&node.id, "status", serde_json::json!("broken"));
    Ok(vec![])
}

