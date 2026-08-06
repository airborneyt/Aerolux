// src/lib/aerolux/kinetic/nodes/generators/noise.js
// each pad gets a randomly (but deterministically, seed-repeatable) offset phase of the same wave, creating an organic shimmer.

// the per-pad phase hash is a simple deterministic sine-based scramble.
// this node might be enhanced with more noise variants in the future.

import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts } from "../../sharedHelpers";
import { colourCycleField } from "../../field";

function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

export function createNoiseField(params, context, inputField, inputFieldB, resolveParam, integrateParam) {
    const {
        phaseRange    = 1,     // 0-1, how much of the full cycle each pad's phase is spread over
        seed          = 0,     // randomisation
        minBrightness = 0.15,  // floor so pads don't go fully black
    } = params;

    const shapeField = {
        kind: 'stateless',
        sample(x, y, t) {
            const cellPhase = hashToUnit(Math.round(x), Math.round(y), seed) * phaseRange;
            const cyclesElapsed = integrateParam
                ? integrateParam('speed', t)
                : (params.speed ?? 0.01) * t;
            const wave = (Math.sin(2 * Math.PI * (cyclesElapsed + cellPhase)) + 1) / 2; // 0..1
            const brightness = minBrightness + (1 - minBrightness) * wave;
            return brightness > 0 ? brightness : null;
        },
    };

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { ...resolveCycleOpts(params.colour) });
}
