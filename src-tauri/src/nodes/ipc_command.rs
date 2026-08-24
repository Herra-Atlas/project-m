use crate::engine::Engine;
use crate::macro_data::Node;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr;
use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, SendMessageW, WM_COPYDATA};

#[repr(C)]
struct CopyDataStruct {
    dw_data: usize,
    cb_data: u32,
    lp_data: *mut std::ffi::c_void,
}

pub async fn run(node: &Node, engine: Engine) -> Result<Vec<String>, String> {
    let command = field_str(node, "command");
    if command.is_empty() {
        engine.set_output(&node.id, "status", serde_json::json!("error"));
        return Ok(engine.outgoing(&node.id));
    }

    match send_ipc(&command) {
        Ok(_) => {
            engine.set_output(&node.id, "status", serde_json::json!("sent"));
        }
        Err(_) => {
            engine.set_output(&node.id, "status", serde_json::json!("error"));
        }
    }

    Ok(engine.outgoing(&node.id))
}

fn send_ipc(command: &str) -> Result<(), String> {
    let window_title: Vec<u16> = OsStr::new("AHK_IPC")
        .encode_wide()
        .chain(Some(0))
        .collect();

    let hwnd = unsafe { FindWindowW(ptr::null(), window_title.as_ptr()) };
    if hwnd.is_null() {
        return Err("AHK IPC window not found".to_string());
    }

    let command_utf16: Vec<u16> = command.encode_utf16().chain(Some(0)).collect();
    let byte_len = (command_utf16.len() * 2) as u32;

    let leaked = Box::leak(command_utf16.into_boxed_slice());
    let data_ptr = leaked.as_ptr() as *mut std::ffi::c_void;

    let cds = CopyDataStruct {
        dw_data: 0,
        cb_data: byte_len,
        lp_data: data_ptr,
    };

    unsafe {
        SendMessageW(hwnd, WM_COPYDATA, 0, &cds as *const _ as isize);
    }

    Ok(())
}

fn field_str(node: &Node, key: &str) -> String {
    node.fields
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

