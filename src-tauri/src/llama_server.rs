// ════════════════════════════════════════════════════════════════════
// llama_server.rs
// Lifecycle management for the bundled llama-server child process.
//
// Lazy-started: nothing spawns until the frontend explicitly calls
// llama_start_server (i.e. the first time a user touches Airbot).
//
// Dynamic port: we bind a TcpListener to port 0 to let the OS pick a
// free port, then immediately drop it so llama-server can bind there
// itself. Small race window between drop and llama-server's own bind
// is standard practice and rare to lose; llama-server fails fast and
// visibly if it does, surfaced via 'llama:server-failed'.
//
// Health-checked asynchronously: llama_start_server returns
// immediately after spawning; a background thread polls llama.cpp's
// /health endpoint and emits 'llama:server-ready' or
// 'llama:server-failed' once known. The frontend should treat the
// server as unusable until 'llama:server-ready' fires.
//
// Logging: every line of the child's stdout/stderr is (a) passed
// through to this process's own stderr via eprintln! — captured by
// the OS's normal crash/console logging for free — and (b) appended
// to a persistent log file under app_data_dir/logs/, and (c) emitted
// as 'llama:log' events for a DevTools console relay.
//
// Shutdown is NOT automatic on drop — call llama_stop_server
// explicitly. This must be wired into the app's exit sequence
// (alongside confirm_quit / ExitRequested in lib.rs) so the child
// process never orphans past the app's own lifetime.
//
// THREAD-SAFETY NOTE: background threads (health watcher, crash
// watcher, stdout/stderr pipers) never hold their own Arc<Mutex<..>>.
// They receive a cloned AppHandle<R> and call
// app.state::<Mutex<LlamaServerState>>() fresh whenever they need the
// shared state — Tauri's managed-state container is already the
// thread-safe shared handle, so there is no need to (and no clean way
// to) manually construct a second Arc around it. This is the standard
// Tauri pattern for background work that outlives a single command
// invocation.
//
// Add `mod llama_server;` near the top of lib.rs, call
// .manage(llama_server::init_state()) alongside your existing
// .manage(Mutex::new(MidiState { .. })) call, and register
// llama_start_server / llama_stop_server / llama_server_status in
// invoke_handler.
// ════════════════════════════════════════════════════════════════════

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    NotStarted,
    Starting,
    Ready,
    Failed,
    Stopped,
}

pub struct LlamaServerState {
    child: Option<Child>,
    port: Option<u16>,
    status: ServerStatus,
}

impl Default for LlamaServerState {
    fn default() -> Self {
        Self {
            child: None,
            port: None,
            status: ServerStatus::NotStarted,
        }
    }
}

pub fn init_state() -> Mutex<LlamaServerState> {
    Mutex::new(LlamaServerState::default())
}

impl LlamaServerState {
    /// Kills the child process if one is running and marks the state
    /// as deliberately Stopped (so the crash-polling watcher, if still
    /// running, recognises this as expected and stays quiet rather
    /// than emitting 'llama:server-crashed').
    ///
    /// Public specifically so code outside this module (confirm_quit
    /// in lib.rs, as part of app quit) can trigger a clean shutdown
    /// without needing direct access to this struct's private fields.
    pub fn stop(&mut self) {
        self.status = ServerStatus::Stopped;
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.port = None;
    }
}

// ── helpers ──────────────────────────────────────────────────────────

/// Binds to port 0 to let the OS assign a free port, reads it back,
/// then drops the listener so llama-server can bind there itself.
fn pick_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    Ok(port)
}

fn log_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Pipes one stdio stream (stdout or stderr) line-by-line to:
///   - eprintln! (OS-captured, free)
///   - a persistent log file
///   - a 'llama:log' event for DevTools relay
/// Runs on its own thread; exits naturally when the stream closes
/// (i.e. when the child process exits).
fn pipe_stream<R, S>(app: AppHandle<R>, stream: S, log_path: std::path::PathBuf, tag: &'static str)
where
    R: Runtime,
    S: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        let mut log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();

        for line in reader.lines() {
            let Ok(line) = line else { break };
            eprintln!("[llama-server:{tag}] {line}");

            if let Some(f) = log_file.as_mut() {
                let _ = writeln!(f, "[{tag}] {line}");
            }

            let _ = app.emit("llama:log", serde_json::json!({ "tag": tag, "line": line }));
        }
    });
}

