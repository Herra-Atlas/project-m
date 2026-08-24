use crate::engine::Engine;
use crate::macro_data::Node;
use crate::input::Input;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let x = crate::nodes::field_i64(node, "x", 0);
    let y = crate::nodes::field_i64(node, "y", 0);
    let mut input = Input::new();
    input.mouse_move(x as i32, y as i32);
    engine.set_output(&node.id, "status", serde_json::json!("moved"));
    Ok(engine.outgoing(&node.id))
}

