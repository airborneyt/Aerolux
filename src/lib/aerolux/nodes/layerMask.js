// src/lib/aerolux/nodes/layerMask.js
//
// LayerMask : composite two note event streams using spatial, temporal,
// or velocity-based masks.
//
// this is a UTILITY node. it is the only node type that takes TWO inputs:
//   - streamA  (the "base" : comes from the node's primary input port)
//   - streamB  (the "overlay" : comes from the node's secondary input port)
//
// the node chain runner calls it differently from single-input nodes:
//   processLayerMask(streamA, params, context, streamB)

import { DEVICE_PROFILES, noteToCell, cellToSysex, ZONE } from '../midi-layout.js';

// ── Pad bitmask helpers ───────────────────────────────────────────

/**
 * Build a Set of sysex pad numbers from a region descriptor.
 * regionMode:
 *   'all'    — every pad
 *   'main'   — 8×8 main grid only
 *   'left'   — left half (cols 0–3)
 *   'right'  — right half (cols 4–7)
 *   'top'    — top half (rows 4–7)
 *   'bottom' — bottom half (rows 0–3)
 *   'custom' — uses customPads (array of sysex note numbers)
 */
function buildRegionSet(regionMode, customPads, device) {
    const pads = new Set();
    const profile = DEVICE_PROFILES[device] ?? DEVICE_PROFILES.LPP2;
    if (regionMode === 'custom') {
        for (const p of (customPads ?? [])) pads.add(p);
        return pads;
    }
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const sx = (row + 1) * 10 + (col + 1);
            if (regionMode === 'all' || regionMode === 'main') {
                pads.add(sx);
            } else if (regionMode === 'left'   && col < 4) pads.add(sx);
            else if   (regionMode === 'right'  && col >= 4) pads.add(sx);
            else if   (regionMode === 'top'    && row >= 4) pads.add(sx);
            else if   (regionMode === 'bottom' && row < 4)  pads.add(sx);
        }
    }
    if (regionMode === 'all') {
        if (profile.top)    for (let col = 0; col < 8; col++) pads.add(cellToSysex({ zone: ZONE.TOP, row: 8, col }));
        if (profile.right)  for (let row = 0; row < 8; row++) pads.add(cellToSysex({ zone: ZONE.RIGHT, row, col: 8 }));
        if (profile.left)   for (let row = 0; row < 8; row++) pads.add(cellToSysex({ zone: ZONE.LEFT, row, col: -1 }));
        if (profile.bottom) for (let col = 0; col < 8; col++) pads.add(cellToSysex({ zone: ZONE.BOTTOM, row: -1, col }));
    }
    return pads;
}

// ── Velocity blending ─────────────────────────────────────────────

function velToRgb(velocity, palette) {
    const c = palette[velocity] ?? palette[0];
    return [c.r, c.g, c.b];
}

function rgbToNearestVel(r, g, b, palette) {
    let best = 0, bd = Infinity;
    for (const c of palette) {
        if (c.i === 0) continue;
        const d = Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b);
        if (d < bd) { bd = d; best = c.i; }
    }
    return best;
}

