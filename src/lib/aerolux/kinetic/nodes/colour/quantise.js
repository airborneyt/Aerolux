// src/lib/aerolux/kinetic/nodes/colour/quantise.js
// snaps the colour of the input to a specific level based on an animatable threshold.
// allows for cool comic looks, functions differently to posterise.js

import { colourMapField, nullField } from '../../field.js';
import { clamp63 } from '../../sharedHelpers.js';

export function createQuantiseField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const { quantiseStrength = 0.5 } = params;
    return colourMapField(inputField, (rgb, x, y, t) => {
        const strength = resolveParam ? resolveParam('quantiseStrength', t) : quantiseStrength;
        const gridDivisor = 1 + (1 - strength) * 9;
        const [r, g, b] = rgb;
        const quantizedR = Math.round(r / gridDivisor) * gridDivisor;
        const quantizedG = Math.round(g / gridDivisor) * gridDivisor;
        const quantizedB = Math.round(b / gridDivisor) * gridDivisor;
        return [
            clamp63(quantizedR),
            clamp63(quantizedG),
            clamp63(quantizedB),
        ];
    });
}