/// Polls /health until it responds OK, times out after `timeout_secs`.
/// Reads LlamaServerState fresh via app.state() on each tick — see
/// the THREAD-SAFETY NOTE at the top of this file.
fn watch_health<R: Runtime>(app: AppHandle<R>, port: u16, timeout_secs: u64)
where
    Mutex<LlamaServerState>: 'static,
{
    thread::spawn(move || {
        let url = format!("http://127.0.0.1:{port}/health");
        let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);

        let client = match reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(800))
            .build()
        {
            Ok(c) => c,
            Err(_) => {
                mark_failed(&app, "Failed to construct HTTP client");
                return;
            }
        };

        loop {
            if std::time::Instant::now() > deadline {
                mark_failed(&app, "Timed out waiting for llama-server to become ready");
                return;
            }

            // If the process has already died, no point continuing to poll.
            let died = {
                let state = app.state::<Mutex<LlamaServerState>>();
                let mut guard = state.lock().unwrap();
                match guard.child.as_mut() {
                    Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                    None => true,
                }
            };
            if died {
                mark_failed(&app, "llama-server exited before becoming ready");
                return;
            }

            if let Ok(resp) = client.get(&url).send() {
                if resp.status().is_success() {
                    let state = app.state::<Mutex<LlamaServerState>>();
                    let mut guard = state.lock().unwrap();
                    guard.status = ServerStatus::Ready;
                    drop(guard);
                    let _ = app.emit("llama:server-ready", serde_json::json!({ "port": port }));
                    return;
                }
            }

            thread::sleep(Duration::from_millis(250));
        }
    });
}

fn mark_failed<R: Runtime>(app: &AppHandle<R>, reason: &str)
where
    Mutex<LlamaServerState>: 'static,
{
    let state = app.state::<Mutex<LlamaServerState>>();
    let mut guard = state.lock().unwrap();
    guard.status = ServerStatus::Failed;
    drop(guard);
    eprintln!("[llama-server] FAILED: {reason}");
    let _ = app.emit(
        "llama:server-failed",
        serde_json::json!({ "reason": reason }),
    );
}

// ── commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn llama_start_server<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<Mutex<LlamaServerState>>,
    binary_path: String,
    model_path: String,
    mmproj_path: Option<String>,
    ctx_size: Option<u32>,
    enable_thinking: Option<bool>,
    reasoning_budget: Option<u32>,
) -> Result<(), String> {
    let enable_thinking = enable_thinking.unwrap_or(false);
    {
        let guard = state.lock().unwrap();
        if guard.status == ServerStatus::Starting || guard.status == ServerStatus::Ready {
            return Err("llama-server is already starting or running".into());
        }
    }

    let port = pick_free_port()?;
    let logs = log_dir(&app)?;
    let log_path = logs.join("llama-server.log");

    // CRITICAL: llama-server depends on sibling shared libraries
    // (libllama-server-impl.dylib etc. on macOS, equivalent .so/.dll
    // on Linux/Windows) that live alongside it in the extracted
    // archive directory, resolved via relative/@rpath lookups at
    // runtime. Setting current_dir to the binary's own parent
    // directory ensures those lookups succeed regardless of where
    // Aerolux itself is launched from.
    let binary_dir = std::path::Path::new(&binary_path)
        .parent()
        .ok_or_else(|| "binary_path has no parent directory".to_string())?;

    let mut cmd = Command::new(&binary_path);
    cmd.current_dir(binary_dir)
        .arg("--port")
        .arg(port.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .arg("-m")
        .arg(&model_path)
        // Thinking is off by default — 'auto' detects thinking capability
        // from Gemma 4's chat template metadata and enables it, which
        // consumes the entire token budget on reasoning before producing
        // any visible output for short prompts. User can toggle this on
        // explicitly via settings (requires server restart since this is
        // a startup-time flag, not a per-request one).
        .arg("--reasoning")
        .arg(if enable_thinking { "on" } else { "off" })
        // Hard cap on reasoning tokens when thinking is enabled — prevents
        // runaway thinking from consuming the entire context on a simple
        // prompt. Ignored (set to 0) when thinking is off.
        .arg("--reasoning-budget")
        .arg(if enable_thinking {
            reasoning_budget.unwrap_or(2048).to_string()
        } else {
            "0".to_string()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(mmproj) = mmproj_path.as_ref() {
        cmd.arg("--mmproj").arg(mmproj);
    }
    if let Some(ctx) = ctx_size {
        cmd.arg("--ctx-size").arg(ctx.to_string());
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Spawn the crash watcher BEFORE moving child into state — it needs
    // to own the Child directly (see watch_crash's doc comment), and
    // state instead just tracks port/status for status queries and for
    // llama_stop_server to know there's something to kill via a
    // separately-stored handle. To keep a single source of truth for
    // "is there a process to kill," we store a second, killable handle
    // path: llama_stop_server below re-derives the child via the OS
    // process group is NOT done here for simplicity — instead we keep
    // the Child in state as the canonical handle, and watch_crash
    // receives a SEPARATE duplicate via try_clone-equivalent...
    //
    // std::process::Child does not support cloning. Simplest correct
    // approach: state owns the Child (for llama_stop_server to kill
    // it), and the crash watcher polls try_wait() on a timer instead
    // of blocking wait() on a moved-out Child. This avoids needing two
    // handles to one OS process entirely.

    {
        let mut guard = state.lock().unwrap();
        guard.child = Some(child);
        guard.port = Some(port);
        guard.status = ServerStatus::Starting;
    }

    if let Some(out) = stdout {
        pipe_stream(app.clone(), out, log_path.clone(), "stdout");
    }
    if let Some(err) = stderr {
        pipe_stream(app.clone(), err, log_path, "stderr");
    }

    watch_health(app.clone(), port, 30);
    watch_crash_polling(app);

    Ok(())
}

/// Polling-based crash watcher: checks try_wait() periodically rather
/// than blocking on wait(), since the Child handle lives in managed
/// state (owned there so llama_stop_server can kill it) and
/// std::process::Child cannot be cloned to give a second thread its
/// own owned handle to block-wait on.
fn watch_crash_polling<R: Runtime>(app: AppHandle<R>)
where
    Mutex<LlamaServerState>: 'static,
{
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(500));

            let state = app.state::<Mutex<LlamaServerState>>();
            let mut guard = state.lock().unwrap();

            if guard.status == ServerStatus::Stopped || guard.status == ServerStatus::NotStarted {
                // Either deliberately stopped, or never started in
                // this watcher's lifetime — stop polling.
                return;
            }

            let exited = match guard.child.as_mut() {
                Some(child) => child.try_wait().ok().flatten(),
                None => return, // already cleaned up elsewhere
            };

            if let Some(exit_status) = exited {
                guard.status = ServerStatus::Failed;
                guard.child = None;
                let code = exit_status.code();
                drop(guard);
                eprintln!("[llama-server] process exited unexpectedly, code={code:?}");
                let _ = app.emit("llama:server-crashed", serde_json::json!({ "code": code }));
                return;
            }
        }
    });
}

#[tauri::command]
pub fn llama_stop_server(state: tauri::State<Mutex<LlamaServerState>>) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    guard.stop();
    Ok(())
}

#[tauri::command]
pub fn llama_server_status(state: tauri::State<Mutex<LlamaServerState>>) -> serde_json::Value {
    let guard = state.lock().unwrap();
    serde_json::json!({
        "status": guard.status,
        "port":   guard.port,
    })
}

impl LlamaServerState {
    pub fn port(&self) -> Option<u16> {
        self.port
    }

    pub fn status(&self) -> ServerStatus {
        self.status
    }

    pub fn is_ready(&self) -> bool {
        self.status == ServerStatus::Ready
    }
}
