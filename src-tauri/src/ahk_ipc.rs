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
