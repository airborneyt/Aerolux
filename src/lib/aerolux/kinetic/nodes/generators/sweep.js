// src/lib/aerolux/kinetic/nodes/generators/sweep.js
// a repeating coloured band travelling across the canvas in any direction.

import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts } from '../../sharedHelpers.js';
import { colourCycleField } from '../../field.js';

export function createSweepField(params, context, inputField, inputFieldB, resolveParam, integrateParam) {
    const { 
        angleDegrees = 0,   // sweep direction; 0 = along +x, 90 = along +y
        period       = 4    // how often a new line is fired 
    } = params;
    const per  = Math.max(period, 0.0001); // guard against div-by-zero on a bad param
    const rad  = angleDegrees * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = Math.sin(rad);

    // Hard on/off shape -- brightness is always 1 while inside the band,
    // null outside it. See ripple.js for the continuous-brightness case
    // this same contract also covers with zero extra code here.
    const shapeField = {
        kind: 'stateless',
        sample(x, y, t) {
            const bandWidth = resolveParam ? resolveParam('bandWidth', t) : (params.bandWidth ?? 1);
            const pos    = x * dirX + y * dirY;
            const offset = integrateParam ? integrateParam('speed', t) : (params.speed ?? 0.05) * t;
            let local = (pos - offset) % per;
            if (local < 0) local += per;
            return local < bandWidth ? 1 : null;
        },
    };

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { ...resolveCycleOpts(params.colour) });
}