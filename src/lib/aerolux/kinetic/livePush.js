// src/lib/aerolux/kinetic/livePush.js
// ============================================================================
// KINETIC ENGINE: LIVE OUTPUT (js side producer)
//
// this runs its own loop instead of using rAF since the latter throttles
// when the window loses focus or gets minimised. since this is for the
// live output on a physical launchpad, it should not get throttled
//
// compile/advance/sample goes through the shared graphRunner.js core, and
// the per-tick context comes from kinetic.svelte.js's buildEngineContext()
//
// Diffing is split in two: this file does a coarse whole-device diff (skip
// a device entirely if nothing changed since last tick); kinetic_live.rs
// does the fine per-pad diff. palette quantisation happens in rust
//
// ============================================================================

import { invoke } from '@tauri-apps/api/core';
import { getDeviceGrid, localToCanvas } from './sampleDevice.js';
import { resolveLogoModeForExport } from '../midi-layout.js';
import { createGraphRunner, sampleField } from './graphRunner.js';

export const LIVE_PUSH_RATE_PRESETS = [24, 30, 60, 120, 240, 0]; // 0 = unlimited

let currentRateHz = 60;
let timerId = null;
let getContextFn = null; // supplies buildEngineContext(t)'s result fresh each tick

// per-device resolved address list + last-sent sample, keyed by deviceId
const addressListCache = new Map(); // deviceId -> [{addr,x,y}]
const lastSampleCache  = new Map(); // deviceId -> Uint8Array

function intervalMsForRate(hz) {
    return hz > 0 ? Math.max(1, Math.round(1000 / hz)) : 1; // 'unlimited' = tightest interval
}

export function getLivePushRateHz() { return currentRateHz; }

export function setLivePushRateHz(hz) {
    currentRateHz = hz;
    if (timerId !== null) {
        const ctx = getContextFn;
        stopLivePushDriver();
        startLivePushDriver(ctx);
    }
}

/**
 * resolves the address list a device samples for its current logo/mode
 * export choice. must stay in sync with kinetic_live_connect's own
 * `addresses` argument for that device.
 * @param {'logo'|'mode'} logoOrMode
 * @returns {Array<{addr:number, x:number, y:number}>}
*/
export function resolveDeviceAddresses(logoOrMode) {
    const grid = getDeviceGrid();
    const resolved = resolveLogoModeForExport(grid, logoOrMode ?? 'logo');
    const list = [];
    const seen = new Set();
    for (const cell of resolved) {
        // corner placeholders (sysexPad 0/9) are virtual
        if (cell.sysexPad === null || cell.zone === 'corner') continue;
        const addr = cell.realSysexPad ?? cell.sysexPad;
        if (seen.has(addr)) continue;
        seen.add(addr);
        list.push({ addr, x: cell.x, y: cell.y });
    }
    return list;
}

function getAddresses(deviceId, logoOrMode) {
    let list = addressListCache.get(deviceId);
    if (!list) {
        list = resolveDeviceAddresses(logoOrMode);
        addressListCache.set(deviceId, list);
    }
    return list;
}

// clears cached address list + diff buffer for a device; call on connect/logoOrMode change
export function invalidateDeviceAddresses(deviceId) {
    addressListCache.delete(deviceId);
    lastSampleCache.delete(deviceId);
}

function buffersEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// shared compile+advance core
const runner = createGraphRunner();
let lastTickAt = null; // performance.now(), for real elapsed dt (setInterval drifts)

// prevents overlapping invoke() calls
let sendInFlight = false;
let queuedPayload = null;

function sendPayload(payload) {
    sendInFlight = true;
    invoke('kinetic_live_push_batch', { payload })
        .catch(() => {})
        .finally(() => {
            sendInFlight = false;
            if (queuedPayload) {
                const next = queuedPayload;
                queuedPayload = null;
                sendPayload(next);
            }
        });
}

function driverTick() {
    if (!getContextFn) return;
    const ctx = getContextFn(); // buildEngineContext(t)'s shape -- see kinetic.svelte.js
    const connected = ctx.devices.filter(d => d.enabled && d.outputPort && d.outputIndex != null);
    if (!connected.length) return;

    const now = performance.now();
    const realDt = lastTickAt == null ? 0 : (now - lastTickAt) / 1000;
    lastTickAt = now;
    // stateful nodes must freeze while paused
    const dtSeconds = ctx.playing ? realDt : 0;

    const cacheKey = `${ctx.graphVersion}:${ctx.pathKey}`;
    const compiled = runner.tick(ctx.instances, ctx.wires, cacheKey, ctx, dtSeconds);

    const payload = [];

    for (const device of connected) {
        const field = compiled.outputs[device.id] ?? compiled.outputs.canvas;
        if (!field) continue;

        const addresses = getAddresses(device.id, device.logoOrMode);
        const brightness = device.brightness ?? 1;
        const sample = new Uint8Array(addresses.length * 3);

        for (let i = 0; i < addresses.length; i++) {
            const { x, y } = addresses[i];
            const canvasPos = localToCanvas({ x, y }, device);
            const rgb = sampleField(field, canvasPos.x, canvasPos.y, ctx.currentTick);
            if (!rgb) continue;
            const base = i * 3;
            sample[base]     = Math.max(0, Math.min(63, Math.round(rgb[0] * brightness)));
            sample[base + 1] = Math.max(0, Math.min(63, Math.round(rgb[1] * brightness)));
            sample[base + 2] = Math.max(0, Math.min(63, Math.round(rgb[2] * brightness)));
        }

        const last = lastSampleCache.get(device.id);
        if (last && buffersEqual(last, sample)) continue; // coarse whole-device diff

        lastSampleCache.set(device.id, sample);
        payload.push(device.outputIndex, ...sample);
    }

    if (!payload.length) return;
    if (sendInFlight) {
        queuedPayload = new Uint8Array(payload);
        return;
    }
    sendPayload(new Uint8Array(payload));
}

/**
 * starts the producer loop. `getContext()` is called once per tick and
 * must return kinetic.svelte.js's `buildEngineContext(t)` result (or an
 * identically-shaped object)
*/
export function startLivePushDriver(getContext) {
    if (timerId !== null) return;
    getContextFn = getContext;
    timerId = setInterval(driverTick, intervalMsForRate(currentRateHz));
}

export function stopLivePushDriver() {
    if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
        getContextFn = null;
        lastTickAt = null; // avoid a huge dt jump feeding stateful advance() on restart
        queuedPayload = null;
    }
}

/**
 * pushes an all-black frame for one device, bypassing the coarse diff
 * (used on connect/disconnect so the device is always actually cleared).
 * @param {string} deviceId
 * @param {number} outputIndex  the index returned by kinetic_live_connect
 * @param {'logo'|'mode'} logoOrMode
*/
export async function pushClearFrame(deviceId, outputIndex, logoOrMode) {
    const addresses = getAddresses(deviceId, logoOrMode);
    const zero = new Uint8Array(addresses.length * 3);
    lastSampleCache.delete(deviceId); // next real tick must not diff away against this
    try {
        await invoke('kinetic_live_push_batch', { payload: new Uint8Array([outputIndex, ...zero]) });
    } catch {
        // device may not actually be receiving yet
    }
}
