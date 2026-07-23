// src/lib/aerolux/kinetic/nodes/generators/ripple.js
// multiple overlapping pulses at configurable intervals.

// might be updated to support different ring chapes in the future.

import { resolvePaletteColour, clamp63 } from "../../sharedHelpers";

export function createRippleField(params, context, inputField, inputFieldB, resolveParam, integrateParam) {
    const {
        originX        = 4.5,
        originY        = 4.5,
        ringWidth      = 1.2, // how thick a single ripple ring is
        colourIdx      = 8,
        rippleInterval = 96,  // ticks between successive ripple launches
        rippleCount    = 4,   // max simultaneous ripples considered (bounds the loop)
        decay          = 0.7, // brightness multiplier per ripple age-step (older = dimmer)
    } = params;

    const rgb = resolvePaletteColour(context?.palette, colourIdx);
    const interval = Math.max(rippleInterval, 1); // guard against div-by-zero/negative

    return {
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

            if (bestBrightness <= 0) return null;
            return rgb.map(v => clamp63(v * bestBrightness));
        },
    };
}