use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use tokio::sync::oneshot;

use crate::engine::Engine;
use crate::input::Input;
use crate::macro_data::Node;

/// `pixel-watch` is the fast-path sibling of `pixel-scan`. Instead of returning
/// "found"/"not found" immediately, it spawns a dedicated OS thread that polls
/// the region in a tight loop (no `intervalMs`, no `pollMs` sleeps) until a
/// matching pixel appears, the timeout elapses, or stop is requested. The main
/// async fn blocks on a oneshot channel and only resumes once the watcher has
/// caught a match.
///
/// Use this for low-latency triggers (e.g. "press G the instant the bobber
/// flashes red") where `pixel-scan` + an `if` loop would add 30–60 ms of
/// per-iteration sleep and miss short bite windows.
///
/// Honors `centerOnXVar` / `centerOnYVar` the same way `pixel-scan` does: when
/// set, the scan rect is recentered so the variable's value lands at the rect's
/// center (so a 20×20 region with `centerOnXVar=greenX` scans ±10 around the
/// green's match). Required for the kalastus-style "wait for red near green"
/// pattern — without it the watch scans the absolute `fromX,fromY` corner
/// instead of the variable's location, which on a fishing macro means polling
/// the top-left of the screen and never finding anything.
pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let from_x = crate::nodes::field_i64(node, "fromX", 0) as i32;
    let from_y = crate::nodes::field_i64(node, "fromY", 0) as i32;
    let to_x = crate::nodes::field_i64(node, "toX", 100) as i32;
    let to_y = crate::nodes::field_i64(node, "toY", 100) as i32;
    let w = ((to_x - from_x).abs() as u32).max(1);
    let h = ((to_y - from_y).abs() as u32).max(1);
    let origin_x = from_x.min(to_x);
    let origin_y = from_y.min(to_y);
    let color = field_str(node, "color", "#FF0000");
    let r_tol = crate::nodes::field_u64(node, "rTol", 10).min(255) as u8;
    let g_tol = crate::nodes::field_u64(node, "gTol", 10).min(255) as u8;
    let b_tol = crate::nodes::field_u64(node, "bTol", 10).min(255) as u8;
    let center_on_x_var = field_str_opt(node, "centerOnXVar");
    let center_on_y_var = field_str_opt(node, "centerOnYVar");
    let timeout_ms = crate::nodes::field_u64(node, "timeoutMs", 5000);

    let (tr, tg, tb) = match parse_hex(&color) {
        Some(c) => c,
        None => {
            engine.set_output(&node.id, "status", serde_json::json!("error"));
            return Ok(engine.outgoing(&node.id));
        }
    };

    // Resolve the scan origin the same way pixel-scan does. Look up both
    // values inside a single lock scope and destructure them so the
    // MutexGuard is dropped before we hit any `.await` below — holding a
    // non-Send guard across an await would make the future `!Send`.
    let (scan_x, scan_y) = engine.variables.lock().ok().map(|v| {
        let sx = if !center_on_x_var.is_empty() {
            v.get(&center_on_x_var)
                .and_then(|x| x.as_i64())
                .unwrap_or(origin_x as i64)
                .saturating_sub((w as i32 / 2) as i64) as i32
        } else {
            origin_x
        };
        let sy = if !center_on_y_var.is_empty() {
            v.get(&center_on_y_var)
                .and_then(|y| y.as_i64())
                .unwrap_or(origin_y as i64)
                .saturating_sub((h as i32 / 2) as i64) as i32
        } else {
            origin_y
        };
        (sx, sy)
    }).unwrap_or((origin_x, origin_y));

    let stop = engine.stop_requested.clone();
    let (tx, rx) = oneshot::channel::<(i32, i32)>();
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);

    std::thread::spawn(move || {
        let stride = ((w * 3 + 3) / 4) * 4;
        loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            if Instant::now() >= deadline {
                break;
            }
            let pixels = match Input::capture_region(scan_x, scan_y, w, h) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let mut matched = false;
            let mut mx = 0i32;
            let mut my = 0i32;
            'scan: for row in 0..h {
                for col in 0..w {
                    let idx = (row * stride + col * 3) as usize;
                    if idx + 2 >= pixels.len() {
                        continue;
                    }
                    let b = pixels[idx];
                    let g = pixels[idx + 1];
                    let r = pixels[idx + 2];
                    if (r as i16 - tr as i16).abs() <= r_tol as i16
                        && (g as i16 - tg as i16).abs() <= g_tol as i16
                        && (b as i16 - tb as i16).abs() <= b_tol as i16
                    {
                        matched = true;
                        mx = scan_x + col as i32;
                        my = scan_y + row as i32;
                        break 'scan;
                    }
                }
            }
            if matched {
                let _ = tx.send((mx, my));
                return;
            }
        }
    });

    // Wait for either a match or the spawned thread to exit (stop / timeout).
    // On any non-match exit path, the oneshot sender is dropped without firing,
    // so rx.await returns Err and we treat it as "no match".
    let (mx, my) = match rx.await {
        Ok(coords) => coords,
        Err(_) => (0, 0),
    };
    if mx == 0 && my == 0 {
        // Either stop, timeout, or real (0,0) match. Without a separate
        // channel we can't tell which — but (0,0) is virtually never a real
        // pixel-watch hit since pixel (0,0) is the corner of the screen.
        // Treat it as a timeout.
        engine.set_output(&node.id, "status", serde_json::json!("timeout"));
        engine.set_output(&node.id, "whereX", serde_json::json!(0));
        engine.set_output(&node.id, "whereY", serde_json::json!(0));
        return Ok(vec![]);
    }
    engine.set_output(&node.id, "whereX", serde_json::json!(mx));
    engine.set_output(&node.id, "whereY", serde_json::json!(my));
    engine.set_output(&node.id, "status", serde_json::json!("found"));
    Ok(engine.outgoing(&node.id))
}

fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&h[0..2], 16).ok()?;
    let g = u8::from_str_radix(&h[2..4], 16).ok()?;
    let b = u8::from_str_radix(&h[4..6], 16).ok()?;
    Some((r, g, b))
}

fn field_str(node: &Node, key: &str, default: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or(default)
        .to_string()
}

fn field_str_opt(node: &Node, key: &str) -> String {
    if let Some(v) = node.fields.get(key) {
        if let Some(s) = v.as_str() {
            return s.to_string();
        }
        if v.is_number() {
            return v.to_string();
        }
    }
    String::new()
}