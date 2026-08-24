use chrono::Timelike;

use crate::engine::Engine;
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let mode = field_str(node, "mode");
    if mode == "clock" {
        let clock_time = field_str(node, "clockTime");
        wait_until_clock(&clock_time, &engine.stop_requested).await?;
    } else {
        let interval_ms = crate::nodes::field_u64(node, "intervalMs", 500);
        if interval_ms > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
        }
    }
    engine.set_output(&node.id, "status", serde_json::json!("fired"));
    Ok(engine.outgoing(&node.id))
}

async fn wait_until_clock(
    clock_time: &str,
    stop: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
    let parts: Vec<&str> = clock_time.split(':').collect();
    if parts.len() != 2 {
        return Ok(());
    }
    let target_hour = parts[0].parse::<u32>().unwrap_or(0);
    let target_minute = parts[1].parse::<u32>().unwrap_or(0);

    loop {
        if stop.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(());
        }
        let now = chrono::Local::now();
        let current = now.time();
        if current.hour() == target_hour
            && current.minute() == target_minute
            && current.second() == 0
        {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }
    Ok(())
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

