// src/lib/aerolux/kinetic/midiExport.js
// ============================================================================
// KINETIC ENGINE: MIDI EXPORT
//
// sample a compiled field at a fixed tick resolution per device, delta-encode 
// (only emit a note event when a pad's colour actually changes; 
// keeps file size sane instead of one event per pad per sampled tick), 
// snap to nearest palette index HERE (the single snap point in the whole 
// pipeline, see paletteSnap.js), bake to MIDI.
// multi-device export produces one file per device. this module hands back a 
// Map<deviceId, Uint8Array>; writing those bytes to disk is handled by
// KineticPage.svelte.
// ============================================================================

import { findNearestPaletteIndex } from './paletteSnap.js';
import { resolveLogoModeForExport } from '../midi-layout.js';
import { kinetic } from '../../../stores/kinetic.svelte.js';

// not kept as an overridable option as the idea is that you'd
// want your exported effect to match the same speed and time youre seeing
// in kinetic's editor. if this needs to be changed, it can be changed
// globally through the transport bar.
const DEFAULT_TICKS_PER_SECOND = kinetic.transport.timeDiv;

/**
    samples a field at a fixed tick resolution over every cell in a device's
    local grid, producing a sparse, delta-encoded note-event list: a note
    event is only emitted when that pad's resolved palette index actually
    changes from the previous sampled tick (including transitions to/from
    unlit, which is encoded as palette index 0.

    for stateful fields: `advance()` is called exactly once per
    tick step using the wall-clock `dt` that tick step represents.

    logo and mode now render as two independent cells with the same
    exportNote (27), since they share one real physical output. without
    resolving that down to one before iterating, both would emit note-27
    events here, corrupting the delta-encoding (each would silently override
    the other's "last emitted index" bookkeeping under the same key). this
    resolves the pair to whichever the device is actually configured to
    export, exactly once, before sampling begins.

@param {Field|null} field
@param {Array<{exportNote:number|null, x:number, y:number}>} localCells
@param {{ totalDuration:number, tickStep?:number, palette?:Array, ticksPerSecond?:number, logoOrMode?:'logo'|'mode' }} opts
@returns {Array<{absTime:number, noteNum:number, velocity:number}>}
*/
export function sampleFieldToNoteOns(field, localCells, opts) {
    const {
        totalDuration,
        tickStep = 4,
        palette,
        ticksPerSecond = DEFAULT_TICKS_PER_SECOND,
        logoOrMode = 'logo',
    } = opts;

    const noteOns = [];
    if (!field) return noteOns;

    const cells = resolveLogoModeForExport(localCells, logoOrMode);
    const isStateful = field.kind === 'stateful';
    const lastIndex = new Map(); // exportNote -> last emitted palette index

    for (let t = 0; t <= totalDuration; t += tickStep) {
        if (isStateful) {
            const dt = tickStep / ticksPerSecond;
            field.advance(dt, { currentTick: t });
        }

        for (const cell of cells) {
            if (cell.exportNote == null) continue;

            const rgb = isStateful
                ? field.sample(cell.x, cell.y)
                : field.sample(cell.x, cell.y, t);

            const index = rgb ? findNearestPaletteIndex(rgb, palette) : 0;

            if (lastIndex.get(cell.exportNote) === index) continue; // no change = skip
            lastIndex.set(cell.exportNote, index);

            noteOns.push({ absTime: t, noteNum: cell.exportNote, velocity: index });
        }
    }

    return noteOns;
}

/**
    encodes a note-event list as a Standard MIDI File (format 0), single
    track, one tempo meta-event up front. 

@param {Array<{absTime:number, noteNum:number, velocity:number}>} noteOns
@param {number} [timeDiv]
@param {number} [bpm]
@returns {Uint8Array}
*/
export function bakeToMidi(noteOns, timeDiv = 96, bpm = 120) {
    const td  = timeDiv || 96;
    const bm  = bpm || 120;
    const evs = [...noteOns].sort((a, b) => a.absTime - b.absTime);
    const trk = [];

    function vl(n) {
        if (n < 128) return [n];
        const buf = [];
        buf.push(n & 0x7F);
        let v = n >> 7;
        while (v > 0) { buf.push((v & 0x7F) | 0x80); v >>= 7; }
        return buf.reverse();
    }

    const us = Math.round(60000000 / bm);
    trk.push(...vl(0), 0xFF, 0x51, 0x03,
        (us >> 16) & 0xFF, (us >> 8) & 0xFF, us & 0xFF);

    let prev = 0;
    for (const ev of evs) {
        const d = Math.max(0, ev.absTime - prev);
        trk.push(...vl(d), 0x90, ev.noteNum & 0x7F, ev.velocity & 0x7F);
        prev = ev.absTime;
    }
    trk.push(...vl(0), 0xFF, 0x2F, 0x00);

    const tl  = trk.length;
    const hdr = [
        0x4D,0x54,0x68,0x64, 0,0,0,6,
        0,0, 0,1,
        (td >> 8) & 0xFF, td & 0xFF,
    ];
    const th  = [
        0x4D,0x54,0x72,0x6B,
        (tl>>24)&0xFF,(tl>>16)&0xFF,(tl>>8)&0xFF,tl&0xFF,
    ];
    return new Uint8Array([...hdr, ...th, ...trk]);
}

/**
    full per-device pipeline: pick the device's own dedicated output field if
    the graph has one, else fall back to the shared canvas field, sample
    it to delta-encoded note events, bake to MIDI bytes.

    threads `device.logoOrMode` into the sample step. see
    sampleFieldToNoteOns's own comment on why the logo/mode pair has to be
    resolved to one before sampling now that both carry the same exportNote.
    an explicit `opts.logoOrMode`, if the caller already set one, wins (so a
    caller sampling several devices with an already-built shared opts object
    can still override per call if it ever needs to).

@param {DeviceInstance} device
@param {Array} localCells
@param {Record<string, Field>} compiledOutputs
@param {{ totalDuration:number, tickStep?:number, palette?:Array, timeDiv?:number, bpm?:number, ticksPerSecond?:number, logoOrMode?:'logo'|'mode' }} opts
@returns {Uint8Array}
*/
export function exportDeviceToMidi(device, localCells, compiledOutputs, opts) {
    const field = compiledOutputs[device.id] ?? compiledOutputs.canvas ?? null;
    const resolvedOpts = { logoOrMode: device?.logoOrMode ?? 'logo', ...opts };
    const noteOns = sampleFieldToNoteOns(field, localCells, resolvedOpts);
    return bakeToMidi(noteOns, opts.timeDiv, opts.bpm);
}

/**
    exports every enabled device to its own MIDI file.

@param {DeviceInstance[]} devices
@param {Map<string, Array>} gridsByDeviceId  falls back to '__default__' if a device has no entry
@param {Record<string, Field>} compiledOutputs
@param {Object} opts  see exportDeviceToMidi
@returns {Map<string, Uint8Array>} deviceId -> MIDI bytes
*/
export function exportAllDevicesToMidi(devices, gridsByDeviceId, compiledOutputs, opts) {
    const files = new Map();
    for (const device of devices) {
        if (!device.enabled) continue;
        const cells = gridsByDeviceId.get(device.id) ?? gridsByDeviceId.get('__default__') ?? [];
        files.set(device.id, exportDeviceToMidi(device, cells, compiledOutputs, opts));
    }
    return files;
}