use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct MacroFolder {
    pub id: String,
    pub path: String,
    pub macro_json: String,
    pub chat_json: Option<String>,
}

pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn macros_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("macros");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn macro_dir(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = macros_root(app)?.join(sanitize_id(id));
    Ok(dir)
}

pub fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

/// One-shot migration: convert any flat `macros/<id>.json` files into
/// `macros/<id>/macro.json`. Safe to call on every list/save; idempotent.
pub fn migrate_flat_to_folders(app: &tauri::AppHandle) -> Result<(), String> {
    let root = macros_root(app)?;
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let target = root.join(stem);
        if target.exists() {
            // Already a folder (or already migrated). Remove the stray file.
            let _ = fs::remove_file(&path);
            continue;
        }
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        let macro_json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        fs::write(target.join("macro.json"), &macro_json).map_err(|e| e.to_string())?;
        fs::write(
            target.join("ai-chat.json"),
            serde_json::json!({ "version": 1, "messages": [] }).to_string(),
        )
        .map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&path);
    }
    Ok(())
}

/// Read the macro.json for a given id, if present.
pub fn read_macro(app: &tauri::AppHandle, id: &str) -> Result<Option<String>, String> {
    migrate_flat_to_folders(app)?;
    let path = macro_dir(app, id)?.join("macro.json");
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(fs::read_to_string(path).map_err(|e| e.to_string())?))
}

/// Write macro.json for an id, creating the folder structure if missing.
pub fn write_macro(app: &tauri::AppHandle, id: &str, payload: &str) -> Result<(), String> {
    migrate_flat_to_folders(app)?;
    let dir = macro_dir(app, id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    ensure_chat_file(&dir)?;
    fs::write(dir.join("macro.json"), payload).map_err(|e| e.to_string())
}

/// Read the AI chat history for a macro. Creates an empty file on first read.
pub fn read_chat(app: &tauri::AppHandle, id: &str) -> Result<String, String> {
    migrate_flat_to_folders(app)?;
    let dir = macro_dir(app, id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("ai-chat.json");
    if !path.exists() {
        let empty = serde_json::json!({ "version": 1, "messages": [] }).to_string();
        fs::write(&path, &empty).map_err(|e| e.to_string())?;
        return Ok(empty);
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Replace AI chat history for a macro.
pub fn write_chat(app: &tauri::AppHandle, id: &str, payload: &str) -> Result<(), String> {
    migrate_flat_to_folders(app)?;
    let dir = macro_dir(app, id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    ensure_chat_file(&dir)?;
    // Validate JSON before writing so we never corrupt the chat file.
    let _: Value = serde_json::from_str(payload).map_err(|e| format!("invalid chat JSON: {e}"))?;
    fs::write(dir.join("ai-chat.json"), payload).map_err(|e| e.to_string())
}

/// Append a log line to the per-macro logs file.
pub fn append_log(app: &tauri::AppHandle, id: &str, line: &str) -> Result<(), String> {
    migrate_flat_to_folders(app)?;
    let dir = macro_dir(app, id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    ensure_chat_file(&dir)?;
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("logs.jsonl"))
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line).map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a macro folder entirely. Missing folders are not an error.
pub fn delete_macro(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    migrate_flat_to_folders(app)?;
    let dir = macro_dir(app, id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// List every macro folder as raw JSON strings (the contents of macro.json).
pub fn list_macros(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    migrate_flat_to_folders(app)?;
    let root = macros_root(app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let macro_path = path.join("macro.json");
        if !macro_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&macro_path).map_err(|e| e.to_string())?;
        out.push(content);
    }
    Ok(out)
}

#[allow(dead_code)]
pub fn macro_exists(app: &tauri::AppHandle, id: &str) -> Result<bool, String> {
    let dir = macro_dir(app, id)?;
    Ok(dir.join("macro.json").exists())
}

/// Look up a macro by its title (case-insensitive). Returns (id, raw_json).
pub fn find_macro_by_title(app: &tauri::AppHandle, title: &str) -> Result<Option<(String, String)>, String> {
    let wanted = title.trim().to_lowercase();
    for raw in list_macros(app)? {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            let t = v.get("title").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
            let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if !wanted.is_empty() && t == wanted {
                return Ok(Some((id, raw)));
            }
        }
    }
    Ok(None)
}

pub fn ensure_chat_file(dir: &Path) -> Result<(), String> {
    let path = dir.join("ai-chat.json");
    if !path.exists() {
        fs::write(
            &path,
            serde_json::json!({ "version": 1, "messages": [] }).to_string(),
        )
        .map_err(|e| e.to_string())?;
    }
    let _ = fs::create_dir_all(dir.join("assets"));
    Ok(())
}

/// Copy a folder from `src` into `<macros_root>/<sanitized_id>/`. Used by
/// "Import" when the user picks Copy. Returns the id of the imported folder.
pub fn import_copy(app: &tauri::AppHandle, src: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(src.join("macro.json")).map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("invalid macro.json: {e}"))?;
    let base_id = parsed
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "macro.json missing id field".to_string())?
        .to_string();
    let target_id = next_unique_id(app, &base_id);
    let target = macro_dir(app, &target_id)?;
    if target.exists() {
        return Err(format!("target {} already exists", target.display()));
    }
    copy_dir_recursive(src, &target)?;
    // Re-stamp the id inside the copied macro.json so the on-disk folder
    // matches the in-memory id we returned.
    let macro_path = target.join("macro.json");
    let mut json: Value = serde_json::from_str(&fs::read_to_string(&macro_path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if let Some(obj) = json.as_object_mut() {
        obj.insert("id".into(), Value::String(target_id.clone()));
    }
    fs::write(&macro_path, serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(target_id)
}

/// Move a folder from `src` into `<macros_root>/<sanitized_id>/`. Used by
/// "Import" when the user picks Move. Same id-reroot logic as import_copy.
pub fn import_move(app: &tauri::AppHandle, src: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(src.join("macro.json")).map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("invalid macro.json: {e}"))?;
    let base_id = parsed
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "macro.json missing id field".to_string())?
        .to_string();
    let target_id = next_unique_id(app, &base_id);
    let target = macro_dir(app, &target_id)?;
    if target.exists() {
        return Err(format!("target {} already exists", target.display()));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(src, &target).map_err(|e| e.to_string())?;
    let macro_path = target.join("macro.json");
    if macro_path.exists() {
        if let Ok(mut json) = serde_json::from_str::<Value>(&fs::read_to_string(&macro_path).map_err(|e| e.to_string())?) {
            if let Some(obj) = json.as_object_mut() {
                obj.insert("id".into(), Value::String(target_id.clone()));
            }
            let _ = fs::write(&macro_path, serde_json::to_string_pretty(&json).unwrap_or_default());
        }
    }
    Ok(target_id)
}

/// Bump the id suffix until no folder with that name exists.
fn next_unique_id(app: &tauri::AppHandle, base: &str) -> String {
    let root = match macros_root(app) {
        Ok(r) => r,
        Err(_) => return base.to_string(),
    };
    if !root.join(sanitize_id(base)).exists() {
        return base.to_string();
    }
    for n in 2..10_000 {
        let candidate = format!("{}-{}", base, n);
        if !root.join(sanitize_id(&candidate)).exists() {
            return candidate;
        }
    }
    format!("{}-{}", base, chrono_like_now())
}

fn chrono_like_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
