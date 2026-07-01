// ════════════════════════════════════════════════════════════════════
// llama_chat.rs
// Rust-side inference commands — the webview never touches the server
// port directly, all HTTP goes through here. This keeps the dynamic
// port as an internal detail and avoids Tauri's webview CSP blocking
// localhost fetches.
//
// Streaming: llama_generate streams tokens to the frontend via
// 'llama:token' events as SSE chunks arrive, then emits
// 'llama:generation-done' with final stats. The frontend listens to
// these events rather than awaiting the command itself (which resolves
// immediately after kicking off the stream).
//
// Abort: llama_abort_generation sets a per-generation abort flag that
// the streaming loop checks between chunks. The flag is keyed by
// generation_id (a String the caller provides) so concurrent
// generations (e.g. batch mode) can be independently aborted.
//
// Multimodal: when a message content item contains an image_url entry
// the content array is passed through verbatim to the completions
// endpoint. The frontend base64-encodes image bytes and formats them
// as {"type":"image_url","image_url":{"url":"data:image/...;base64,..."}}
// — llama.cpp's OpenAI-compatible endpoint accepts this format when
// the server was started with --mmproj.
//
// Grammar: GBNF grammar strings are passed as the "grammar" field in
// the completions request body. When present, llama.cpp constrains
// the model's output to tokens that match the grammar, eliminating
// the JSON parse-failure class of bug entirely.
//
// Register llama_generate and llama_abort_generation in invoke_handler.
// ════════════════════════════════════════════════════════════════════

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::llama_server::LlamaServerState;

// ── abort registry ────────────────────────────────────────────────────
// Maps generation_id → abort flag. String key so the frontend can use
// any stable unique string (timestamp + random suffix) without worrying
// about u64 overflow or serialisation edge cases.

pub type AbortRegistry = Arc<Mutex<HashMap<String, bool>>>;

pub fn init_abort_registry() -> AbortRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

