use enigo::{Enigo, Key, KeyboardControllable, MouseButton, MouseControllable};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateCompatibleBitmap, SelectObject, BitBlt,
    GetDIBits, BITMAPINFOHEADER, BITMAPINFO, SRCCOPY, DIB_RGB_COLORS,
    DeleteObject, DeleteDC, GetDC, ReleaseDC
};
use windows_sys::Win32::UI::WindowsAndMessaging::HWND_DESKTOP;
use std::cell::RefCell;
use std::mem::MaybeUninit;

pub struct Input {
    enigo: Enigo,
}

impl Input {
    pub fn new() -> Self {
        Self {
            enigo: Enigo::new(),
        }
    }

    pub fn mouse_move(&mut self, x: i32, y: i32) {
        let _ = self.enigo.mouse_move_to(x, y);
    }

    pub fn mouse_click(&mut self, button: &str, count: u32) {
        let btn = match button {
            "right" => MouseButton::Right,
            "middle" => MouseButton::Middle,
            _ => MouseButton::Left,
        };
        for _ in 0..count {
            let _ = self.enigo.mouse_click(btn);
        }
    }

    pub fn mouse_down(&mut self, button: &str) {
        let btn = match button {
            "right" => MouseButton::Right,
            "middle" => MouseButton::Middle,
            _ => MouseButton::Left,
        };
        let _ = self.enigo.mouse_down(btn);
    }

    pub fn mouse_up(&mut self, button: &str) {
        let btn = match button {
            "right" => MouseButton::Right,
            "middle" => MouseButton::Middle,
            _ => MouseButton::Left,
        };
        let _ = self.enigo.mouse_up(btn);
    }

    pub fn key_press(&mut self, key: &str) {
        let k = Self::parse_key(key);
        let _ = self.enigo.key_click(k);
    }

    pub fn key_down(&mut self, key: &str) {
        let k = Self::parse_key(key);
        let _ = self.enigo.key_down(k);
    }

    pub fn key_up(&mut self, key: &str) {
        let k = Self::parse_key(key);
        let _ = self.enigo.key_up(k);
    }

    pub fn get_pixel_color(x: i32, y: i32) -> Result<String, String> {
        let screen = screenshots::Screen::from_point(x, y).map_err(|e| e.to_string())?;
        let info = screen.display_info;
        let image = screen
            .capture_area(x - info.x, y - info.y, 1, 1)
            .map_err(|e| e.to_string())?;
        let pixel = image.get_pixel(0, 0);
        Ok(format!("#{:02X}{:02X}{:02X}", pixel[0], pixel[1], pixel[2]))
    }

    pub fn capture_region(x: i32, y: i32, w: u32, h: u32) -> Result<Vec<u8>, String> {
        capture_region_cached(x, y, w, h)
    }

    pub fn type_text(&mut self, text: &str) {
        for ch in text.chars() {
            let _ = self.enigo.key_click(Key::Layout(ch));
        }
    }

    fn parse_key(key: &str) -> Key {
        match key.to_lowercase().as_str() {
            "enter" => Key::Return,
            "space" => Key::Space,
            "tab" => Key::Tab,
            "escape" | "esc" => Key::Escape,
            "backspace" => Key::Backspace,
            "delete" => Key::Delete,
            "up" => Key::UpArrow,
            "down" => Key::DownArrow,
            "left" => Key::LeftArrow,
            "right" => Key::RightArrow,
            "shift" => Key::Shift,
            "ctrl" | "control" => Key::Control,
            "alt" => Key::Alt,
            "meta" | "win" | "command" => Key::Meta,
            "f1" => Key::F1,
            "f2" => Key::F2,
            "f3" => Key::F3,
            "f4" => Key::F4,
            "f5" => Key::F5,
            "f6" => Key::F6,
            "f7" => Key::F7,
            "f8" => Key::F8,
            "f9" => Key::F9,
            "f10" => Key::F10,
            "f11" => Key::F11,
            "f12" => Key::F12,
            _ => {
                if key.len() == 1 {
                    Key::Layout(key.chars().next().unwrap())
                } else {
                    Key::Return
                }
            }
        }
    }
}

// ============================================================================
// Cached capture_region. GDI's CreateCompatibleDC / CreateCompatibleBitmap /
// SelectObject / BitBlt / GetDIBits cycle allocates fresh handles every call,
// which dominates the cost of a 20x20 capture (~5 ms each). Reusing them
// across scans in the same thread drops steady-state cost to <1 ms — the
// BitBlt + GetDIBits alone. The cache is per-thread (the engine thread and
// each pixel-watch background thread get their own), invalidated when (w, h)
// changes or the previous allocation failed.
// ============================================================================

