// src/lib/aerolux/kinetic/nodes/colour/posterise.js
// simplifies the number of colour stops in the input. animatable.

import { colourMapField, nullField } from '../../field.js';

export function createPosteriseField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const posterisationLevel = resolveParam 
        ? resolveParam('level', context?.currentTick ?? 0) 
        : (params.level ?? 100);
    const quantisationFactor = posterisationLevel / 100;
    return colourMapField(inputField, (rgb, x, y, t) => {
        if (!rgb) return null;
        const [r_in, g_in, b_in] = rgb;
        const steps = Math.max(1, Math.ceil(1 / quantisationFactor));
        const quantise = (value) => {
            const bucketIndex = Math.floor(value / (63 / steps));
            return Math.round(bucketIndex * (63 / steps));
        };
        const r_out = quantise(r_in);
        const g_out = quantise(g_in);
        const b_out = quantise(b_in);
        return [r_out, g_out, b_out];
    });
}