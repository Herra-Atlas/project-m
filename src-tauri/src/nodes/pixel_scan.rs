use crate::engine::Engine;
use crate::macro_data::Node;
use crate::input::Input;

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
    let target_count = crate::nodes::field_u64(node, "targetCount", 1).max(1);
    let result_var = field_str_opt(node, "resultVar");
    let first_x_var = field_str_opt(node, "firstMatchXVar");
    let first_y_var = field_str_opt(node, "firstMatchYVar");
    let center_x_var = field_str_opt(node, "centerXVar");
    let center_y_var = field_str_opt(node, "centerYVar");
    let center_on_x_var = field_str_opt(node, "centerOnXVar");
    let center_on_y_var = field_str_opt(node, "centerOnYVar");
    let outgoing = engine.outgoing(&node.id);

    // Centroid collection requires scanning every pixel, so disable the
    // early-exit optimization when a centroid var is requested. Otherwise
    // we'd miss most of the green pixels and report a wrong center.
    let collect_centroid = !center_x_var.is_empty() || !center_y_var.is_empty();

    let vars_map = engine.variables.lock().ok();
    let scan_x = if !center_on_x_var.is_empty() {
        vars_map
            .as_ref()
            .and_then(|v| v.get(&center_on_x_var))
            .and_then(|v| v.as_i64())
            .unwrap_or(origin_x as i64)
            .saturating_sub((w as i32 / 2) as i64) as i32
    } else {
        origin_x
    };
    let scan_y = if !center_on_y_var.is_empty() {
        vars_map
            .as_ref()
            .and_then(|v| v.get(&center_on_y_var))
            .and_then(|v| v.as_i64())
            .unwrap_or(origin_y as i64)
            .saturating_sub((h as i32 / 2) as i64) as i32
    } else {
        origin_y
    };
    drop(vars_map);

    let pixels = match Input::capture_region(scan_x, scan_y, w, h) {
        Ok(p) => p,
        Err(_) => return Ok(outgoing.get(1).cloned().into_iter().collect()),
    };

    let (tr, tg, tb) = match parse_hex(&color) {
        Some(c) => c,
        None => return Ok(outgoing.get(1).cloned().into_iter().collect()),
    };

    let stride = ((w * 3 + 3) / 4) * 4;
    let mut hits: u64 = 0;
    let mut first_x: Option<i64> = None;
    let mut first_y: Option<i64> = None;
    let mut sum_x: i64 = 0;
    let mut sum_y: i64 = 0;
    let target = target_count as u64;

    'outer: for row in 0..h {
        for col in 0..w {
            let idx = (row * stride + col * 3) as usize;
            if idx + 2 < pixels.len() {
                let b = pixels[idx];
                let g = pixels[idx + 1];
                let r = pixels[idx + 2];
                if (r as i16 - tr as i16).abs() <= r_tol as i16
                    && (g as i16 - tg as i16).abs() <= g_tol as i16
                    && (b as i16 - tb as i16).abs() <= b_tol as i16
                {
                    if first_x.is_none() {
                        first_x = Some(scan_x as i64 + col as i64);
                        first_y = Some(scan_y as i64 + row as i64);
                    }
                    if collect_centroid {
                        sum_x += scan_x as i64 + col as i64;
                        sum_y += scan_y as i64 + row as i64;
                    }
                    hits += 1;
                    if !collect_centroid && hits >= target {
                        // Early exit — the caller only needs to know
                        // whether target_count was reached and where the
                        // first match landed. Skipping the rest of the
                        // scan makes 20x20 regions return in ~0.1ms when
                        // the match is near the top-left corner.
                        break 'outer;
                    }
                }
            }
        }
    }

    // Always emit whereX/whereY — 0 when nothing matched — so downstream
    // nodes never read stale coordinates from a previous successful scan.
    let emitted_x = first_x.unwrap_or(0);
    let emitted_y = first_y.unwrap_or(0);
    // Centroid of all matching pixels. Use this as the bobber's true
    // center when the first match landed on an outline pixel — red moves
    // in a circle around the centroid, not the first match, so centering
    // the red-watch on the centroid catches every position on the clock.
    let centroid_x = if hits > 0 { sum_x / hits as i64 } else { 0 };
    let centroid_y = if hits > 0 { sum_y / hits as i64 } else { 0 };

    if let Ok(mut vars) = engine.variables.lock() {
        if !result_var.is_empty() {
            vars.insert(result_var, serde_json::json!(hits));
        }
        if !first_x_var.is_empty() {
            vars.insert(first_x_var, serde_json::json!(emitted_x));
        }
        if !first_y_var.is_empty() {
            vars.insert(first_y_var, serde_json::json!(emitted_y));
        }
        if !center_x_var.is_empty() {
            vars.insert(center_x_var, serde_json::json!(centroid_x));
        }
        if !center_y_var.is_empty() {
            vars.insert(center_y_var, serde_json::json!(centroid_y));
        }
    }

    // Public outputs (n8n-style). These are also usable as $variable
    // references from any downstream node.
    engine.set_output(
        &node.id,
        "status",
        serde_json::json!(if hits >= target_count { "found" } else { "not found" }),
    );
    engine.set_output(&node.id, "whereX", serde_json::json!(emitted_x));
    engine.set_output(&node.id, "whereY", serde_json::json!(emitted_y));
    engine.set_output(&node.id, "centerX", serde_json::json!(centroid_x));
    engine.set_output(&node.id, "centerY", serde_json::json!(centroid_y));

    if hits >= target_count {
        Ok(outgoing.get(0).cloned().into_iter().collect())
    } else {
        Ok(outgoing.get(1).cloned().into_iter().collect())
    }
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