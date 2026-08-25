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
    let macro_path = src.join("macro.json");
    if !src.is_dir() {
        return Err(format!(
            "Source is not a folder: {}",
            src.display()
        ));
    }
    if !macro_path.is_file() {
        return Err(format!(
            "Folder does not contain macro.json — looked at {}.\nExpected layout: <folder>/macro.json + optional ai-chat.json, logs.jsonl, assets/",
            macro_path.display()
        ));
    }
    let raw = fs::read_to_string(&macro_path)
        .map_err(|e| format!("Failed to read {}: {e}", macro_path.display()))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("invalid macro.json at {}: {e}", macro_path.display()))?;
    let base_id = parsed
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| format!("macro.json at {} is missing the required `id` field", macro_path.display()))?
        .to_string();
    let target_id = next_unique_id(app, &base_id);
    let target = macro_dir(app, &target_id)?;
    if target.exists() {
        return Err(format!(
            "target {} already exists (id collision after rename)",
            target.display()
        ));
    }
    copy_dir_recursive(src, &target)?;
    let macro_path = target.join("macro.json");
    let mut json: Value =
        serde_json::from_str(&fs::read_to_string(&macro_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if let Some(obj) = json.as_object_mut() {
        obj.insert("id".into(), Value::String(target_id.clone()));
    }
    fs::write(
        &macro_path,
        serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(target_id)
}

/// Move a folder from `src` into `<macros_root>/<sanitized_id>/`. Used by
/// "Import" when the user picks Move. Same id-reroot logic as import_copy.
pub fn import_move(app: &tauri::AppHandle, src: &Path) -> Result<String, String> {
    let macro_path = src.join("macro.json");
    if !src.is_dir() {
        return Err(format!(
            "Source is not a folder: {}",
            src.display()
        ));
    }
    if !macro_path.is_file() {
        return Err(format!(
            "Folder does not contain macro.json — looked at {}.\nExpected layout: <folder>/macro.json + optional ai-chat.json, logs.jsonl, assets/",
            macro_path.display()
        ));
    }
    let raw = fs::read_to_string(&macro_path)
        .map_err(|e| format!("Failed to read {}: {e}", macro_path.display()))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("invalid macro.json at {}: {e}", macro_path.display()))?;
    let base_id = parsed
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| format!("macro.json at {} is missing the required `id` field", macro_path.display()))?
        .to_string();
    let target_id = next_unique_id(app, &base_id);
    let target = macro_dir(app, &target_id)?;
    if target.exists() {
        return Err(format!(
            "target {} already exists (id collision after rename)",
            target.display()
        ));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(src, &target).map_err(|e| e.to_string())?;
    let macro_path = target.join("macro.json");
    if macro_path.exists() {
        if let Ok(mut json) =
            serde_json::from_str::<Value>(&fs::read_to_string(&macro_path).map_err(|e| e.to_string())?)
        {
            if let Some(obj) = json.as_object_mut() {
                obj.insert("id".into(), Value::String(target_id.clone()));
            }
            let _ = fs::write(
                &macro_path,
                serde_json::to_string_pretty(&json).unwrap_or_default(),
            );
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

/// Locate the on-disk path of the bundled `tools/presets/` directory.
/// Probes several candidate locations so we don't break when the
/// installer stage dir (`_up_`) exists alongside the real install path.
pub fn bundled_presets_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join("presets"));
        candidates.push(resource_dir.join("presets"));
    }
    // Tauri 2 NSIS layout: <install_root>/resources/tools/presets
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("tools").join("presets"));
            candidates.push(dir.join("..").join("resources").join("tools").join("presets"));
            // Dev runs from src-tauri/target/<profile>/.
            candidates.push(
                dir.join("..")
                    .join("..")
                    .join("..")
                    .join("tools")
                    .join("presets"),
            );
            // Some Tauri versions stage under _up_ during in-place upgrade.
            candidates.push(dir.join("_up_").join("tools").join("presets"));
            candidates.push(
                dir.join("..")
                    .join("_up_")
                    .join("tools")
                    .join("presets"),
            );
        }
    }
    candidates
        .into_iter()
        .find(|p| p.is_dir())
        .ok_or_else(|| {
            "Bundled presets directory not found. Reinstall the app or import macros manually.".to_string()
        })
}

/// Import every macro folder under the bundled `presets/` directory.
/// Each subfolder must contain a `macro.json`. Folders whose id already
/// exists locally are skipped (no overwrite). Returns the list of
/// imported macro titles (or skipped ids).
#[derive(serde::Serialize)]
pub struct PresetImportResult {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<String>,
    pub source: String,
}

pub fn import_bundled_presets(app: &tauri::AppHandle) -> Result<PresetImportResult, String> {
    let presets_root = bundled_presets_dir(app)?;
    let source_str = presets_root.to_string_lossy().to_string();

    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();

    let entries = fs::read_dir(&presets_root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let macro_json = path.join("macro.json");
        if !macro_json.is_file() {
            continue;
        }
        // Quick peek: skip if id already present in local library.
        let raw = match fs::read_to_string(&macro_json) {
            Ok(s) => s,
            Err(e) => {
                failed.push(format!("{}: read error {e}", entry.file_name().to_string_lossy()));
                continue;
            }
        };
        let parsed: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                failed.push(format!("{}: invalid JSON {e}", entry.file_name().to_string_lossy()));
                continue;
            }
        };
        let base_id = match parsed.get("id").and_then(|x| x.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => {
                failed.push(format!(
                    "{}: missing `id` field",
                    entry.file_name().to_string_lossy()
                ));
                continue;
            }
        };
        if macro_exists(app, &base_id).unwrap_or(false) {
            skipped.push(base_id);
            continue;
        }

        let target_id = next_unique_id(app, &base_id);
        let target = macro_dir(app, &target_id)?;
        if target.exists() {
            skipped.push(base_id);
            continue;
        }
        if let Err(e) = copy_dir_recursive(&path, &target) {
            failed.push(format!("{base_id}: copy failed {e}"));
            continue;
        }
        // Re-stamp the id inside macro.json.
        let target_macro = target.join("macro.json");
        if let Ok(mut json) = serde_json::from_str::<Value>(
            &fs::read_to_string(&target_macro).unwrap_or_default(),
        ) {
            if let Some(obj) = json.as_object_mut() {
                obj.insert("id".into(), Value::String(target_id.clone()));
            }
            let _ = fs::write(
                &target_macro,
                serde_json::to_string_pretty(&json).unwrap_or_default(),
            );
        }
        let title = parsed
            .get("title")
            .and_then(|x| x.as_str())
            .unwrap_or(&base_id)
            .to_string();
        imported.push(title);
    }

    Ok(PresetImportResult {
        imported,
        skipped,
        failed,
        source: source_str,
    })
}
