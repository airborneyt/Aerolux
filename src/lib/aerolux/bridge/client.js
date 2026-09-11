// src/lib/aerolux/bridge/client.js
// this is where the connection lifecycle is handled
//
// rust-side surface:
//   commands: bridge_start(), bridge_stop(), bridge_send(json: string)
//   events:   'bridge:connected'    -> {}
//             'bridge:disconnected' -> { reason: string }
//             'bridge:message'      -> { json: string }  (one Aerolux Bridge message)

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { makeMessage, makeErrorMessage, validateMessage, MESSAGE_TYPES } from './protocol.js';

let unlistenFns = [];
let messageHandlers = new Set();
let statusHandlers = new Set();

let connected = false;

// this starts the local bridge listener on the rust-end and wires up
// any event listeners
export async function startBridge() {
    if (unlistenFns.length) return;

    unlistenFns.push(await listen('bridge:connected', () => {
        connected = true;
        for (const fn of statusHandlers) fn({ connected: true });
    }));

    unlistenFns.push(await listen('bridge:disconnected', (e) => {
        connected = false;
        for (const fn of statusHandlers) fn({ connected: false, reason: e.payload?.reason ?? null });
    }));

    unlistenFns.push(await listen('bridge:message', (e) => {
        let raw;
        try {
            raw = JSON.parse(e.payload.json);
        } catch {
            return; // if there is malfomed json then drop
        }
        const result = validateMessage(raw);
        if (!result.ok) {
            // tell the m4l end what was wrong with what it sent (debug)
            send(makeErrorMessage(raw?.id ?? null, result.reason)).catch(() => {});
            return;
        }
        for (const fn of messageHandlers) fn(result.message);
    }));

    await invoke('bridge_start');
    console.log('bridge started')
}

export async function stopBridge() {
    await invoke('bridge_stop').catch(() => {});
    for (const fn of unlistenFns) fn();
    unlistenFns = [];
    connected = false;
}

export function isConnected() {
    return connected;
}

// this sends an already-built message portal
export async function send(message) {
    if (!unlistenFns.length) throw new Error('AeroFlux: not started.');
    await invoke('bridge_send', { json: JSON.stringify(message) });
}

// convenience function to build and send in one call
export async function sendType(type, payload = {}) {
    return send(makeMessage(type, payload));
}

// subscribe to every validated inbound message and return an unsubscribe function
export function onMessage(fn) {
    messageHandlers.add(fn);
    return () => messageHandlers.delete(fn);
}

// subscribe to connect/disconnect transitions and return an unsubscribe function
export function onStatusChange(fn) {
    statusHandlers.add(fn);
    return () => statusHandlers.delete(fn);
}

// wait for a reply to a specific outbound message id (matched by the 
// m4l end echoing it back like clip.created replying to clip.create)
// not every message has a reply; callers that dont need one should
// just use send()/sendType() directly
export function waitForReply(requestId, { timeoutMs = 5000 } = {}) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            unsubscribe();
            reject(new Error('AeroFlux: reply timed out.'));
        }, timeoutMs);

        const unsubscribe = onMessage((msg) => {
            if (msg.payload?.inReplyToId === requestId || msg.payload?.requestId === requestId) {
                clearTimeout(timer);
                unsubscribe();
                if (msg.type === MESSAGE_TYPES.ERROR) reject(new Error(msg.payload.reason ?? 'Bridge error'));
                else resolve(msg);
            }
        });
    });
}