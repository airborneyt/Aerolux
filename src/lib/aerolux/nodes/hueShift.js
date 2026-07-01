// src/lib/aerolux/nodes/hueShift.js
// Rotates the hue of every velocity through the palette.
// Uses the same hue-shift logic as the Velocity editor.

import { toHSL, hslToRgb63, } from '../palette.js';
import { findNearest } from '../gradient.js'

/**
 * @param {object[]} noteOns
 * @param {{ degrees, satMult }} params
 * @param {{ palette }} context
 * @returns {object[]}
 */
export function processHueShift(noteOns, params, context) {
    const { degrees = 0, satMult = 1.0 } = params;
    const { palette } = context;
    if (!palette?.length) return noteOns;
    if (degrees === 0 && satMult === 1.0) return noteOns;

    const hueShift = degrees / 360;

    return noteOns.map(ev => {
        const c = palette[ev.velocity] ?? palette[0];
        const { h, s, l } = toHSL(c.r, c.g, c.b);
        const newH = ((h + hueShift) % 1 + 1) % 1;
        const newS = Math.max(0, Math.min(1, s * satMult));
        const rgb  = hslToRgb63(newH, newS, l);
        const newVel = findNearest(rgb, palette, 'rgb');
        return { ...ev, velocity: newVel };
    });
}