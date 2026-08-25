mod ahk_ipc;
mod engine;
mod input;
mod kilo;
mod macro_data;
mod macros_fs;
mod nodes;
mod overlay;
mod pick;

use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use tauri::State;
use tauri::Manager;
use tauri::Emitter;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use engine::Engine;
use macro_data::MacroData;

struct AppState {
    engine_handle: Arc<Mutex<Option<EngineHandle>>>,
    generation: std::sync::atomic::AtomicU64,
    running_macro_id: Arc<Mutex<Option<String>>>,
}

struct EngineHandle {
    stop_requested: Arc<AtomicBool>,
    generation: u64,
    join: Option<JoinHandle<()>>,
}

fn next_generation(state: &AppState) -> u64 {
    state.generation.fetch_add(1, Ordering::SeqCst) + 1
}

#[tauri::command]
fn run_macro(state: State<AppState>, id: String, data: MacroData, app_handle: tauri::AppHandle) -> Result<(), String> {
    let handle_ref = state.engine_handle.clone();
    let id_ref = state.running_macro_id.clone();
    let id_for_thread = id.clone();

    let prev = {
        let mut guard = handle_ref.lock().unwrap();
        guard.take()
    };
    if let Some(prev) = prev {
        prev.stop_requested.store(true, Ordering::SeqCst);
        if let Some(j) = prev.join {
            let _ = j.join();
        }
    }

    {
        let mut guard = id_ref.lock().unwrap();
        *guard = Some(id.clone());
    }
    let _ = app_handle.emit("macro-started", id.clone());

    let stop_requested = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_requested.clone();
    let app_for_engine = app_handle.clone();
    let app_for_finish = app_handle.clone();
    let handle_ref_for_thread = handle_ref.clone();
    let id_ref_for_thread = id_ref.clone();
    let id_for_finished = id_for_thread.clone();
    let generation = next_generation(&state);
    let generation_for_thread = generation;

    let join = std::thread::spawn(move || {
        let mut engine = Engine::new(stop_requested, app_for_engine);
        engine.load(data);
        let run_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            engine.run()
        }));
        match run_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => log::error!("Macro execution error: {}", e),
            Err(panic_payload) => {
                let msg = panic_payload
                    .downcast_ref::<&str>()
                    .map(|s| (*s).to_string())
                    .or_else(|| panic_payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "unknown panic".to_string());
                log::error!("Macro execution panicked: {}", msg);
            }
        }
        let mut guard = handle_ref_for_thread.lock().unwrap();
        let still_ours = guard
            .as_ref()
            .map(|h| h.generation == generation_for_thread)
            .unwrap_or(false);
        if still_ours {
            *guard = None;
        }
        let mut id_guard = id_ref_for_thread.lock().unwrap();
        let was_ours = id_guard.as_deref() == Some(id_for_thread.as_str());
        if was_ours {
            *id_guard = None;
        }
        let _ = app_for_finish.emit("macro-finished", id_for_finished.clone());
    });

    let mut guard = handle_ref.lock().unwrap();
    *guard = Some(EngineHandle {
        stop_requested: stop_clone,
        generation,
        join: Some(join),
    });

    Ok(())
}

#[tauri::command]
fn stop_macro(state: State<AppState>) -> Result<(), String> {
    force_stop(&state);
    Ok(())
}

/// Cooperative kill switch used by both the `stop_macro` Tauri command and the
/// global "Force Stop" hotkey handler. Sets the engine's stop flag, joins the
/// worker thread, and clears the running-macro bookkeeping. Mirrors the cleanup
/// that `run_macro` performs when a new run pre-empts the previous one.
fn force_stop(state: &AppState) {
    let prev = {
        let mut guard = state.engine_handle.lock().unwrap();
        guard.take()
    };
    if let Some(prev) = prev {
        prev.stop_requested.store(true, Ordering::SeqCst);
        if let Some(j) = prev.join {
            let _ = j.join();
        }
    }
    {
        let mut guard = state.running_macro_id.lock().unwrap();
        *guard = None;
    }
}

