// ════════════════════════════════════════════════════════════════════
// src/lib/aerolux/nodes/gen_ripple.js
// Ripple generator. Produces concentric rings expanding from one or
// more origin points across the pad grid over time.
// Pure JS — no DOM, no stores.
// ════════════════════════════════════════════════════════════════════

import { buildLaunchpadGrid, ZONE } from '../midi-layout.js';

// ── Distance (Euclidean in grid coords x=1..8, y=1..8) ───────────
function dist(ax, ay, bx, by) {
    return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

// ── Origin resolver ───────────────────────────────────────────────
// Returns an array of {x,y} points that act as ripple sources.
// Multi-origin configs produce constructively interfering rings —
// each pad uses its minimum distance to any origin.
function resolveOrigins(origin) {
    switch (origin) {
        case 'center':      return [{ x: 4.5, y: 4.5 }];
        case 'tl':          return [{ x: 0,   y: 9   }];
        case 'tr':          return [{ x: 9,   y: 9   }];
        case 'bl':          return [{ x: 0,   y: 0   }];
        case 'br':          return [{ x: 9,   y: 0   }];
        case 'all_corners': return [
            { x:0,y:9 }, { x:9,y:9 }, { x:0,y:0 }, { x:9,y:0 },
        ];
        case 'top_edge': return Array.from({ length:8 }, (_,i) => ({ x:i+1, y:9 }));
        case 'bottom_edge': return Array.from({ length:8 }, (_,i) => ({ x:i+1, y:0 }));
        case 'right_edge': return Array.from({ length:8 }, (_,i) => ({ x:9, y:i+1 }));
        case 'left_edge': return Array.from({ length:8 }, (_,i) => ({ x:0, y:i+1 }));
        default:            return [{ x: 4.5, y: 4.5 }];
    }
}

// ── Brightness at a pad given the ripple front position ───────────
// d         — this pad's distance from the nearest origin
// front     — current radius of the expanding wavefront (grid units)
// trailLen  — how many grid units of decay trail follow the front
// falloff   — 'linear' | 'exp' | 'sharp'
//
// Returns 0..1. Pads ahead of the front return 0 (not yet reached).
// Pads at the front return 1. Pads in the trail decay based on falloff.
function rippleBrightness(d, front, trailLen, falloff) {
    const lag = front - d;          // how far behind the front is this pad
    if (lag < 0) return 0;          // not yet reached
    if (trailLen <= 0) return lag < 0.5 ? 1.0 : 0.0;  // sharp single-ring

    const t = Math.min(lag / trailLen, 1.0);  // normalised 0..1 within trail

    switch (falloff) {
        case 'exp':   return Math.exp(-t * 3.5);  // fast drop, long tail
        case 'sharp': return t < 0.15 ? 1.0 : 0; // hard ring edge
        default:      return 1.0 - t;             // linear
    }
}

// ── Main processor ────────────────────────────────────────────────
export function processRipple(_noteOns, params, context) {
    // _noteOns is always [] for generators — generators create, not transform.
    const {
        colourIdx      = 1,
        gradientRef    = null,
        origin         = 'center',
        speed          = 2.0,
        trailLength    = 2.5,
        falloff        = 'linear',
        repeatInterval = 4.0,
        includeEdges   = false,
    } = params;

    const ticksPerSec = (context.bpm / 60) * context.timeDiv;
    const durationSec = context.totalDuration / ticksPerSec;

    // Build the cell list for the active device.
    // This is the same list VirtualLP uses, so coordinates match.
    const cells   = buildLaunchpadGrid(context.device ?? 'LPP2');
    const origins = resolveOrigins(origin);

    // Maximum possible distance from any origin to any grid corner.
    // Once the front exceeds this + trailLength, all pads are dark.
    const MAX_DIST = 12.0; // safe upper bound for an 8×8 grid

    const noteOns = [];

    // Sample the animation at a rate matching the timeDiv (one frame per beat
    // subdivision). 8th notes at 120bpm = 60fps — good resolution without
    // generating excessive events.
    const FRAME_TICKS = Math.max(1, Math.round(context.timeDiv / 2));

    for (let tick = 0; tick < context.totalDuration; tick += FRAME_TICKS) {
        const tSec = tick / ticksPerSec;

        // Determine ripple front radius at this time.
        // If repeatInterval > 0, modulo the time so the animation loops.
        const tMod = repeatInterval > 0 ? tSec % repeatInterval : tSec;
        const front = tMod * speed;

        // Early exit: if the front has passed all pads and the trail has fully
        // decayed, this frame is completely dark. Skip it.
        if (front > MAX_DIST + trailLength) continue;

        for (const cell of cells) {
            if (cell.exportNote === null) continue;
            if (!includeEdges && cell.zone !== ZONE.MAIN) continue;

            // Distance from this pad to the nearest origin.
            let minDist = Infinity;
            for (const o of origins) {
                const d = dist(cell.x, cell.y, o.x, o.y);
                if (d < minDist) minDist = d;
            }

            const brightness = rippleBrightness(minDist, front, trailLength, falloff);
            if (brightness < 0.01) continue;  // dark pad — skip

            // Scale the palette colour by brightness.
            // We pick the palette index that is closest to the dimmed colour
            // by simply using the colourIdx at full brightness and letting
            // the velocity system handle display — but for a proper dim effect,
            // we reduce velocity proportionally (lower index = darker for most
            // palette entries). A future improvement: nearest-colour lookup.
            const scaledVelocity = Math.max(1, Math.round(colourIdx * brightness));

            noteOns.push({
                absTime:  tick,
                noteNum:  cell.exportNote,   // drum-rack note number
                velocity: scaledVelocity,    // palette index
            });
        }
    }

    return noteOns;
}