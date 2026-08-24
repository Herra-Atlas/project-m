use crate::engine::Engine;
use crate::macro_data::Node;

pub mod manual_start;
pub mod hotkey_trigger;
pub mod timer_trigger;
pub mod if_node;
pub mod while_node;
pub mod logic_gate;
pub mod key_press;
pub mod key_hold;
pub mod ipc_command;
pub mod mouse_move;
pub mod mouse_click;
pub mod mouse_drag;
pub mod mouse_hold_sweep;
pub mod loop_node;
pub mod break_node;
pub mod variable;
pub mod pause;
pub mod delay;
pub mod log;
pub mod pixel_scan;
pub mod pixel_watch;
pub mod script;

/// Read a u64 field that may have been substituted from a `$variable` reference.
/// Accepts either a JSON number or a string that parses as u64.
pub fn field_u64(node: &Node, key: &str, default: u64) -> u64 {
    let Some(v) = node.fields.get(key) else {
        return default;
    };
    if let Some(n) = v.as_u64() {
        return n;
    }
    if let Some(s) = v.as_str() {
        if let Ok(n) = s.parse::<u64>() {
            return n;
        }
    }
    default
}

/// Read an i64 field that may have been substituted from a `$variable` reference.
pub fn field_i64(node: &Node, key: &str, default: i64) -> i64 {
    let Some(v) = node.fields.get(key) else {
        return default;
    };
    if let Some(n) = v.as_i64() {
        return n;
    }
    if let Some(s) = v.as_str() {
        if let Ok(n) = s.parse::<i64>() {
            return n;
        }
    }
    default
}

pub async fn run_node(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    match node.node_type.as_str() {
        "manual-start" => manual_start::run(node, engine).await,
        "hotkey-trigger" => hotkey_trigger::run(node, engine).await,
        "timer-trigger" => timer_trigger::run(node, engine).await,
        "if" => if_node::run(node, engine).await,
        "while" => while_node::run(node, engine).await,
        "logic-gate" => logic_gate::run(node, engine).await,
        "key-press" => key_press::run(node, engine).await,
        "key-hold" => key_hold::run(node, engine).await,
        "ipc-command" => ipc_command::run(node, engine).await,
        "mouse-move" => mouse_move::run(node, engine).await,
        "mouse-click" => mouse_click::run(node, engine).await,
        "mouse-drag" => mouse_drag::run(node, engine).await,
        "mouse-hold-sweep" => mouse_hold_sweep::run(node, engine).await,
        "loop" => loop_node::run(node, engine).await,
        "break" => break_node::run(node, engine).await,
        "variable" => variable::run(node, engine).await,
        "pause" => pause::run(node, engine).await,
        "delay" => delay::run(node, engine).await,
        "log" => log::run(node, engine).await,
        "pixel-scan" => pixel_scan::run(node, engine).await,
        "pixel-watch" => pixel_watch::run(node, engine).await,
        "script" => script::run(node, engine).await,
        _ => Ok(engine.outgoing(&node.id)),
    }
}
