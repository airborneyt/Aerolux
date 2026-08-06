// src/lib/aerolux/kinetic/livePush.js
// ============================================================================
// KINETIC ENGINE: LIVE MIDI PUSH (JS producer side)
//
// hardware pacing, diffing, and the actual blocking MIDI writes live in the rust
// side of this engine (src-tauri/src/kinetic-live.rs) on a dedicated thread per
// device.
//
// this js side is the "producer", and its job is to sample the graph, optionally
// quantise it to the current palette, and fire a kinetic_live_push call.
// ============================================================================

import { getDeviceGrid, localToCanvas } from './sampleDevice.js';
import { resolveLogoModeForExport } from '../midi-layout.js';
import { findNearestPaletteIndex } from './paletteSnap.js';
import { compileGraph } from './compileGraph.js';
import { resolveField } from './nodeRegistry.js';

// precomputed mode-resolved address lists ––––––––––––––––––––––––––
const resolvedListCache = new Map(); // 'logo'|'mode' -> [{addr,x,y}, ...]

function getResolvedList(logoOrMode) {
    let list = resolvedListCache.get(logoOrMode);
    if (list) return list;

    const grid = getDeviceGrid();
    const resolved = resolveLogoModeForExport(grid, logoOrMode);
    const seen = new Set();
    list = [];
    for (const cell of resolved) {
        if (cell.sysexPad === null) continue;
        const addr = cell.realSysexPad ?? cell.sysexPad;
        if (seen.has(addr)) continue;
        seen.add(addr);
        list.push({ addr, x: cell.x, y: cell.y });
    }
    resolvedListCache.set(logoOrMode, list);
    return list;
}

// palette quantisation –––––––––––––––––––––––––––––––––––––––––––––
let quantizeCache = new Map();
let quantizeCachePaletteRef = null;

function packRGB(r, g, b) { return (r << 12) | (g << 6) | b; }
function unpackRGB(p) { return [(p >> 12) & 63, (p >> 6) & 63, p & 63]; }

function quantizeFast(r, g, b, palette) {
    if (!palette?.length) return [r, g, b];
    if (palette !== quantizeCachePaletteRef) {
        quantizeCache = new Map();
        quantizeCachePaletteRef = palette;
    }
    const key = packRGB(r, g, b);
    const cached = quantizeCache.get(key);
    if (cached !== undefined) return unpackRGB(cached);

    const idx = findNearestPaletteIndex([r, g, b], palette);
    const entry = palette.find(p => p.i === idx);
    const result = entry ? [entry.r, entry.g, entry.b] : [r, g, b];
    quantizeCache.set(key, packRGB(result[0], result[1], result[2]));
    return result;
}

// manual cache-bust for callers that swap/mutate the palette in place
export function invalidateLiveQuantizeCache() {
    quantizeCache = new Map();
    quantizeCachePaletteRef = null;
}

// tolerance in case there are any performance hits from sending the full 262k
// colours. not really needed for palette mode since that is already quantised 
// to 127 colours.
const PALETTE_TOLERANCE = 0;
const SYSEX_TOLERANCE = 0;

async function pushOneDevice(device, field, t, palette, invoke) {
    const list = getResolvedList(device.logoOrMode ?? 'logo');
    const brightness = device.brightness ?? 1;
    const usePalette = device.displayMode === 'palette';

    const flat = new Array(list.length * 4);
    for (let i = 0; i < list.length; i++) {
        const { addr, x, y } = list[i];
        const canvasPos = localToCanvas({ x, y }, device);
        const rgb = field ? field.sample(canvasPos.x, canvasPos.y, t) : null;

        let r = 0, g = 0, b = 0;
        if (rgb) {
            r = Math.max(0, Math.min(63, Math.round(rgb[0] * brightness)));
            g = Math.max(0, Math.min(63, Math.round(rgb[1] * brightness)));
            b = Math.max(0, Math.min(63, Math.round(rgb[2] * brightness)));
            if (usePalette) [r, g, b] = quantizeFast(r, g, b, palette);
        }

        const base = i * 4;
        flat[base] = addr; flat[base + 1] = r; flat[base + 2] = g; flat[base + 3] = b;
    }

    const tolerance = usePalette ? PALETTE_TOLERANCE : SYSEX_TOLERANCE;
    try {
        await invoke('kinetic_live_push', { key: device.id, frame: flat, tolerance });
    } catch (err) {
        console.warn(`Kinetic live push failed for device ${device.id}:`, err);
    }
}

// build a synthetic all-black frame for a device's resolved address list
function buildBlackFrame(logoOrMode) {
    const list = getResolvedList(logoOrMode ?? 'logo');
    const flat = new Array(list.length * 4);
    for (let i = 0; i < list.length; i++) {
        const base = i * 4;
        flat[base] = list[i].addr; flat[base + 1] = 0; flat[base + 2] = 0; flat[base + 3] = 0;
    }
    return flat;
}

/**
    clears the pad by pushing an all-black frame upon connect/disconnect.
    why disconnect? because you could reassign a device to another launchpad,
    and that could leave the former launchpad to have lights stuck.

@param {string} deviceId
@param {'logo'|'mode'} logoOrMode
*/
export async function pushClearFrame(deviceId, logoOrMode) {
    const { invoke } = await import('@tauri-apps/api/core');
    const flat = buildBlackFrame(logoOrMode);
    try {
        await invoke('kinetic_live_push', { key: deviceId, frame: flat, tolerance: 0 });
    } catch {
        // device may not actually be receiving yet
    }
}

// decoupled driver, tunable producer rate ––––––––––––––––––––––––––
// this controls how often the graph is resampled and not how many frames are
// sent to the launchpad. this does not have much performance loss due to 
// kinetic's powerful engine, so it can be pushed very high. the rust
// side will handle and drop any frame that arrives faster than a device's own 
// thread can drain.
export const LIVE_PUSH_RATE_PRESETS = [24, 30, 60, 120, 240, 0]; // 0 is unlimited

let currentRateHz = 60;
let driverIntervalId = null;
let driverGetContext = null;

function intervalMsForRate(hz) {
    return hz > 0 ? Math.round(1000 / hz) : 0;
}

export function getLivePushRateHz() { return currentRateHz; }

// changes the driver's producer rate
export function setLivePushRateHz(hz) {
    currentRateHz = hz;
    if (driverIntervalId !== null && driverGetContext) {
        const ctx = driverGetContext;
        stopLivePushDriver();
        startLivePushDriver(ctx);
    }
}

async function driverTick() {
    const { instances, wires, palette, devices, t } = driverGetContext();
    const connected = devices.filter(d => d.enabled && d.outputPort);
    if (!connected.length) return;

    const { invoke } = await import('@tauri-apps/api/core');
    const compiled = compileGraph(instances, wires, { palette, devices }, resolveField);

    for (const device of connected) {
        const field = compiled.outputs[device.id] ?? compiled.outputs.canvas;
        pushOneDevice(device, field, t, palette, invoke); // fire-and-forget -- never blocks the producer loop
    }
}

// starts the producer driver on its own fixed interval
// `getContext()` is called once per tick and must return `{ instances, wires, palette, devices, t }`
export function startLivePushDriver(getContext) {
    if (driverIntervalId !== null) return;
    driverGetContext = getContext;
    driverIntervalId = setInterval(driverTick, intervalMsForRate(currentRateHz));
}

export function stopLivePushDriver() {
    if (driverIntervalId !== null) {
        clearInterval(driverIntervalId);
        driverIntervalId = null;
        driverGetContext = null;
    }
}