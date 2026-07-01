// ════════════════════════════════════════════════════════════════════
// llama_download.rs
// Downloads and extracts the llama-server binary, and downloads the
// Gemma 4 E4B model + mmproj pair, on first AI use.
//
// Two independently-retryable downloads (binary vs model+mmproj), each
// streamed with progress events for a split progress bar on the
// frontend ('llama:download-progress' with a target field).
//
// ACCELERATION BACKEND FOR 2.0: Metal (macOS) and Vulkan (Windows/
// Linux) only. CUDA is deliberately NOT used in 2.0, even on NVIDIA
// hardware — CUDA builds require the installed CUDA toolkit version
// to match the build (12.x vs 13.x), and a mismatch causes a SILENT
// fallback to CPU-only inference with no error, which would look like
// "Aerolux/the model is just slow" to a user with no obvious cause.
// Vulkan works correctly regardless of installed CUDA version. Proper
// CUDA-toolkit-version detection (so we can pick the matching build)
// is deferred to 2.1.
//
// No resume support yet (restart-from-scratch on failure/retry) —
// deliberately deferred to 2.1. The streaming-with-known-total-size
// approach here is structured so resume can be added later as an
// additive change (Range header + append-instead-of-overwrite) rather
// than a rework.
//
// Files land in:
//   app_data_dir/bin/llama-server(.exe)      — extracted from archive
//   app_data_dir/models/<model file>.gguf
//   app_data_dir/models/<mmproj file>.gguf
//
// Add `mod llama_download;` near the top of lib.rs and register
// llama_download::download_llama_binary,
// llama_download::download_llama_model,
// llama_download::get_llama_paths
// in invoke_handler.
// ════════════════════════════════════════════════════════════════════

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager, Runtime};

// ── pinned release ───────────────────────────────────────────────────
// IMPORTANT: re-verify this tag against the real current release at
// https://github.com/ggml-org/llama.cpp/releases immediately before
// shipping — it WILL be out of date by the time 2.0 actually ships,
// llama.cpp cuts releases multiple times a day. This value must be
// updated deliberately at ship time, not trusted as "current" just
// because it was correct when this file was written.
const LLAMA_CPP_TAG: &str = "b9740";

// ── model source (Hugging Face, ggml-org first-party GGUF release) ──
const HF_MODEL_BASE: &str = "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main";
// NOTE: exact filenames on the HF repo were not directly re-verified
// in this session — confirmed only via earlier general search results
// referencing this collection's existence and naming convention. Spot
// check the actual repo file listing before shipping; if these are
// wrong, download_llama_model will fail loudly with an HTTP error
// rather than silently producing a bad file, so this is a "verify
// before ship" item, not a silent-failure risk like the CUDA case.
const MODEL_FILENAME:  &str = "gemma-4-E4B-it-Q4_K_M.gguf";
const MMPROJ_FILENAME: &str = "mmproj-gemma-4-E4B-it-Q8_0.gguf";

#[derive(serde::Serialize, Clone)]
pub struct LlamaPaths {
    pub binary_path: Option<String>,
    pub model_path:  Option<String>,
    pub mmproj_path: Option<String>,
}

// ── confirmed real asset names (verified against the live release
// page for tag b9740 — see naming pattern, not just this one tag) ───

#[derive(Debug, Clone, Copy, PartialEq)]
enum ArchiveKind { TarGz, Zip }

fn binary_asset() -> Result<(String, ArchiveKind), String> {
    let combo = (std::env::consts::OS, std::env::consts::ARCH);
    let (filename, kind) = match combo {
        ("macos", "aarch64") => (format!("llama-{LLAMA_CPP_TAG}-bin-macos-arm64.tar.gz"), ArchiveKind::TarGz),
        ("macos", "x86_64")  => (format!("llama-{LLAMA_CPP_TAG}-bin-macos-x64.tar.gz"), ArchiveKind::TarGz),
        ("windows", "x86_64") => (format!("llama-{LLAMA_CPP_TAG}-bin-win-vulkan-x64.zip"), ArchiveKind::Zip),
        ("linux", "x86_64")   => (format!("llama-{LLAMA_CPP_TAG}-bin-ubuntu-vulkan-x64.tar.gz"), ArchiveKind::TarGz),
        ("linux", "aarch64")  => (format!("llama-{LLAMA_CPP_TAG}-bin-ubuntu-vulkan-arm64.tar.gz"), ArchiveKind::TarGz),
        _ => return Err(format!(
            "No supported llama-server build for OS={}, ARCH={}",
            combo.0, combo.1
        )),
    };
    Ok((filename, kind))
}

fn binary_asset_url() -> Result<(String, ArchiveKind), String> {
    let (filename, kind) = binary_asset()?;
    Ok((
        format!("https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_CPP_TAG}/{filename}"),
        kind,
    ))
}

// ── paths ────────────────────────────────────────────────────────────

fn bin_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("bin");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn binary_filename() -> &'static str {
    if cfg!(target_os = "windows") { "llama-server.exe" } else { "llama-server" }
}

