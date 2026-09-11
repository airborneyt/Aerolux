// src-tauri/src/bridge_server.rs
//
// local websocket server for the AeroFlux M4L device
// single instance only

use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpListener;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

// hardcoded static port
// use the same port on the m4l device
const BRIDGE_PORT: u16 = 39511;

pub struct BridgeServerState {
    running: Arc<AtomicBool>,
    outbound: Arc<Mutex<Option<UnboundedSender<Message>>>>,
}

pub fn init_state() -> Mutex<BridgeServerState> {
    Mutex::new(BridgeServerState {
        running: Arc::new(AtomicBool::new(false)),
        outbound: Arc::new(Mutex::new(None)),
    })
}

#[tauri::command]
pub async fn bridge_start(
    app: AppHandle,
    state: State<'_, Mutex<BridgeServerState>>,
) -> Result<(), String> {
    let (running, outbound) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        if guard.running.load(Ordering::SeqCst) {
            return Ok(());
        }
        (guard.running.clone(), guard.outbound.clone())
    };

    let listener = TcpListener::bind(("127.0.0.1", BRIDGE_PORT))
        .await
        .map_err(|e| format!("bridge: failed to bind port {BRIDGE_PORT}: {e}"))?;

    running.store(true, Ordering::SeqCst);

    tokio::spawn(accept_loop(listener, app, running, outbound));

    Ok(())
}

async fn accept_loop(
    listener: TcpListener,
    app: AppHandle,
    running: Arc<AtomicBool>,
    outbound: Arc<Mutex<Option<UnboundedSender<Message>>>>,
) {
    loop {
        if !running.load(Ordering::SeqCst) {
            break;
        }

        let (tcp_stream, _addr) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                eprintln!("bridge: accept failed: {e}");
                continue;
            }
        };

        let ws_stream = match tokio_tungstenite::accept_async(tcp_stream).await {
            Ok(ws) => ws,
            Err(e) => {
                eprintln!("bridge: handshake failed: {e}");
                continue;
            }
        };

        let (mut ws_write, mut ws_read) = ws_stream.split();

        // new connection replaces previous one
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        *outbound.lock().unwrap() = Some(tx);

        let _ = app.emit("bridge:connected", ());

        // writer task
        let writer_running = running.clone();
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if ws_write.send(msg).await.is_err() {
                    break;
                }
            }
            let _ = writer_running;
        });

        // read loop
        let app_for_read = app.clone();
        let outbound_for_read = outbound.clone();
        while let Some(msg) = ws_read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let _ = app_for_read.emit("bridge:message", serde_json::json!({ "json": text }));
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => { /* ignore ping/pong/binary */ }
                Err(e) => {
                    eprintln!("bridge: read error: {e}");
                    break;
                }
            }
        }

        // connection ended
        *outbound_for_read.lock().unwrap() = None;
        let _ = app_for_read.emit("bridge:disconnected", serde_json::json!({ "reason": "connection closed" }));

        if !running.load(Ordering::SeqCst) {
            break;
        }
    }
}

#[tauri::command]
pub fn bridge_stop(state: State<'_, Mutex<BridgeServerState>>) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    guard.running.store(false, Ordering::SeqCst);
    *guard.outbound.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn bridge_send(
    json: String,
    state: State<'_, Mutex<BridgeServerState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let outbound = guard.outbound.lock().map_err(|e| e.to_string())?;
    match outbound.as_ref() {
        Some(tx) => tx.send(Message::Text(json)).map_err(|_| "bridge: connection closed".to_string()),
        None => Err("bridge: no client connected".to_string()),
    }
}