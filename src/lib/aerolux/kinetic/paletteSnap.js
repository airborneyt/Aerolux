// src/lib/aerolux/kinetic/paletteSnap.js
// ============================================================================
// KINETIC ENGINE: PALETTE SNAPPING
//
// this is THE single place a continuous RGB63 colour gets quantised down to
// one of the launchpad's ~127 fixed palette entries, for the whole pipeline
// every node stays in continuous RGB; only the MIDI-export boundary calls this.
//
// intentionally duplicated rather than imported from Velocity's
// lib/aerolux/gradient.js (which has an equivalent findNearest); same
// reasoning as colourMath.js: Kinetic's engine never imports from a store or
// from Velocity's modules.
// ============================================================================

/**
@param {[number,number,number]} rgb  0-63 each
@param {Array<{i,r,g,b}>|undefined} palette
@returns {number} the closest palette index, by squared Euclidean distance
    in RGB. index 0 is skipped (invalid).
    returns 0 if no palette is given at all (nothing sensible to snap to).
*/
export function findNearestPaletteIndex(rgb, palette) {
    if (!palette?.length) return 0;

    let best = 0;
    let bestDist = Infinity;
    for (const entry of palette) {
        if (entry.i === 0) continue;
        const dr = entry.r - rgb[0];
        const dg = entry.g - rgb[1];
        const db = entry.b - rgb[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            best = entry.i;
        }
    }
    return best;
}