function blendVelocities(velA, velB, mode, opacity, palette) {
    if (!palette?.length) return velB;  // fallback
    const [rA, gA, bA] = velToRgb(velA, palette);
    const [rB, gB, bB] = velToRgb(velB, palette);
    const a = opacity;

    let r, g, b;
    switch (mode) {
        case 'normal':
            r = rA * (1 - a) + rB * a;
            g = gA * (1 - a) + gB * a;
            b = bA * (1 - a) + bB * a;
            break;
        case 'add':
            r = Math.min(63, rA + rB * a);
            g = Math.min(63, gA + gB * a);
            b = Math.min(63, bA + bB * a);
            break;
        case 'multiply':
            r = (rA * rB / 63) * a + rA * (1 - a);
            g = (gA * gB / 63) * a + gA * (1 - a);
            b = (bA * bB / 63) * a + bA * (1 - a);
            break;
        case 'max':
            r = Math.max(rA, rB * a);
            g = Math.max(gA, gB * a);
            b = Math.max(bA, bB * a);
            break;
        case 'min':
            r = Math.min(rA, rB === 0 ? 63 : rB * a);
            g = Math.min(gA, gB === 0 ? 63 : gB * a);
            b = Math.min(bA, bB === 0 ? 63 : bB * a);
            break;
        case 'screen':
            r = 63 - (63 - rA) * (63 - rB * a) / 63;
            g = 63 - (63 - gA) * (63 - gB * a) / 63;
            b = 63 - (63 - bA) * (63 - bB * a) / 63;
            break;
        case 'gate':
            // B only shows where A is black
            if (rA + gA + bA < 5) { r = rB * a; g = gB * a; b = bB * a; }
            else { r = rA; g = gA; b = bA; }
            break;
        case 'mask':
            // B only shows where A is active
            if (rA + gA + bA >= 5) { r = rB * a; g = gB * a; b = bB * a; }
            else { r = 0; g = 0; b = 0; }
            break;
        default:
            return velB;
    }

    return rgbToNearestVel(
        Math.max(0, Math.min(63, Math.round(r))),
        Math.max(0, Math.min(63, Math.round(g))),
        Math.max(0, Math.min(63, Math.round(b))),
        palette
    );
}

// ── Main processor ────────────────────────────────────────────────

/**
 * @param {object[]} streamA   - base stream (primary input)
 * @param {object}   params
 * @param {object}   context   - { device, palette }
 * @param {object[]} streamB   - overlay stream (secondary input, may be empty)
 * @returns {object[]}
 */
export function processLayerMask(streamA, params, context, streamB = []) {
    const {
        blendMode    = 'normal',
        opacity      = 1.0,
        regionMode   = 'all',
        customPads   = [],
        timeOffset   = 0,
        invertMask   = false,
        overlayOnly  = false,
    } = params;

    const { device = 'LPP2', palette = [] } = context;

    const regionSet = buildRegionSet(regionMode, customPads, device);

    // Offset streamB in time
    const offsetB = streamB.map(ev => ({ ...ev, absTime: ev.absTime + timeOffset }));

    // Build tick → { noteNum → event } maps for both streams
    function buildTickMap(stream) {
        const map = new Map();
        for (const ev of stream) {
            if (!map.has(ev.absTime)) map.set(ev.absTime, new Map());
            map.get(ev.absTime).set(ev.noteNum, ev);
        }
        return map;
    }

    const mapA = buildTickMap(streamA);
    const mapB = buildTickMap(offsetB);

    // Union of all timestamps
    const allTicks = [...new Set([...mapA.keys(), ...mapB.keys()])].sort((a, b) => a - b);

    const result = [];

    for (const tick of allTicks) {
        const padA = mapA.get(tick) ?? new Map();
        const padB = mapB.get(tick) ?? new Map();

        // Collect all note numbers active at this tick
        const allNotes = new Set([...padA.keys(), ...padB.keys()]);

        for (const noteNum of allNotes) {
            const cell = noteToCell(noteNum, device);
            if (!cell) continue;

            // SysEx number for region check
            const sx = cellToSysex(cell);
            const inRegion = sx !== null && regionSet.has(sx);
            const affected = invertMask ? !inRegion : inRegion;

            const evA = padA.get(noteNum);
            const evB = padB.get(noteNum);

            if (overlayOnly) {
                // Only emit B events, masked to region
                if (evB && affected) result.push({ ...evB });
                else if (evA)        result.push({ ...evA });
            } else if (evA && evB && affected) {
                // Both present in region → blend
                const blended = blendVelocities(evA.velocity, evB.velocity, blendMode, opacity, palette);
                result.push({ ...evA, velocity: blended });
            } else if (evB && affected) {
                // Only B in region → use B at opacity
                const dimmed = blendVelocities(0, evB.velocity, blendMode, opacity, palette);
                result.push({ ...evB, velocity: dimmed });
            } else if (evA) {
                // Only A, or B out of region → use A unchanged
                result.push({ ...evA });
            }
        }
    }

    result.sort((a, b) => a.absTime - b.absTime || a.noteNum - b.noteNum);
    return result;
}
