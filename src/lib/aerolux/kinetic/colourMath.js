// src/lib/aerolux/kinetic/colourMath.js
// ============================================================================
// KINETIC ENGINE: COLOUR MATH
// small, dependency-free RGB63<->HSL conversion for colour nodes.
//
// deliberately NOT imported from Velocity's lib/aerolux/palette.js, even
// though that file has equivalent functions. Kinetic's engine (field.js,
// nodeRegistry.js, this file) never imports from a store or from Velocity's
// modules, so it stays independent with zero app context, exactly
// like every other engine file in this project. this decision may be reversed
// in the future, but for now is good enough.
//
// operates directly in 6-bit (0-63) space.
// ============================================================================

/**
 * @param {number} r 0-63
 * @param {number} g 0-63
 * @param {number} b 0-63
 * @returns {{h:number, s:number, l:number}} each 0-1
 */
export function rgb63ToHsl(r, g, b) {
    const rn = r / 63, gn = g / 63, bn = b / 63;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;

    if (max === min) return { h: 0, s: 0, l };

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h;
    if (max === rn)      h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else                 h = (rn - gn) / d + 4;
    h /= 6;

    return { h, s, l };
}

function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

/**
 * @param {number} h 0-1
 * @param {number} s 0-1
 * @param {number} l 0-1
 * @returns {[number,number,number]} each 0-63, rounded
 */
export function hslToRgb63(h, s, l) {
    if (s === 0) {
        const v = Math.round(l * 63);
        return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 63),
        Math.round(hue2rgb(p, q, h) * 63),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 63),
    ];
}