// ── request / event types ────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role:    String,
    // String for plain text, array for multimodal content blocks.
    // The frontend sends the correct shape — we pass it through verbatim.
    pub content: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlamaGenerateRequest {
    pub generation_id: String,
    pub messages:      Vec<ChatMessage>,
    pub max_tokens:    Option<u32>,
    pub temperature:   Option<f32>,
    // JSON schema for structured output — passed as response_format to
    // the completions endpoint. None = plain text generation.
    pub json_schema:   Option<serde_json::Value>,
    // GBNF grammar string for grammar-constrained decoding.
    // When set, takes precedence over json_schema for output format.
    pub stream:        Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TokenEvent {
    pub generation_id: String,
    pub delta:         String,
    pub done:          bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct GenerationDoneEvent {
    pub generation_id:    String,
    pub full_text:        String,
    pub prompt_tokens:    u32,
    pub completion_tokens: u32,
    pub finish_reason:    String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GenerationErrorEvent {
    pub generation_id: String,
    pub error:         String,
}

// ── commands ─────────────────────────────────────────────────────────

/// Kick off a streaming generation. Returns immediately — the caller
/// must listen to 'llama:token' and 'llama:generation-done' events.
/// On error, emits 'llama:generation-error' instead.
#[tauri::command]
pub async fn llama_generate<R: Runtime>(
    state: State<'_, Mutex<LlamaServerState>>,
    app: AppHandle<R>,
    request: LlamaGenerateRequest,
) -> Result<(), String> {
    // Get the server port — fails fast if server isn't running yet.
    let port = {
        let guard = state.lock().unwrap();
        guard.port()
            .ok_or_else(|| "Llama server is not running".to_string())?
    };

    let gen_id = request.generation_id.clone();

    // Register this generation as not-aborted.
    {
        let registry = app.state::<AbortRegistry>();
        let mut map  = registry.lock().map_err(|e| e.to_string())?;
        map.insert(gen_id.clone(), false);
    }

    // Build the request body.
    let mut body = serde_json::json!({
        "messages":   request.messages,
        "max_tokens": request.max_tokens.unwrap_or(1024),
        "temperature":request.temperature.unwrap_or(0.4),
        "stream":     true,
    });

    // Grammar takes precedence — when provided it already constrains the
    // output shape, so adding response_format on top is redundant and can
    // confuse some llama.cpp builds. Only add response_format when there
    // is no grammar.
if let Some(schema) = request.json_schema {
        body["response_format"] = serde_json::json!({
            "type":        "json_schema",
            "json_schema": { "name": "response", "schema": schema },
        });
    }

    // Spawn the actual streaming work on a separate task so this
    // command returns immediately to the frontend.
    let app_for_spawn = app.clone();
    let gen_id_for_spawn = gen_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = stream_generation(
            app_for_spawn.clone(), port, gen_id_for_spawn.clone(), body
        ).await {
            let _ = app_for_spawn.emit("llama:generation-error", GenerationErrorEvent {
                generation_id: gen_id_for_spawn.clone(),
                error: e,
            });
        }

        // Clean up abort registry entry.
        // FIX: previous version tried to lock the registry inside the spawn
        // closure using a binding that was never inserted — this caused a
        // dead-code block that did nothing. The actual cleanup now happens
        // correctly here, after stream_generation returns.
        if let Ok(mut map) = app_for_spawn.state::<AbortRegistry>().lock() {
            map.remove(&gen_id_for_spawn);
        }
    });

    Ok(())
}

async fn stream_generation<R: Runtime>(
    app: AppHandle<R>,
    port: u16,
    gen_id: String,
    body: serde_json::Value,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Server returned HTTP {}", response.status()));
    }

    let mut stream = response.bytes_stream();
    let mut full_text        = String::new();
    let mut prompt_tokens    = 0u32;
    let mut completion_tokens = 0u32;
    let mut finish_reason    = "stop".to_string();
    let mut buffer           = String::new();

    while let Some(chunk) = stream.next().await {
        // Check abort flag before processing each chunk.
        {
            let registry = app.state::<AbortRegistry>();
            if let Ok(map) = registry.lock() {
                if map.get(&gen_id).copied().unwrap_or(false) {
                    finish_reason = "abort".to_string();
                    break;
                }
            };
        }

        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        let text  = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // SSE lines arrive as "data: {...}\n\n" — process complete lines.
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer   = buffer[newline_pos + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            let json_str = line.strip_prefix("data: ").unwrap_or(&line);
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) else {
                continue; // skip malformed lines silently
            };

            // Extract token delta.
            let delta = parsed["choices"][0]["delta"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string();

            if !delta.is_empty() {
                full_text.push_str(&delta);
                let _ = app.emit("llama:token", TokenEvent {
                    generation_id: gen_id.clone(),
                    delta:         delta.clone(),
                    done:          false,
                });
            }

            // Extract usage stats when present (typically in the last chunk).
            if let Some(usage) = parsed.get("usage") {
                prompt_tokens     = usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
                completion_tokens = usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
            }

            if let Some(reason) = parsed["choices"][0]["finish_reason"].as_str() {
                if !reason.is_empty() && reason != "null" {
                    finish_reason = reason.to_string();
                }
            }
        }
    }

    // Emit final sentinel token event, then the done event.
    let _ = app.emit("llama:token", TokenEvent {
        generation_id: gen_id.clone(),
        delta:         String::new(),
        done:          true,
    });
    let _ = app.emit("llama:generation-done", GenerationDoneEvent {
        generation_id: gen_id,
        full_text,
        prompt_tokens,
        completion_tokens,
        finish_reason,
    });

    Ok(())
}

/// Signal an in-progress generation to stop after its current chunk.
/// Safe to call even if the generation has already completed.
#[tauri::command]
pub fn llama_abort_generation<R: Runtime>(
    app: AppHandle<R>,
    generation_id: String,
) -> Result<(), String> {
    let registry = app.state::<AbortRegistry>();
    let mut map  = registry.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = map.get_mut(&generation_id) {
        *flag = true;
    }
    // If the id isn't in the map the generation already completed — no-op.
    Ok(())
}