#[tauri::command]
fn force_stop_macro(state: State<AppState>) -> Result<(), String> {
    force_stop(&state);
    Ok(())
}

/// Register a global hotkey (parsed from a string like "ctrl+shift+k") that
/// force-stops the running macro when pressed. If a previous shortcut was
/// registered it is replaced atomically — only one force-stop keybind at a time.
#[tauri::command]
fn set_force_stop_shortcut(
    state: State<AppState>,
    app: AppHandle,
    shortcut: String,
) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;

    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        // Empty string clears the keybind.
        return Ok(());
    }

    let parsed: Shortcut = trimmed.parse().map_err(|e| format!("{:?}", e))?;

    // Clone the Arc handles we need to cooperatively stop the engine from
    // inside the callback. force_stop is a pure function over these handles.
    let engine_handle = state.engine_handle.clone();
    let running_macro_id = state.running_macro_id.clone();
    gs.on_shortcut(parsed, move |_app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            let prev = {
                let mut guard = engine_handle.lock().unwrap();
                guard.take()
            };
            if let Some(prev) = prev {
                prev.stop_requested.store(true, Ordering::SeqCst);
                if let Some(j) = prev.join {
                    let _ = j.join();
                }
            }
            {
                let mut guard = running_macro_id.lock().unwrap();
                *guard = None;
            }
        }
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove any registered force-stop global hotkey. Safe to call when nothing
/// is registered.
#[tauri::command]
fn clear_force_stop_shortcut(app: AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_running_macro_id(state: State<AppState>) -> Option<String> {
    state.running_macro_id.lock().unwrap().clone()
}

#[tauri::command]
fn is_running(state: State<AppState>) -> bool {
    let guard = state.engine_handle.lock().unwrap();
    guard.is_some()
}

#[tauri::command]
fn save_app_state(payload: String, app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let file_path = data_dir.join("state.json");
    fs::write(file_path, payload).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_app_state(app: AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = data_dir.join("state.json");
    if !file_path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_settings(payload: String, app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    fs::write(data_dir.join("settings.json"), payload).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = data_dir.join("settings.json");
    if !file_path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_macro(id: String, payload: String, app: AppHandle) -> Result<(), String> {
    macros_fs::write_macro(&app, &id, &payload)
}

#[tauri::command]
fn delete_macro_file(id: String, app: AppHandle) -> Result<(), String> {
    macros_fs::delete_macro(&app, &id)
}

#[tauri::command]
fn list_macros(app: AppHandle) -> Result<Vec<String>, String> {
    macros_fs::list_macros(&app)
}

#[tauri::command]
fn read_macro_file(id: String, app: AppHandle) -> Result<Option<String>, String> {
    macros_fs::read_macro(&app, &id)
}

#[tauri::command]
fn read_macro_chat(id: String, app: AppHandle) -> Result<String, String> {
    macros_fs::read_chat(&app, &id)
}

#[tauri::command]
fn write_macro_chat(id: String, payload: String, app: AppHandle) -> Result<(), String> {
    macros_fs::write_chat(&app, &id, &payload)
}

#[tauri::command]
fn append_macro_log(id: String, line: String, app: AppHandle) -> Result<(), String> {
    macros_fs::append_log(&app, &id, &line)
}

#[tauri::command]
fn find_macro_by_title(title: String, app: AppHandle) -> Result<Option<(String, String)>, String> {
    macros_fs::find_macro_by_title(&app, &title)
}

#[tauri::command]
fn import_macro_folder(mode: String, source: String, app: AppHandle) -> Result<String, String> {
    let src = std::path::PathBuf::from(source);
    if !src.is_dir() {
        return Err(format!("source is not a folder: {}", src.display()));
    }
    match mode.as_str() {
        "move" => macros_fs::import_move(&app, &src),
        _ => macros_fs::import_copy(&app, &src),
    }
}

#[tauri::command]
fn get_mouse_info() -> Result<(i32, i32, String), String> {
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
        use windows_sys::Win32::Graphics::Gdi::{GetPixel, GetDC, ReleaseDC};
        use windows_sys::Win32::UI::WindowsAndMessaging::HWND_DESKTOP;
        use windows_sys::Win32::Foundation::POINT;

        let mut pt: POINT = std::mem::zeroed();
        GetCursorPos(&mut pt);

        let hdc = GetDC(HWND_DESKTOP);
        let color = if hdc.is_null() {
            0xFFFFFFFF
        } else {
            let c = GetPixel(hdc, pt.x, pt.y);
            ReleaseDC(HWND_DESKTOP, hdc);
            c
        };

        let (r, g, b) = if color == 0xFFFFFFFF {
            (255, 255, 255)
        } else {
            (
                (color & 0xFF) as u8,
                ((color >> 8) & 0xFF) as u8,
                ((color >> 16) & 0xFF) as u8,
            )
        };
        let hex = format!("#{:02X}{:02X}{:02X}", r, g, b);
        Ok((pt.x, pt.y, hex))
    }
}

#[tauri::command]
fn check_ahk() -> bool {
    ahk_ipc::is_listening()
}

/// Spawn `tools/ipc-listener/ipc_listener.exe` so the frontend can offer the
/// user a one-click "start the AHK listener" path when a macro contains an
/// IPC-command node but the listener isn't running.
///
/// We probe a few candidate locations relative to the running executable
/// (dev: `src-tauri/target/debug/macro.exe`, so `../../../tools/...` resolves
/// to the project root's tools dir) and via the standard resource dir for
/// bundled builds. The first hit wins.
#[tauri::command]
fn start_ipc_listener(app: AppHandle) -> Result<(), String> {
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    let exe_name = if cfg!(windows) { "ipc_listener.exe" } else { "ipc_listener" };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // Anchor: the directory of the running exe. NSIS installs put `macro.exe`
    // directly under `%LOCALAPPDATA%\Programs\<productName>\` and stage
    // bundled resources under `<exe>/_up_/...` until the installer finishes
    // cleanup — but in some upgrade scenarios the `_up_` directory persists
    // alongside the new install.
    let mut anchors: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            anchors.push(dir.to_path_buf());
            // NSIS staging dir.
            anchors.push(dir.join("_up_"));
            // Tauri 2 resource_dir() on Windows NSIS points at the exe dir.
            anchors.push(dir.to_path_buf());
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let r = resource_dir;
        anchors.push(r.clone());
        anchors.push(r.join("_up_"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        let c = cwd;
        anchors.push(c.clone());
        anchors.push(c.join("_up_"));
    }

    // For every anchor, probe a fixed list of candidate layouts.
    for anchor in &anchors {
        candidates.push(anchor.join("tools").join("ipc-listener").join(exe_name));
        candidates.push(anchor.join("ipc-listener").join(exe_name));
        candidates.push(anchor.join("resources").join("tools").join("ipc-listener").join(exe_name));
        candidates.push(anchor.join("resources").join("ipc-listener").join(exe_name));
        candidates.push(anchor.join(exe_name));
    }

    // Dev runs from src-tauri/target/<profile>/ — `macro.exe` lives three
    // levels below the project root, so the tools dir is `../../../tools/...`.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for up in 1..=4 {
                let mut ancestor = dir.to_path_buf();
                for _ in 0..up {
                    if !ancestor.pop() {
                        break;
                    }
                }
                candidates.push(ancestor.join("tools").join("ipc-listener").join(exe_name));
            }
        }
    }

    // Log every candidate we tried so the failure message is diagnostic.
    let chosen = candidates.iter().find(|p| p.exists()).cloned();
    match chosen {
        Some(path) => {
            log::info!(
                "Starting AHK IPC listener: {} (probed {} candidates)",
                path.display(),
                candidates.len()
            );
            Command::new(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to launch {}: {}", path.display(), e))?;
            Ok(())
        }
        None => {
            // Build a diagnostic showing every path we checked, with exists/no.
            let mut lines = Vec::with_capacity(candidates.len() + 1);
            lines.push(format!(
                "Could not find {}. Probed {} candidate locations:",
                exe_name,
                candidates.len()
            ));
            for c in &candidates {
                lines.push(format!(
                    "  {} [{}]",
                    c.display(),
                    if c.exists() { "FOUND" } else { "missing" }
                ));
            }
            Err(lines.join("\n"))
        }
    }
}

/// Expose the install's data + resource directories to the frontend. Used
/// by the "Reveal in Explorer" buttons and to surface where bundled assets
/// (like ipc_listener.exe) live on disk.
#[tauri::command]
fn install_paths(app: AppHandle) -> Result<serde_json::Value, String> {
    use serde_json::json;
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    Ok(json!({
        "resource_dir": resource,
        "data_dir": data,
        "exe_path": exe,
    }))
}

#[tauri::command]
fn import_bundled_presets(app: AppHandle) -> Result<macros_fs::PresetImportResult, String> {
    macros_fs::import_bundled_presets(&app)
}

/// Returns the canonical URL of the GitHub repository that hosts updates.
/// Used by the updater UI as a fallback when the in-app install can't
/// run (e.g. signature mismatch, network error).
#[tauri::command]
fn github_repo_url() -> &'static str {
    "https://github.com/Herra-Atlas/project-m"
}

/// On NSIS in-place upgrades, staged resources can land in `<install_root>/_up_/`
/// and never get moved to the final layout if the app's `macro.exe` was
/// locked when the installer tried to copy. This command reconciles the
/// two locations so the running app sees the freshly-installed resources.
///
/// Returns the number of files moved.
#[tauri::command]
fn reconcile_nsis_up_dir() -> Result<usize, String> {
    use std::path::PathBuf;
    let mut moved = 0usize;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let install_root = exe.parent().ok_or("no parent of current_exe")?.to_path_buf();
    let up_root = install_root.join("_up_");
    if !up_root.is_dir() {
        return Ok(0);
    }

    fn move_into(parent: &std::path::Path, root: &std::path::Path) -> std::io::Result<usize> {
        let mut n = 0usize;
        if !parent.is_dir() {
            return Ok(0);
        }
        for entry in std::fs::read_dir(parent)? {
            let entry = entry?;
            let from = entry.path();
            let file_name = match entry.file_name().into_string() {
                Ok(s) => s,
                Err(_) => continue,
            };
            // Skip our own marker / lock files.
            if file_name.ends_with(".lock") || file_name == "_up_" {
                continue;
            }
            let to = root.join(&file_name);
            if to.exists() {
                // Already present at destination — remove the staged copy
                // (or replace if the staged file is newer; we keep the
                // existing file to avoid stomping user changes).
                if from.is_dir() {
                    let _ = std::fs::remove_dir_all(&from);
                } else {
                    let _ = std::fs::remove_file(&from);
                }
                continue;
            }
            if from.is_dir() {
                std::fs::rename(&from, &to)?;
            } else {
                // Ensure parent exists at destination.
                if let Some(p) = to.parent() {
                    let _ = std::fs::create_dir_all(p);
                }
                std::fs::rename(&from, &to)?;
            }
            n += 1;
        }
        Ok(n)
    }

    // Walk every direct child of _up_ (e.g. `tools`, any other top-level
    // resource dirs) and try to move it to install_root.
    for entry in std::fs::read_dir(&up_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        if !from.is_dir() {
            continue;
        }
        let dir_name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        if dir_name == "_up_" {
            continue;
        }
        let target_dir = install_root.join(&dir_name);
        let _ = std::fs::create_dir_all(&target_dir);
        match move_into(&from, &target_dir) {
            Ok(n) => moved += n,
            Err(e) => log::warn!("reconcile failed for {}: {e}", from.display()),
        }
    }

    // If _up_ is now empty, remove it.
    if let Ok(read) = std::fs::read_dir(&up_root) {
        if read.flatten().count() == 0 {
            let _ = std::fs::remove_dir(&up_root);
        }
    }

    Ok(moved)
}

#[tauri::command]
fn show_region_overlay(x1: i32, y1: i32, x2: i32, y2: i32) -> Result<(), String> {
    overlay::show_overlay(x1, y1, x2, y2)
}

#[tauri::command]
fn hide_region_overlay() {
    overlay::hide_overlay();
}

/// Re-register the Force Stop global hotkey from a stored settings string on
/// app launch. Failures are logged but non-fatal — the rest of the app still
/// works without a keybind. Must be called after AppState has been managed.
fn restore_force_stop_keybind(app: &AppHandle, shortcut: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let engine_handle = state.engine_handle.clone();
    let running_macro_id = state.running_macro_id.clone();

    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let parsed: Shortcut = shortcut.trim().parse().map_err(|e| format!("{:?}", e))?;
    gs.on_shortcut(parsed, move |_app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            let prev = {
                let mut guard = engine_handle.lock().unwrap();
                guard.take()
            };
            if let Some(prev) = prev {
                prev.stop_requested.store(true, Ordering::SeqCst);
                if let Some(j) = prev.join {
                    let _ = j.join();
                }
            }
            {
                let mut guard = running_macro_id.lock().unwrap();
                *guard = None;
            }
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            engine_handle: Arc::new(Mutex::new(None)),
            generation: std::sync::atomic::AtomicU64::new(0),
            running_macro_id: Arc::new(Mutex::new(None)),
        })
        .setup(|app| {
            // NSIS in-place upgrades can leave bundled resources staged in
            // `<install_root>/_up_/...` if the previous exe was running when
            // the installer tried to copy them. Move them into place so the
            // IPC listener and bundled-presets paths resolve. Failures are
            // logged but non-fatal — the fallback path search in
            // `start_ipc_listener` still finds them in `_up_`.
            if let Err(e) = reconcile_nsis_up_dir() {
                log::warn!("NSIS reconcile failed: {e}");
            }

            // Re-register the saved Force Stop keybind on launch so the user
            // doesn't have to reconfigure it every restart. Failures are
            // logged but non-fatal — the app still works without a keybind.
            // If the user has never set one, fall back to the default F8.
            let app_handle = app.handle().clone();
            let mut resolved_keybind: Option<String> = None;
            if let Ok(raw) = load_settings(app_handle.clone()) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if let Some(s) = parsed.get("forceStopKeybind").and_then(|v| v.as_str()) {
                        if !s.trim().is_empty() {
                            resolved_keybind = Some(s.to_string());
                        }
                    }
                }
            }
            let keybind = resolved_keybind.unwrap_or_else(|| "F8".to_string());
            if let Err(e) = restore_force_stop_keybind(&app_handle, keybind.clone()) {
                log::warn!(
                    "Failed to restore force-stop keybind '{}': {}",
                    keybind,
                    e
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![run_macro, stop_macro, force_stop_macro, set_force_stop_shortcut, clear_force_stop_shortcut, is_running, get_running_macro_id, save_app_state, load_app_state, save_settings, load_settings, save_macro, delete_macro_file, list_macros, read_macro_file, read_macro_chat, write_macro_chat, append_macro_log, find_macro_by_title, import_macro_folder, import_bundled_presets, install_paths, github_repo_url, reconcile_nsis_up_dir, get_mouse_info, check_ahk, start_ipc_listener, kilo::kilo_list_models, kilo::kilo_test_api_key, kilo::kilo_chat_stream, kilo::kilo_get_api_key, pick::start_pixel_pick, pick::stop_pixel_pick, show_region_overlay, hide_region_overlay])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    // Log every panic (including ones in tokio tasks and the Tauri event
    // loop) so the user can see what crashed instead of just seeing the
    // window vanish. Tauri's `tauri_plugin_log` already routes log::error!
    // to %LOCALAPPDATA%\com.macro.app\logs\Project M.log.
    std::panic::set_hook(Box::new(|info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_else(|| "unknown".to_string());
        let payload_str = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "non-string panic".to_string()
        };
        log::error!("PANIC at {}: {}\nBacktrace:\n{}", location, payload_str, backtrace);
    }));
    run();
}
