// src/lib/aerolux/kinetic/sharedHelpers.js
// ============================================================================
// KINETIC ENGINE: SHARED HELPERS
//
// small utility colour functions used by nodes. not used by anything
// engine-specific or major.
//
// not imported from Velocity even though the other editor has similar
// functions. this is so that both editors stay independent.
// ============================================================================

/**
    resolves a palette index to raw 6-bit RGB. falls back to a visible grey
    rather than silently disappearing if the index or palette is missing, so a
    misconfigured node is obvious in preview instead of invisible.

@param {Array<{i,r,g,b}>|undefined} palette
@param {number} idx
@returns {[number,number,number]}
*/
export function resolvePaletteColour(palette, idx) {
    const entry = palette?.[idx];
    if (!entry) return [40, 40, 40];
    return [entry.r, entry.g, entry.b];
}

export function clamp63(v) { return Math.max(0, Math.min(63, Math.round(v))); }