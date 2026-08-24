use std::sync::atomic::Ordering;

use crate::engine::Engine;
use crate::macro_data::Node;
use serde_json::json;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let variable = field_str(node, "variable");
    let operator = field_str(node, "operator");
    let value = field_str(node, "value");
    let poll_ms = crate::nodes::field_u64(node, "pollMs", 50);

    loop {
        if engine.stop_requested.load(Ordering::SeqCst) {
            break;
        }
        let actual = engine
            .resolve_reference(&variable)
            .unwrap_or_else(|| variable.trim_start_matches('$').to_string());
        if eval_condition(&actual, &operator, &value) {
            engine.set_output(&node.id, "status", json!("matched"));
            return Ok(engine.outgoing(&node.id));
        }
        if poll_ms > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(poll_ms)).await;
        }
    }
    engine.set_output(&node.id, "status", json!("exited"));
    Ok(engine.outgoing(&node.id))
}

fn eval_condition(actual: &str, operator: &str, expected: &str) -> bool {
    match operator {
        "equals" => actual == expected,
        "not equals" => actual != expected,
        "contains" => actual.contains(expected),
        "greater than" => {
            let a = actual.parse::<f64>().ok();
            let b = expected.parse::<f64>().ok();
            match (a, b) {
                (Some(a), Some(b)) => a > b,
                _ => actual > expected,
            }
        }
        "less than" => {
            let a = actual.parse::<f64>().ok();
            let b = expected.parse::<f64>().ok();
            match (a, b) {
                (Some(a), Some(b)) => a < b,
                _ => actual < expected,
            }
        }
        _ => false,
    }
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}