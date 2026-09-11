// src-tauri/src/haptics.rs
// wrapper around NSHapticFeedbackManager to be used in Aerolux

#[cfg(target_os = "macos")]
mod mac {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};

    // NSHapticFeedbackPattern raw values
    pub const PATTERN_ALIGNMENT: u64 = 0;
    pub const PATTERN_LEVEL_CHANGE: u64 = 1;
    pub const PATTERN_GENERIC: u64 = 2;

    pub fn fire(pattern: u64) {
        unsafe {
            let manager: id = msg_send![class!(NSHapticFeedbackManager), defaultPerformer];
            // performanceTime: 1 == NSHapticFeedbackPerformanceTimeNow
            let _: () = msg_send![manager, performFeedbackPattern: pattern performanceTime: 1u64];
        }
    }
}

#[tauri::command]
pub fn haptic_fire(pattern: u8) {
    #[cfg(target_os = "macos")]
    {
        let p = match pattern {
            0 => mac::PATTERN_ALIGNMENT,
            1 => mac::PATTERN_LEVEL_CHANGE,
            _ => mac::PATTERN_GENERIC,
        };
        mac::fire(p);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pattern; // no haptic hardware to target
    }
}

#[tauri::command]
pub fn haptics_available() -> bool {
    cfg!(target_os = "macos")
}
