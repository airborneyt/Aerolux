use tauri::Manager;
use tauri::Emitter;
use tauri::WindowEvent;

mod llama_download;
mod llama_server;
mod llama_chat;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
 
static QUITTING: AtomicBool = AtomicBool::new(false);

use midir::{MidiOutput, MidiOutputConnection};

mod menu;

mod hardware;

struct MidiState {
    connection: Option<MidiOutputConnection>,
}

// Each Tauri command below operates on this shared state.
// Register all commands in invoke_handler.

#[tauri::command]
fn confirm_quit(app: tauri::AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);

    if let Some(state) = app.try_state::<std::sync::Mutex<llama_server::LlamaServerState>>() {
        if let Ok(mut guard) = state.lock() {
            guard.stop();
        }
    }
}

#[tauri::command]
fn midi_list_devices() -> Vec<String> {
    let output = MidiOutput::new("aerolux").unwrap();
    output.ports().iter().filter_map(|p| output.port_name(p).ok()).collect()
}

#[tauri::command]
fn midi_connect(state: tauri::State<Mutex<MidiState>>, device_id: String) -> Result<(), String> {
    let output = MidiOutput::new("aerolux").map_err(|e| e.to_string())?;
    let port   = output.ports().into_iter()
        .find(|p| output.port_name(p).unwrap_or_default() == device_id)
        .ok_or("Device not found")?;
    let conn = output.connect(&port, "aerolux-out").map_err(|e| e.to_string())?;
    state.lock().unwrap().connection = Some(conn);
    Ok(())
}

#[tauri::command]
fn midi_send_pad_state(
    state: tauri::State<Mutex<MidiState>>,
    pads: Vec<serde_json::Value>,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let conn = guard.connection.as_mut().ok_or("Not connected")?;
    let mut msg = vec![0xF0u8, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0B];
    for pad in &pads {
        msg.push(pad["note"].as_u64().unwrap_or(0) as u8);
        msg.push(pad["r"].as_u64().unwrap_or(0) as u8);
        msg.push(pad["g"].as_u64().unwrap_or(0) as u8);
        msg.push(pad["b"].as_u64().unwrap_or(0) as u8);
    }
    msg.push(0xF7);
    conn.send(&msg).map_err(|e| e.to_string())
}

#[tauri::command]
fn midi_send_raw_sysex(data: Vec<u8>, state: tauri::State<Mutex<MidiState>>) -> Result<(), String> {
    let mut lock = state.lock().unwrap();
    let conn = lock.connection.as_mut().ok_or("Not connected")?;
    conn.send(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn midi_list_outputs() -> Vec<String> {
    let Ok(midi_out) =
        midir::MidiOutput::new("aerolux-enum")
    else {
        return Vec::new();
    };

    midi_out
        .ports()
        .iter()
        .filter_map(|p| midi_out.port_name(p).ok())
        .collect()
}

#[tauri::command]
fn midi_clear_pads(state: tauri::State<Mutex<MidiState>>) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let conn = guard.connection.as_mut().ok_or("Not connected")?;
    let mut msg = vec![0xF0u8, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0B];
    for r in 1u8..=8 { for c in 1u8..=8 { msg.extend_from_slice(&[r*10+c, 0, 0, 0]); } }
    msg.push(0xF7);
    conn.send(&msg).map_err(|e| e.to_string())
}

#[tauri::command]
fn check_vibrancy() -> bool {
    #[cfg(target_os = "macos")]   { true  }
    #[cfg(target_os = "windows")] { true  }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))] { false }
}

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(std::sync::Mutex::new(MidiState { connection: None }))
        .manage(llama_server::init_state())
        .manage(llama_chat::init_abort_registry())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // macOS: hide instead of destroy on window close
            // closing the last window should not quit the app on macos
            // the process stays alive (dock icon remains)
            // windows/linux are unaffected;
            // their window-close already means "quit," which is correct
            // there and is left alone
            //
            // QUITTING distinguishes "real, already-confirmed quit in
            // progress" (let the close proceed) from "user just clicked
            // the red button / pressed cmd+w" (hide instead). this is
            // the ONLY close handler registered for this window
            // on_window_event replaces any previously-registered closure
            // rather than stacking, so there must never be a second one
            #[cfg(target_os = "macos")]
            {
                let window_for_event = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if QUITTING.load(Ordering::SeqCst) {
                            return;
                        }
                        api.prevent_close();
                        let _ = window_for_event.hide();
                    }
                });

                let result = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::HudWindow,
                    None,
                    None,
                );
                if result.is_err() {
                    // vibrancy failed: js will add .no-vibrancy to body
                    // css fallback: body.no-vibrancy uses --color-bg-solid
                    eprintln!("Vibrancy not available: {:?}", result);
                }
            }

            #[cfg(target_os = "windows")]
            {
                let _ = apply_mica(&window, Some(true));
            }

            menu::build(app.handle())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            confirm_quit,
            check_vibrancy,
            midi_list_devices,
            midi_connect,
            midi_send_pad_state,
            midi_send_raw_sysex,
            midi_clear_pads,
            midi_list_outputs,
            hardware::get_hardware_info,
            menu::set_save_menu_enabled,
            llama_server::llama_start_server,
            llama_server::llama_stop_server,
            llama_server::llama_server_status,
            llama_download::download_llama_binary,
            llama_download::download_llama_model,
            llama_download::get_llama_paths,
            llama_chat::llama_generate,
            llama_chat::llama_abort_generation
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if QUITTING.load(Ordering::SeqCst) {
                    // already confirmed and in the middle of quitting via
                    // exit() from the frontend. don't re-prompt, just let
                    // it proceed
                    return;
                }
                api.prevent_exit();
                let _ = app_handle.emit("app:exit-requested", ());
            }
            // macOS only: fires when the dock icon is clicked while
            // no windows are visible (i.e. after the hide-on-close
            // above). bring the main window back
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        }
    });
}