use std::sync::atomic::{AtomicIsize, Ordering};

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, CreatePen, DeleteObject, EndPaint, GetStockObject, HOLLOW_BRUSH, PAINTSTRUCT,
    Rectangle, SelectObject, PS_SOLID,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, SetWindowPos, ShowWindow,
    CS_HREDRAW, CS_VREDRAW, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_SHOWWINDOW, SW_SHOW, WM_ERASEBKGND, WM_PAINT, WNDCLASSW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP, WS_VISIBLE,
};

static OVERLAY_HWND: AtomicIsize = AtomicIsize::new(0);
static CLASS_REGISTERED: std::sync::Once = std::sync::Once::new();

const CLASS_NAME: &str = "ProjectMRegionOverlay";

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_ERASEBKGND {
        return 1;
    }
    if msg == WM_PAINT {
        let mut ps: PAINTSTRUCT = std::mem::zeroed();
        let hdc = BeginPaint(hwnd, &mut ps);
        let pen = CreatePen(PS_SOLID, 6, 0x00FF66);
        let old_pen = SelectObject(hdc, pen as _);
        let old_brush = SelectObject(hdc, GetStockObject(HOLLOW_BRUSH) as _);
        let r: RECT = ps.rcPaint;
        Rectangle(hdc, r.left, r.top, r.right, r.bottom);
        SelectObject(hdc, old_brush);
        SelectObject(hdc, old_pen);
        DeleteObject(pen as _);
        EndPaint(hwnd, &mut ps);
        return 0;
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn register_class_once() {
    CLASS_REGISTERED.call_once(|| {
        unsafe {
            let class_w: Vec<u16> = CLASS_NAME
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let hinstance = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance,
                lpszClassName: class_w.as_ptr(),
                style: CS_HREDRAW | CS_VREDRAW,
                hbrBackground: GetStockObject(HOLLOW_BRUSH) as _,
                ..std::mem::zeroed()
            };
            RegisterClassW(&wc);
        }
    });
}

pub fn show_overlay(x1: i32, y1: i32, x2: i32, y2: i32) -> Result<(), String> {
    register_class_once();
    hide_overlay();

    let x = x1.min(x2);
    let y = y1.min(y2);
    let w = (x1 - x2).abs().max(2) as i32;
    let h = (y1 - y2).abs().max(2) as i32;

    unsafe {
        let class_w: Vec<u16> = CLASS_NAME
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let hinstance = GetModuleHandleW(std::ptr::null());
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class_w.as_ptr(),
            std::ptr::null(),
            WS_POPUP | WS_VISIBLE,
            x,
            y,
            w,
            h,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinstance,
            std::ptr::null(),
        );

        if hwnd.is_null() {
            return Err("Failed to create overlay window".to_string());
        }

        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
        ShowWindow(hwnd, SW_SHOW);
        OVERLAY_HWND.store(hwnd as isize, Ordering::SeqCst);
    }
    Ok(())
}

pub fn hide_overlay() {
    let raw = OVERLAY_HWND.swap(0, Ordering::SeqCst);
    if raw != 0 {
        unsafe {
            DestroyWindow(raw as HWND);
        }
    }
}