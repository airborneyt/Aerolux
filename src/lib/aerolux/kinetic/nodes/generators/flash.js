// src/lib/aerolux/kinetic/nodes/generators/flash.js
// all pads flash in sync, or staggered by row/column.
// flash is a self-contained generator that decays from full brightness after each periodic flash.

import { resolvePaletteColour, clamp63 } from "../../sharedHelpers";

export function createFlashField(params, context) {
    const {
        colourIdx      = 8,         // palette index (to be refactored to support gradient selection too)
        interval       = 96,        // ticks between flashes
        decayTicks     = 30,        // ticks for brightness to fall from 1 to 0 after each flash
        stagger        = 'none',    // 'none' | 'row' | 'column'
        staggerAmount  = 4,         // ticks of delay applied per row/column index
    } = params;

    const rgb = resolvePaletteColour(context?.palette, colourIdx);
    const decaySpan = Math.max(decayTicks, 1);

    return {
        kind: 'stateless',
        sample(x, y, t) {
            let localT = t;
            if (stagger === 'row') localT -= Math.round(y) * staggerAmount;
            else if (stagger === 'column') localT -= Math.round(x) * staggerAmount;
            if (localT < 0) return null;

            const phase = ((localT % interval) + interval) % interval;
            const decay = Math.max(0, 1 - phase / decaySpan);
            if (decay <= 0) return null;
            return rgb.map(v => clamp63(v * decay));
        },
    };
}