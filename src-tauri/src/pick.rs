use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct PickEvent {
    x: i32,
    y: i32,
    hex: String,
    count: u32,
}

static PICKING: AtomicBool = AtomicBool::new(false);
static PICK_COUNT: AtomicU32 = AtomicU32::new(0);
static PICK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

const WH_MOUSE_LL: i32 = 14;
const HC_ACTION: i32 = 0;
const WM_RBUTTONDOWN: usize = 0x0204;
const WM_QUIT: u32 = 0x0012;

#[repr(C)]
#[derive(Clone, Copy)]
struct MSLLHOOKSTRUCT {
    pt: POINT,
    mouse_data: u32,
    flags: u32,
    time: u32,
    dw_extra_info: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct POINT {
    x: i32,
    y: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MSG {
    hwnd: isize,
    message: u32,
    w_param: usize,
    l_param: isize,
    time: u32,
    pt: POINT,
}

unsafe extern "system" {
    fn SetWindowsHookExW(
        id_hook: i32,
        lpfn: Option<unsafe extern "system" fn(i32, usize, isize) -> isize>,
        h_mod: isize,
        dw_thread_id: u32,
    ) -> isize;
    fn UnhookWindowsHookEx(hhk: isize) -> i32;
    fn CallNextHookEx(hhk: isize, n_code: i32, w_param: usize, l_param: isize) -> isize;
    fn GetMessageW(lp_msg: *mut MSG, h_wnd: isize, w_msg_filter_min: u32, w_msg_filter_max: u32) -> i32;
    fn TranslateMessage(lp_msg: *const MSG) -> i32;
    fn DispatchMessageW(lp_msg: *const MSG) -> isize;
    fn PostThreadMessageW(id_thread: u32, msg: u32, w_param: usize, l_param: isize) -> i32;
    fn GetCurrentThreadId() -> u32;
}

#[tauri::command]
pub fn start_pixel_pick(app: AppHandle) -> Result<(), String> {
    if PICKING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    PICK_COUNT.store(0, Ordering::SeqCst);
    {
        let mut guard = APP_HANDLE.lock().map_err(|e| e.to_string())?;
        *guard = Some(app);
    }

    thread::spawn(move || unsafe {
        let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), 0, 0);
        if hook == 0 {
            PICKING.store(false, Ordering::SeqCst);
            return;
        }
        let tid = GetCurrentThreadId();
        PICK_THREAD_ID.store(tid, Ordering::SeqCst);

        let mut msg: MSG = std::mem::zeroed();
        while PICKING.load(Ordering::SeqCst) {
            let r = GetMessageW(&mut msg, 0, 0, 0);
            if r <= 0 || msg.message == WM_QUIT {
                break;
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        UnhookWindowsHookEx(hook);
        PICK_THREAD_ID.store(0, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
pub fn stop_pixel_pick() -> Result<(), String> {
    if !PICKING.load(Ordering::SeqCst) {
        return Ok(());
    }
    PICKING.store(false, Ordering::SeqCst);
    let tid = PICK_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            PostThreadMessageW(tid, WM_QUIT, 0, 0);
        }
    }
    {
        let mut guard = APP_HANDLE.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }
    Ok(())
}

unsafe extern "system" fn mouse_proc(code: i32, w_param: usize, l_param: isize) -> isize {
    if code == HC_ACTION && PICKING.load(Ordering::SeqCst) && w_param == WM_RBUTTONDOWN {
        let msl = &*(l_param as *const MSLLHOOKSTRUCT);
        let x = msl.pt.x;
        let y = msl.pt.y;
        let count = PICK_COUNT.fetch_add(1, Ordering::SeqCst) + 1;
        let hex = capture_color(x, y);

        if let Ok(guard) = APP_HANDLE.lock() {
            if let Some(app) = guard.as_ref() {
                let payload = PickEvent { x, y, hex, count };
                let _ = app.emit("pick-pixel", payload);
            }
        }

        if count >= 2 {
            PICKING.store(false, Ordering::SeqCst);
            let tid = PICK_THREAD_ID.load(Ordering::SeqCst);
            if tid != 0 {
                PostThreadMessageW(tid, WM_QUIT, 0, 0);
            }
        }

        return 1;
    }
    CallNextHookEx(0, code, w_param, l_param)
}

fn capture_color(x: i32, y: i32) -> String {
    unsafe {
        use windows_sys::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
        use windows_sys::Win32::UI::WindowsAndMessaging::HWND_DESKTOP;
        let hdc = GetDC(HWND_DESKTOP);
        if hdc.is_null() {
            return "#FFFFFF".to_string();
        }
        let c = GetPixel(hdc, x, y);
        ReleaseDC(HWND_DESKTOP, hdc);
        let r = (c & 0xFF) as u8;
        let g = ((c >> 8) & 0xFF) as u8;
        let b = ((c >> 16) & 0xFF) as u8;
        format!("#{:02X}{:02X}{:02X}", r, g, b)
    }
}