// src/stores/llama-server.svelte.js
//
// shared reactive store for the llama.cpp server status.
//
// WHY THIS EXISTS
// AirbotPanel owns the server lifecycle and keeps its own `serverStatus`
// local state. AirbotAgenticPanel needs to know whether the server is
// ready without duplicating lifecycle logic or polling. this store is
// the single shared truth both panels read from.
//
// HOW IT WORKS
// - AirbotPanel calls setLlamaStatus() whenever its serverStatus changes.
// - on init this store also listens to the three rust-emitted events:
//     'llama:server-ready'   → sets status to 'ready'
//     'llama:server-failed'  → sets status to 'failed'
//     'llama:server-crashed' → sets status to 'failed'
//   this means AirbotAgenticPanel reacts instantly to server state
//   transitions that AirbotPanel already handles; no polling required.
// - on first mount, invoke('llama_server_status') syncs the initial
//   state so the agentic panel is correct even if the server was already
//   running before the component mounted (e.g. hot reload).
//
// STATUS VALUES
// these mirror the Rust ServerStatus enum with #[serde(rename_all = "lowercase")]:
//   'notstarted'  = default, nothing has happened yet
//   'starting'    = process spawned, health-check in progress
//   'ready'       = health-check passed, requests accepted
//   'failed'      = startup failed or crashed
//   'stopped'     = deliberately stopped by the user
//
// AirbotPanel also uses its own superset of statuses for download
// progress ('downloading-binary', 'downloading-model'). those are
// forwarded to this store as 'starting' so the agentic panel banner
// shows "Starting up…" during download too.

import { invoke } from '@tauri-apps/api/core';
import { listen }  from '@tauri-apps/api/event';

// reactive store object ─────────────────────────────────────────────

export const llamaServer = $state({
    /** raw status string, mirrors rust ServerStatus enum in lowercase */
    status: 'notstarted',

    /** true only when the server has passed its health check */
    get ready() { return this.status === 'ready'; },

    /** true while downloading or health-check polling */
    get busy()  { return this.status === 'starting'; },

    /** true after a crash or startup failure */
    get failed() { return this.status === 'failed'; },
});

// setter, called by AirbotPanel ─────────────────────────────────────
// accepts AirbotPanel's superset status strings and normalises them.

export function setLlamaStatus(airbotPanelStatus) {
    switch (airbotPanelStatus) {
        case 'ready':
            llamaServer.status = 'ready';   break;
        case 'idle':
        case 'stopped':
            llamaServer.status = 'stopped'; break;
        case 'error':
            llamaServer.status = 'failed';  break;
        default:
            // 'starting', 'downloading-binary', 'downloading-model' etc.
            llamaServer.status = 'starting'; break;
    }
}

// event listeners, react to rust transitions directly ───────────────
// initialised once. both AirbotPanel and AirbotAgenticPanel benefit
// because the store updates are reactive. any component reading
// llamaServer.ready/$derived from it re-renders automatically.

let _initialised = false;

/**
 * call once, early in the app lifecycle (e.g. ThemeProvider.svelte
 * onMount, or VelocityPage.svelte onMount). safe to call multiple
 * times, subsequent calls are no-ops.
 */
export async function initLlamaServerStore() {
    if (_initialised) return;
    _initialised = true;

    // sync initial state. handles hot reload and app restarts where
    // the server might already be running when this store first mounts.
    try {
        const result = await invoke('llama_server_status');
        // rust returns { status: "notstarted"|"starting"|"ready"|"failed"|"stopped", port: ... }
        llamaServer.status = result?.status ?? 'notstarted';
    } catch {
        // command not yet registered during early startup. fine, default is 'notstarted'
    }

    // llama:server-ready  = health-check passed
    await listen('llama:server-ready', () => {
        llamaServer.status = 'ready';
    });

    // llama:server-failed = startup failed (spawn error, health timeout)
    await listen('llama:server-failed', () => {
        llamaServer.status = 'failed';
    });

    // llama:server-crashed = process exited unexpectedly after starting
    await listen('llama:server-crashed', () => {
        llamaServer.status = 'failed';
    });
}