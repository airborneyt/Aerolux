// src/lib/aerolux/nodes/merge.js
//
// Merge : join two streams of light data into one
// this is a much more simple node compared to layermask, which calculates z-layers
// unlike layermask, this node's sole job is to mash whatever input it gets to a single stream
//
// this is a UTILITY node. it is the only node type that takes TWO inputs:
//   - streamA  (the "base" : comes from the node's primary input port)
//   - streamB  (the "overlay" : comes from the node's secondary input port)
//
// the node chain runner calls it differently from single-input nodes:
//   processLayerMask(streamA, params, context, streamB)

import { buildLaunchpadGrid } from "../midi-layout.js";

// we will be taking only the normal blend method from layer mask

function velToRgb(velocity, palette) {
    const c = palette[velocity] ?? palette [0];
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

function blendVelocities(velA, velB, opacity, palette) {
    if (!palette.length) return velB;
    const [rA, gA, bA] = velToRgb(velA, palette);
    const [rB, gB, bB] = velToRgb(velB, palette);
    const a = opacity;

    let r, g, b;
    r = rA * (1 - a) + rB * a;
    g = gA * (1 - a) + gB * a;
    b = bA * (1 - a) + bB * a;

    return rgbToNearestVel(
        Math.max(0, Math.min(63, Math.round(r))),
        Math.max(0, Math.min(63, Math.round(g))),
        Math.max(0, Math.min(63, Math.round(b))),
        palette
    );
}

// main processor ────────────────────────────────────────────────────

/**
 * @param {object[]} streamA    - base stream (primary input)
 * @param {object}   params
 * @param {object}   context    - { device, palette }
 * @param {object[]} streamB    - overlay stream (secondary input)
 * @returns {object[]}
 */
export function processMerge(streamA, params, context, streamB = []) {
    const {
        opacity = 1.0,
        timeOffset = 0,
    } = params;

    const { palette = [] } = context;

    // apply time offset to B
    const offsetB = streamB.map(ev => ({
        ...ev,
        absTime: ev.absTime + timeOffset,
    }));

    // same timestamp + same pad = collision
    const merged = new Map();

    // insert stream A
    for (const ev of streamA) {
        const key = `${ev.absTime}:${ev.noteNum}`;
        merged.set(key, { ...ev });
    }

    // merge stream B
    for (const ev of offsetB) {
        const key = `${ev.absTime}:${ev.noteNum}`;

        const existing = merged.get(key);

        // no collision → just add it
        if (!existing) {
            merged.set(key, { ...ev });
            continue;
        }

        // collision → blend velocities
        merged.set(key, {
            ...existing,
            velocity: blendVelocities(
                existing.velocity,
                ev.velocity,
                opacity,
                palette
            ),
        });
    }

    return [...merged.values()].sort(
        (a, b) =>
            a.absTime - b.absTime ||
            a.noteNum - b.noteNum
    );
}