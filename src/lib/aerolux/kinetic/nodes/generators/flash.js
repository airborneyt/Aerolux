// src/lib/aerolux/kinetic/nodes/generators/flash.js
// all pads flash in sync, or staggered by row/column.
// flash is a self-contained generator that decays from full brightness after each periodic flash.

import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts } from "../../sharedHelpers";
import { colourCycleField } from "../../field";

export function createFlashField(params, context) {
    const {
        interval       = 96,        // ticks between flashes
        decayTicks     = 30,        // ticks for brightness to fall from 1 to 0 after each flash
        stagger        = 'none',    // 'none' | 'row' | 'column'
        staggerAmount  = 4,         // ticks of delay applied per row/column index
    } = params;

    const decaySpan = Math.max(decayTicks, 1);

    const shapeField = {
        kind: 'stateless',
        sample(x, y, t) {
            let localT = t;
            if (stagger === 'row') localT -= Math.round(y) * staggerAmount;
            else if (stagger === 'column') localT -= Math.round(x) * staggerAmount;
            if (localT < 0) return null;

            const phase = ((localT % interval) + interval) % interval;
            const decay = Math.max(0, 1 - phase / decaySpan);
            return decay > 0 ? decay : null;
        },
    };

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { ...resolveCycleOpts(params.colour) });
}