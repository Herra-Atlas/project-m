use std::sync::atomic::Ordering;

use crate::engine::{execute_node, Engine};
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let interval_ms = crate::nodes::field_u64(node, "intervalMs", 100);
    let loop_count = crate::nodes::field_u64(node, "loopCount", 1);
    let body_ids = engine.outgoing(&node.id);
    let count = if loop_count > 0 { loop_count } else { u64::MAX };

    engine.set_output(&node.id, "status", serde_json::json!("running"));

    for i in 0..count {
        if engine.stop_requested.load(Ordering::SeqCst) {
            break;
        }
        // If a `break` node was hit during the last iteration of THIS loop,
        // consume the signal and exit just this loop. Outer loops keep going.
        if engine.break_signal.load(Ordering::SeqCst) > 0 {
            engine.break_signal.fetch_sub(1, Ordering::SeqCst);
            engine.set_output(&node.id, "status", serde_json::json!("broken"));
            return Ok(vec![]);
        }

        // Run all body children IN PARALLEL. This is what makes a loop body
        // with both a mouse-click and a hotkey-trigger work — the click keeps
        // firing every interval while the trigger waits for the key, and as
        // soon as the trigger fires (and the break node sets break_signal),
        // the next iteration sees the signal and the click task gets aborted
        // because stop_requested was set by the user OR because we abort the
        // JoinSet at the end of this iteration.
        if !body_ids.is_empty() {
            let mut joinset: tokio::task::JoinSet<()> = tokio::task::JoinSet::new();
            for body_id in &body_ids {
                let eng = engine.clone();
                let id = body_id.clone();
                joinset.spawn(async move {
                    let mut local_path: Vec<String> = Vec::new();
                    if let Err(e) = execute_node(eng, &id, &mut local_path).await {
                        log::error!("Loop body child error: {}", e);
                    }
                });
            }
            while let Some(res) = joinset.join_next().await {
                if let Err(e) = res {
                    log::error!("Loop body join error: {}", e);
                }
                if engine.stop_requested.load(Ordering::SeqCst) {
                    joinset.abort_all();
                    break;
                }
                if engine.break_signal.load(Ordering::SeqCst) > 0 {
                    joinset.abort_all();
                    break;
                }
            }
        }

        if engine.stop_requested.load(Ordering::SeqCst) {
            engine.set_output(&node.id, "status", serde_json::json!("stopped"));
            return Ok(vec![]);
        }

        let on_finite_last = count != u64::MAX && i + 1 >= count;
        if !on_finite_last && interval_ms > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
        }
    }
    engine.set_output(&node.id, "status", serde_json::json!("completed"));
    Ok(vec![])
}