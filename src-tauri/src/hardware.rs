// src-tauri/src/hardware.rs
// OS-level hardware detection: GPU vendor/model/VRAM, system RAM,
// CPU thread count. 
//
// one-shot: call get_hardware_info() once per session from the
// frontend (mirroring compat.js's existing manual "Run again" button
// no live-watching for hardware changes mid-session).
//
// this is used for two things:
//   1. compat.js's hardware compatibility checker UI (replacing the
//      old WebGPU-based detection there)
//   2. llama.cpp acceleration-backend selection during the model/binary
//      download flow (CUDA vs Vulkan vs Metal vs CPU-only)
//
// linux vram detection is best-effort and may legitimately come back
// as "None". this is surfaced in the UI as "Unknown" rather
// than guessed at. the existing manual vram override input in
// compat.js stays as a fallback specifically for this case.

use serde::Serialize;
use std::process::Command;
use sysinfo::System;

#[derive(Serialize, Clone, Debug)]
pub struct HardwareInfo {
    pub gpu_vendor:            String,       // "nvidia" | "amd" | "apple" | "intel" | "unknown"
    pub gpu_name:              String,       // raw model string, empty if undetectable
    pub gpu_vram_mb:           Option<u64>,  // None when genuinely undetectable
    pub is_unified_memory:     bool,         // true for Apple Silicon
    pub system_ram_mb:         u64,
    pub cpu_threads:           u32,
    pub acceleration_available: bool,        // can llama.cpp actually use a GPU backend here
    pub acceleration_backend:   String,      // "metal" | "cuda" | "vulkan" | "none"
}

#[tauri::command]
pub fn get_hardware_info() -> HardwareInfo {
    let (gpu_vendor, gpu_name, gpu_vram_mb, is_unified_memory) = detect_gpu();
    let (acceleration_available, acceleration_backend) = detect_acceleration(&gpu_vendor);

    let mut sys = System::new_all();
    sys.refresh_all();

    let system_ram_mb = sys.total_memory() / 1024 / 1024; // sysinfo reports bytes
    let cpu_threads    = sys.cpus().len() as u32;

    HardwareInfo {
        gpu_vendor,
        gpu_name,
        gpu_vram_mb,
        is_unified_memory,
        system_ram_mb,
        cpu_threads,
        acceleration_available,
        acceleration_backend,
    }
}

// acceleration availability ─────────────────────────────────────────
// this is deliberately separate from raw gpu detection above: having
// a gpu does not guarantee llama.cpp can actually accelerate on it
// (missing drivers, unsupported backend, etc). surfaced transparently
// in the compat checker ui alongside the vram/ram numbers, and used
// as a hard gate before llama_start_server is ever called. airbot
// should refuse to run on CPU-only rather than silently be unusably
// slow.

#[cfg(target_os = "macos")]
fn detect_acceleration(_gpu_vendor: &str) -> (bool, String) {
    // metal is available on every mac llama.cpp realistically targets
    // (10.13+, which we assume given window_vibrancy's own
    // requirements are already at least that recent). no separate
    // driver-presence check needed the way cuda/vulkan require below.
    (true, "metal".to_string())
}

#[cfg(target_os = "windows")]
fn detect_acceleration(gpu_vendor: &str) -> (bool, String) {
    // cuda: only meaningfully available with an nvidia gpu AND the
    // cuda toolkit/driver installed. aerolux doesn't currently probe for
    // the toolkit itself (would need to shell out to nvidia-smi or check
    // for nvcuda.dll). for now, the presence of an nvidia gpu is treated
    // as a reasonable proxy, with vulkan as the universal fallback
    // for everyone else. revisit with a real nvidia-smi presence
    // check if this proxy proves unreliable in practice.
    if gpu_vendor == "nvidia" {
        (true, "cuda".to_string())
    } else if gpu_vendor == "amd" || gpu_vendor == "intel" {
        // vulkan is broadly available on modern amd/intel windows
        // drivers. treated as available without a separate runtime
        // probe for the same reason as above.
        // rocm and oneapi have been considered but skipped because
        // the driver support of them is inconsistent and very difficult
        // to set up for the unsuspecting person.
        (true, "vulkan".to_string())
    } else {
        (false, "none".to_string())
    }
}

