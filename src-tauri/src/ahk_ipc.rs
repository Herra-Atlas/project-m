use std::ptr;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;

const WINDOW_TITLE: &str = "AHK_IPC";

fn title_wide() -> [u16; 9] {
    let mut buf = [0u16; 9];
    let mut i = 0;
    for c in WINDOW_TITLE.encode_utf16() {
        buf[i] = c;
        i += 1;
    }
    buf[i] = 0;
    buf
}

pub fn is_listening() -> bool {
    let title = title_wide();
    let hwnd: HWND = unsafe { FindWindowW(ptr::null(), title.as_ptr()) };
    !hwnd.is_null()
}

/// Close the AHK IPC listener when Project M exits. Works whether the
/// listener was spawned by the app (`start_ipc_listener`) or opened
/// manually by double-clicking the `.ahk` script — both register the
/// same `AHK_IPC` window. Asks nicely with `WM_CLOSE` first, then
/// terminates the owner process if it is still around.
pub fn close_listener() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowThreadProcessId, PostMessageW, WM_CLOSE,
    };

    let title = title_wide();
    let hwnd: HWND = unsafe { FindWindowW(ptr::null(), title.as_ptr()) };
    if hwnd.is_null() {
        return;
    }
    unsafe {
        PostMessageW(hwnd, WM_CLOSE, 0, 0);
        std::thread::sleep(std::time::Duration::from_millis(400));
        let title = title_wide();
        if !FindWindowW(ptr::null(), title.as_ptr()).is_null() {
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != 0 && pid != std::process::id() {
                kill_pid(pid);
            }
        }
    }
}

/// Best-effort terminate of a process we started (e.g. the listener
/// child PID we stored at spawn time).
pub fn kill_pid(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, TerminateProcess, PROCESS_TERMINATE,
    };

    if pid == 0 || pid == std::process::id() {
        return;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if !handle.is_null() {
            TerminateProcess(handle, 0);
            CloseHandle(handle);
            log::info!("Terminated leftover listener process (pid {pid})");
        }
    }
}