#[tauri::command]
pub fn get_llama_paths<R: Runtime>(app: AppHandle<R>) -> Result<LlamaPaths, String> {
    // The binary is intentionally left wherever the archive extracted
    // it (see download_llama_binary's doc comment — moving it away
    // from sibling shared libraries breaks library resolution), so we
    // can't check one fixed path here. Search recursively, same logic
    // download_llama_binary itself uses to find it right after
    // extraction.
    let bin_root = bin_dir(&app)?;
    let bin_path = find_extracted_binary(&bin_root, binary_filename());

    let model_path  = models_dir(&app)?.join(MODEL_FILENAME);
    let mmproj_path = models_dir(&app)?.join(MMPROJ_FILENAME);

    Ok(LlamaPaths {
        binary_path:  bin_path.map(|p| p.to_string_lossy().to_string()),
        model_path:   model_path.exists().then(|| model_path.to_string_lossy().to_string()),
        mmproj_path:  mmproj_path.exists().then(|| mmproj_path.to_string_lossy().to_string()),
    })
}

// ── streaming download with progress events ─────────────────────────

async fn download_with_progress<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    dest: &Path,
    target: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        // GitHub Releases and HF both redirect; reqwest follows
        // redirects by default, this is just explicit about it.
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Download failed for {target}: HTTP {} ({url})", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = File::create(dest).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut last_emitted_pct = u32::MAX; // force the first emit

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        let pct = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0) as u32
        } else {
            0
        };

        // Avoid flooding the frontend with an event per chunk — only
        // emit when the integer percentage actually changes.
        if pct != last_emitted_pct {
            last_emitted_pct = pct;
            let _ = app.emit("llama:download-progress", serde_json::json!({
                "target":     target,
                "downloaded": downloaded,
                "total":      total_size,
                "percent":    pct,
            }));
        }
    }

    let _ = app.emit("llama:download-complete", serde_json::json!({ "target": target }));
    Ok(())
}

// ── archive extraction ───────────────────────────────────────────────
// llama.cpp's release assets are archives containing several binaries
// and shared libraries (llama-server, llama-cli, llama-bench, .so/.dll
// dependencies), not a single standalone executable. We extract the
// WHOLE archive contents into app_data_dir/bin/ (not just llama-server
// in isolation) because llama-server typically depends on sibling
// shared libraries (e.g. libggml*.so/.dylib, ggml-vulkan backend libs)
// being present alongside it — extracting only the one file would
// likely produce a binary that fails to launch with a missing-library
// error.

fn extract_tar_gz(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| e.to_string())?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest_dir).map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = match entry.enclosed_name() {
            Some(p) => dest_dir.join(p),
            None => continue, // skip entries with unsafe/invalid paths
        };

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = File::create(&out_path).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// After extraction, the actual llama-server executable may sit inside
/// a subdirectory (archives are not guaranteed to extract flat) —
/// search recursively for it rather than assuming a fixed layout,
/// since the internal archive structure differs across llama.cpp
/// releases and was not exhaustively verified for every platform here.
fn find_extracted_binary(search_root: &Path, expected_name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(search_root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_extracted_binary(&path, expected_name) {
                return Some(found);
            }
        } else if path.file_name().and_then(|n| n.to_str()) == Some(expected_name) {
            return Some(path);
        }
    }
    None
}

// ── commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_llama_binary<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let (url, kind) = binary_asset_url()?;
    let bin_destination_dir = bin_dir(&app)?;

    let archive_ext = match kind { ArchiveKind::TarGz => "tar.gz", ArchiveKind::Zip => "zip" };
    let archive_path = bin_destination_dir.join(format!("download.{archive_ext}"));

    download_with_progress(&app, &url, &archive_path, "binary").await?;

    let _ = app.emit("llama:download-progress", serde_json::json!({
        "target": "binary", "percent": 100, "extracting": true,
    }));

    match kind {
        ArchiveKind::TarGz => extract_tar_gz(&archive_path, &bin_destination_dir)?,
        ArchiveKind::Zip   => extract_zip(&archive_path, &bin_destination_dir)?,
    }

    let _ = fs::remove_file(&archive_path); // archive itself is no longer needed once extracted

    let expected_name = binary_filename();
    let found = find_extracted_binary(&bin_destination_dir, expected_name)
        .ok_or_else(|| format!(
            "Extracted archive but could not locate '{expected_name}' inside it — \
             the archive's internal layout may differ from what was expected for this release/platform."
        ))?;

    // CRITICAL: do NOT move the binary out of its extracted directory.
    // llama-server depends on sibling .dylib/.so files sitting next to
    // it (libllama-server-impl, libggml*, libmtmd, etc.) via @rpath-
    // relative lookups on macOS (and equivalent relative lookups on
    // Linux/Windows) — moving only the executable leaves those
    // libraries behind and the binary fails to launch with a
    // "Library not loaded" error. The binary stays wherever the
    // archive put it; llama_server.rs's spawn logic sets the child
    // process's working directory to this same folder so the relative
    // library lookups resolve correctly.
    let final_path = found;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(&final_path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&final_path, perms);
        }
    }

    Ok(final_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn download_llama_model<R: Runtime>(app: AppHandle<R>) -> Result<(String, String), String> {
    let model_url   = format!("{HF_MODEL_BASE}/{MODEL_FILENAME}");
    let mmproj_url  = format!("{HF_MODEL_BASE}/{MMPROJ_FILENAME}");
    let model_dest  = models_dir(&app)?.join(MODEL_FILENAME);
    let mmproj_dest = models_dir(&app)?.join(MMPROJ_FILENAME);

    download_with_progress(&app, &model_url, &model_dest, "model").await?;
    download_with_progress(&app, &mmproj_url, &mmproj_dest, "mmproj").await?;

    Ok((
        model_dest.to_string_lossy().to_string(),
        mmproj_dest.to_string_lossy().to_string(),
    ))
}