#[cfg(target_os = "linux")]
fn detect_acceleration(gpu_vendor: &str) -> (bool, String) {
    if gpu_vendor == "nvidia" {
        // reuse the nvidia-smi check that already proved reliable for
        // vram detection above as a presence/driver-availability signal.
        let available = Command::new("nvidia-smi").output().is_ok();
        (available, if available { "cuda".to_string() } else { "none".to_string() })
    } else if gpu_vendor == "amd" || gpu_vendor == "intel" {
        (true, "vulkan".to_string())
    } else {
        (false, "none".to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn detect_acceleration(_gpu_vendor: &str) -> (bool, String) {
    (false, "none".to_string())
}

// per-platform GPU detection ────────────────────────────────────────

// qualcomn is skipped due to:
// 1. a really low percentage of artists using qualcomn-equipped computers
// 2. i am not educated enough on the driver support on qualcomn
// for now, pray and hope that the vulkan fallback also covers qualcomn
// gpus. if there is significant demand for native qualcomn gpu support,
// then i will consider adding it in a future update.

#[cfg(target_os = "macos")]
fn detect_gpu() -> (String, String, Option<u64>, bool) {
    let output = Command::new("system_profiler")
        .arg("SPDisplaysDataType")
        .arg("-json")
        .output();

    let Ok(output) = output else {
        return ("unknown".into(), String::new(), None, false);
    };

    let Ok(stdout) = String::from_utf8(output.stdout) else {
        return ("unknown".into(), String::new(), None, false);
    };

    let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) else {
        return ("unknown".into(), String::new(), None, false);
    };

    let displays = json.get("SPDisplaysDataType").and_then(|v| v.as_array());
    let Some(displays) = displays else {
        return ("unknown".into(), String::new(), None, false);
    };
    if displays.is_empty() {
        return ("unknown".into(), String::new(), None, false);
    }

    // dual-gpu macs (intel integrated + an amd discrete card, common on
    // pre-apple-silicon automatic-graphics-switching machines) list ALL
    // gpus here, not just the currently-active one. array order is
    // NOT "currently rendering first." for inference purposes we want
    // whichever gpu is most capable, so we explicitly prefer a discrete
    // entry over an integrated one when both are present, rather than
    // blindly taking index 0.
    let entries: Vec<&serde_json::Value> = displays.iter().collect();

    let is_integrated = |entry: &serde_json::Value| -> bool {
        let name = entry.get("sppci_model").or_else(|| entry.get("_name"))
            .and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        name.contains("intel") && (name.contains("uhd") || name.contains("iris") || name.contains("hd graphics"))
    };

    let chosen = entries.iter()
        .find(|e| !is_integrated(e))
        .copied()
        .unwrap_or(entries[0]);

    let name = chosen
        .get("sppci_model")
        .or_else(|| chosen.get("_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let lower = name.to_lowercase();
    let is_apple_silicon = lower.contains("apple")
        || (lower.starts_with('m') && (lower.contains("m1") || lower.contains("m2") || lower.contains("m3") || lower.contains("m4")));

    let vendor = if is_apple_silicon {
        "apple"
    } else if lower.contains("nvidia") || lower.contains("geforce") {
        "nvidia"
    } else if lower.contains("amd") || lower.contains("radeon") {
        "amd"
    } else if lower.contains("intel") {
        "intel"
    } else {
        "unknown"
    };

    // apple silicon: vram figure is really "unified memory available to
    // the gpu," which system_profiler doesn't expose directly per-gpu.
    // we report "None" here and let the frontend fall back to system ram
    // as the practical ceiling (same convention compat.js already used
    // for this case, just now backed by a real ram figure instead of a
    // user-typed one).
    let vram_mb = if is_apple_silicon {
        None
    } else {
        chosen
            .get("spdisplays_vram")
            .and_then(|v| v.as_str())
            .and_then(parse_vram_string)
    };

    (vendor.to_string(), name, vram_mb, is_apple_silicon)
}

#[cfg(target_os = "macos")]
fn parse_vram_string(s: &str) -> Option<u64> {
    // system_profiler reports strings like "8 GB" or "1536 MB"
    let s = s.trim();
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() != 2 { return None; }
    let value: f64 = parts[0].parse().ok()?;
    match parts[1].to_uppercase().as_str() {
        "GB" => Some((value * 1024.0) as u64),
        "MB" => Some(value as u64),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn detect_gpu() -> (String, String, Option<u64>, bool) {
    // shelling out to powerShell's cim/wmi query rather than pulling in
    // a dedicated wmi crate. this keeps the dependency surface smaller,
    // and this only runs once per session so the process-spawn overhead is
    // irrelevant.
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json",
        ])
        .output();

    let Ok(output) = output else {
        return ("unknown".into(), String::new(), None, false);
    };
    let Ok(stdout) = String::from_utf8(output.stdout) else {
        return ("unknown".into(), String::new(), None, false);
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) else {
        return ("unknown".into(), String::new(), None, false);
    };

    // ConvertTo-Json returns a single object (not an array) when there's
    // only one adapter, and an array when there are multiple. handle
    // both, preferring the first/only entry.
    let entry = if json.is_array() {
        json.as_array().and_then(|a| a.first()).cloned()
    } else {
        Some(json)
    };
    let Some(entry) = entry else {
        return ("unknown".into(), String::new(), None, false);
    };

    let name = entry.get("Name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let vram_bytes = entry.get("AdapterRAM").and_then(|v| v.as_u64());
    let vram_mb = vram_bytes.map(|b| b / 1024 / 1024);

    let lower = name.to_lowercase();
    let vendor = if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("rtx") || lower.contains("gtx") {
        "nvidia"
    } else if lower.contains("amd") || lower.contains("radeon") {
        "amd"
    } else if lower.contains("intel") {
        "intel"
    } else {
        "unknown"
    };

    (vendor.to_string(), name, vram_mb, false)
}

#[cfg(target_os = "linux")]
fn detect_gpu() -> (String, String, Option<u64>, bool) {
    let lspci = Command::new("lspci").output();
    let name = lspci.ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|stdout| {
            stdout.lines()
                .find(|line| line.contains("VGA compatible controller") || line.contains("3D controller"))
                .map(|line| line.to_string())
        })
        .unwrap_or_default();

    let lower = name.to_lowercase();
    let vendor = if lower.contains("nvidia") {
        "nvidia"
    } else if lower.contains("amd") || lower.contains("ati") {
        "amd"
    } else if lower.contains("intel") {
        "intel"
    } else {
        "unknown"
    };

    // vram: only attempt nvidia-smi for nvidia cards, where it's
    // reliable. other vendors are left as "None" (genuinely best-effort
    // on linux, surfaced honestly rather than guessed). the manual
    // vram override input remains the practical fallback here.
    let vram_mb = if vendor == "nvidia" {
        Command::new("nvidia-smi")
            .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
            .output()
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
    } else {
        None
    };

    (vendor.to_string(), name, vram_mb, false)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn detect_gpu() -> (String, String, Option<u64>, bool) {
    ("unknown".into(), String::new(), None, false)
}