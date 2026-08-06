// src/lib/aerolux/kinetic/nodes/generators/ripple.js
// multiple overlapping pulses at configurable intervals.
// might be updated to support different ring shapes in the future.

import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts } from '../../sharedHelpers.js';
import { colourCycleField } from '../../field.js';

export function createRippleField(params, context, inputField, inputFieldB, resolveParam, integrateParam) {
    const {
        originX        = 4.5,
        originY        = 4.5,
        ringWidth      = 1.2,
        rippleInterval = 96,  // ticks
        rippleCount    = 4,   // max simultaneous ripples
        decay          = 0.7,
    } = params;

    const interval = Math.max(rippleInterval, 1);

    const shapeField = {
        kind: 'stateless',
        sample(x, y, t) {
            const dist = Math.hypot(x - originX, y - originY);
            const kMax = Math.floor(t / interval);

            let bestBrightness = 0;
            for (let i = 0; i < rippleCount; i++) {
                const k = kMax - i;
                if (k < 0) break; // no ripple has launched yet at this age index
                const launchTick = k * interval;

                const front = integrateParam
                    ? integrateParam('speed', t) - integrateParam('speed', launchTick)
                    : (params.speed ?? 0.08) * (t - launchTick);

                const lag = front - dist;
                if (lag >= 0 && lag <= ringWidth) {
                    const brightness = Math.pow(decay, i);
                    if (brightness > bestBrightness) bestBrightness = brightness;
                }
            }

            return bestBrightness > 0 ? bestBrightness : null;
        },
    };

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { ...resolveCycleOpts(params.colour) });
}