struct CaptureCtx {
    hdc: *mut std::ffi::c_void,
    mem_dc: *mut std::ffi::c_void,
    bitmap: *mut std::ffi::c_void,
    old_bitmap: *mut std::ffi::c_void,
    w: i32,
    h: i32,
    pixels: Vec<u8>,
}

thread_local! {
    static CAPTURE_CTX: RefCell<Option<CaptureCtx>> = const { RefCell::new(None) };
}

fn dispose_ctx(ctx: &mut CaptureCtx) {
    unsafe {
        if !ctx.bitmap.is_null() {
            SelectObject(ctx.mem_dc, ctx.old_bitmap);
            DeleteObject(ctx.bitmap);
        }
        if !ctx.mem_dc.is_null() {
            DeleteDC(ctx.mem_dc);
        }
        if !ctx.hdc.is_null() {
            ReleaseDC(HWND_DESKTOP, ctx.hdc);
        }
    }
}

fn capture_region_cached(x: i32, y: i32, w: u32, h: u32) -> Result<Vec<u8>, String> {
    CAPTURE_CTX.with(|cell| {
        let mut slot = cell.borrow_mut();
        let wi = w as i32;
        let hi = h as i32;
        let stride = (((w * 3 + 3) / 4) * 4) as usize;

        // (Re)allocate if dimensions changed or the previous attempt failed.
        let needs_init = match slot.as_ref() {
            Some(c) => c.w != wi || c.h != hi || c.hdc.is_null() || c.mem_dc.is_null() || c.bitmap.is_null(),
            None => true,
        };
        if needs_init {
            if let Some(mut old) = slot.take() {
                dispose_ctx(&mut old);
            }
            unsafe {
                let hdc = GetDC(HWND_DESKTOP);
                if hdc.is_null() {
                    return Err("GetDC failed".to_string());
                }
                let mem_dc = CreateCompatibleDC(hdc);
                if mem_dc.is_null() {
                    ReleaseDC(HWND_DESKTOP, hdc);
                    return Err("CreateCompatibleDC failed".to_string());
                }
                let bitmap = CreateCompatibleBitmap(hdc, wi, hi);
                if bitmap.is_null() {
                    DeleteDC(mem_dc);
                    ReleaseDC(HWND_DESKTOP, hdc);
                    return Err("CreateCompatibleBitmap failed".to_string());
                }
                let old_bitmap = SelectObject(mem_dc, bitmap);
                slot.replace(CaptureCtx {
                    hdc: hdc as *mut _,
                    mem_dc: mem_dc as *mut _,
                    bitmap: bitmap as *mut _,
                    old_bitmap: old_bitmap as *mut _,
                    w: wi,
                    h: hi,
                    pixels: vec![0u8; stride * h as usize],
                });
            }
        }

        let ctx = slot.as_mut().expect("capture ctx just initialized");
        unsafe {
            // CAPTUREBLT (0x40000000) is required to include hardware-
            // accelerated content (DirectX, OpenGL, layered DWM windows).
            // Without it, BitBlt from HWND_DESKTOP returns only the GDI
            // desktop layer — modern games render to a GPU surface that
            // BitBlt alone cannot see. This is the difference between a
            // pixel-scan that returns the actual game pixels and one that
            // captures only the desktop background.
            const CAPTUREBLT: u32 = 0x4000_0000;
            if BitBlt(
                ctx.mem_dc, 0, 0, wi, hi,
                ctx.hdc, x, y,
                SRCCOPY | CAPTUREBLT,
            ) == 0
            {
                return Err("BitBlt failed".to_string());
            }

            let mut bmi = MaybeUninit::<BITMAPINFO>::zeroed();
            let bmi_ptr = bmi.as_mut_ptr();
            (*bmi_ptr).bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            (*bmi_ptr).bmiHeader.biWidth = wi;
            (*bmi_ptr).bmiHeader.biHeight = -hi;
            (*bmi_ptr).bmiHeader.biPlanes = 1;
            (*bmi_ptr).bmiHeader.biBitCount = 24;
            (*bmi_ptr).bmiHeader.biCompression = 0;

            let lines = GetDIBits(
                ctx.mem_dc,
                ctx.bitmap,
                0,
                h,
                ctx.pixels.as_mut_ptr() as *mut _,
                bmi_ptr,
                DIB_RGB_COLORS,
            );
            if lines == 0 {
                return Err("GetDIBits failed".to_string());
            }
            Ok(ctx.pixels.clone())
        }
    })
}


