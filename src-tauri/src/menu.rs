// ════════════════════════════════════════════════════════════════════
// menu.rs
// Native File menu (New / Open / Save / Save As) and Quit handling.
//
// IMPORTANT: Quit is a CUSTOM menu item (not PredefinedMenuItem::quit),
// specifically so it routes through on_menu_event like everything
// else rather than triggering macOS's native termination sequence
// directly. PredefinedMenuItem::quit() bypasses RunEvent entirely on
// macOS, which is why the unsaved-changes prompt never fired when it
// was used — Cmd+Q never reached our Rust event handlers at all.
//
// Add `mod menu;` near the top of lib.rs and call menu::build(app)
// inside the .setup() closure.
// ════════════════════════════════════════════════════════════════════

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// Builds and sets the application menu. Call once during .setup().
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let new_item = MenuItem::with_id(app, "menu_new", "New…", true, Some("CmdOrCtrl+N"))?;
    let open_item = MenuItem::with_id(app, "menu_open", "Open…", true, Some("CmdOrCtrl+O"))?;
    let save_item = MenuItem::with_id(app, "menu_save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as_item = MenuItem::with_id(
        app,
        "menu_save_as",
        "Save As…",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_item,
            &open_item,
            &PredefinedMenuItem::separator(app)?,
            &save_item,
            &save_as_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Close Window"))?,
        ],
    )?;

    // Custom Quit item — deliberately NOT PredefinedMenuItem::quit().
    // CmdOrCtrl+Q is bound manually here so it routes through
    // on_menu_event below, same as every other menu action, instead
    // of triggering the OS's native quit sequence directly and
    // skipping our RunEvent::ExitRequested handling.
    let quit_item = MenuItem::with_id(app, "menu_quit", "Quit Aerolux", true, Some("CmdOrCtrl+Q"))?;

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "Aerolux",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(app, &[&app_menu, &file_menu])?;

    // On Windows/Linux there's no separate app menu — put Quit at
    // the end of File, which is the platform convention there.
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(
        app,
        &[&file_menu, &PredefinedMenuItem::separator(app)?, &quit_item],
    )?;

    app.set_menu(menu)?;

    // Forward menu clicks to the frontend as plain events. The frontend
    // owns all the actual logic (dirty checks, dialogs, store calls) —
    // Rust's job here is just "a menu item was clicked, here's which one."
    app.on_menu_event(move |app_handle, event| {
        let id = event.id().0.as_str();
        match id {
            "menu_new" => { let _ = app_handle.emit("menu:new", ()); }
            "menu_open" => { let _ = app_handle.emit("menu:open", ()); }
            "menu_save" => { let _ = app_handle.emit("menu:save", ()); }
            "menu_save_as" => { let _ = app_handle.emit("menu:save-as", ()); }
            // Quit now goes through the exact same path as Cmd+Q used
            // to be assumed to (and as window-close already does via
            // RunEvent::ExitRequested for non-menu-triggered quits,
            // e.g. if a future Linux build's window manager sends a
            // termination signal some other way).
            "menu_quit" => { let _ = app_handle.emit("app:exit-requested", ()); }
            _ => {}
        }
    });

    Ok(())
}

/// Enables/disables Save and Save As. Called from a frontend-invoked
/// command whenever projects.currentType changes between null and a
/// real type, so the menu reflects "is anything open right now."
#[tauri::command]
pub fn set_save_menu_enabled<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    if let Some(menu) = app.menu() {
        if let Some(item) = menu.get("menu_save") {
            if let Some(menu_item) = item.as_menuitem() {
                let _ = menu_item.set_enabled(enabled);
            }
        }
        if let Some(item) = menu.get("menu_save_as") {
            if let Some(menu_item) = item.as_menuitem() {
                let _ = menu_item.set_enabled(enabled);
            }
        }
    }
    Ok(())
}