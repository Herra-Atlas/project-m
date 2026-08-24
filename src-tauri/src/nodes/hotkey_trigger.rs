use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use crate::engine::Engine;
use crate::macro_data::Node;

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let key = field_str(node, "key");
    if key.is_empty() {
        engine.set_output(&node.id, "status", serde_json::json!("error"));
        return Ok(engine.outgoing(&node.id));
    }

    let vk = match key_to_vk(&key) {
        Some(v) => v,
        None => {
            engine.set_output(&node.id, "status", serde_json::json!("error"));
            return Ok(engine.outgoing(&node.id));
        }
    };

    let stop = engine.stop_requested.clone();

    // Poll GetAsyncKeyState every 20 ms and watch for a 0→1 transition
    // (the frame where the key first becomes pressed). The previous hook
    // approach using WH_KEYBOARD_LL kept destabilising the main thread on
    // Windows — the global hook is process-wide, swallows the key from
    // every focused window, and the OS will silently unhook a proc that
    // runs too long. Polling is slower (~50 ms reaction vs sub-frame) but
    // a stop hotkey doesn't need sub-frame latency, and it doesn't touch
    // any other app's input.
    //
    // NOTE: the key is NOT swallowed — the user's 6 still reaches whatever
    // app has focus. For a "stop macro" key, that is usually what you want.
    unsafe {
        let initial_pressed = (GetAsyncKeyState(vk) as u16 & 0x8000u16) != 0;
        let start = Instant::now();
        let mut last_pressed = initial_pressed;
        loop {
            if stop.load(Ordering::SeqCst) {
                engine.set_output(&node.id, "status", serde_json::json!("cancelled"));
                return Ok(vec![]);
            }
            let now_pressed = (GetAsyncKeyState(vk) as u16 & 0x8000u16) != 0;
            // Rising edge: key was not pressed last tick and is pressed now.
            // Also accept the very first poll if the user was already holding
            // the key when the macro started — feels more responsive.
            let rising = (now_pressed && !last_pressed)
                || (now_pressed && start.elapsed() < Duration::from_millis(100));
            if rising {
                engine.set_output(&node.id, "status", serde_json::json!("pressed"));
                return Ok(engine.outgoing(&node.id));
            }
            last_pressed = now_pressed;
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn key_to_vk(s: &str) -> Option<u32> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if s.chars().count() == 1 {
        let c = s.chars().next().unwrap();
        if c.is_ascii_digit() {
            return Some(c as u32);
        }
        if c.is_ascii_alphabetic() {
            return Some(c.to_ascii_uppercase() as u32);
        }
    }
    match s.to_ascii_lowercase().as_str() {
        "space" => Some(0x20),
        "enter" | "return" | "numpadenter" => Some(0x0D),
        "esc" | "escape" => Some(0x1B),
        "tab" => Some(0x09),
        "shift" | "leftshift" => Some(0xA0),
        "rightshift" => Some(0xA1),
        "ctrl" | "control" | "leftctrl" => Some(0xA2),
        "rightctrl" => Some(0xA3),
        "alt" | "leftalt" => Some(0xA4),
        "rightalt" => Some(0xA5),
        "backspace" | "back" => Some(0x08),
        "delete" | "del" => Some(0x2E),
        "home" => Some(0x24),
        "end" => Some(0x23),
        "pageup" | "pgup" => Some(0x21),
        "pagedown" | "pgdn" => Some(0x22),
        "up" | "arrowup" => Some(0x26),
        "down" | "arrowdown" => Some(0x28),
        "left" | "arrowleft" => Some(0x25),
        "right" | "arrowright" => Some(0x27),
        "f1" => Some(0x70),
        "f2" => Some(0x71),
        "f3" => Some(0x72),
        "f4" => Some(0x73),
        "f5" => Some(0x74),
        "f6" => Some(0x75),
        "f7" => Some(0x76),
        "f8" => Some(0x77),
        "f9" => Some(0x78),
        "f10" => Some(0x79),
        "f11" => Some(0x7A),
        "f12" => Some(0x7B),
        _ => None,
    }
}

#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(vk: u32) -> i16;
}