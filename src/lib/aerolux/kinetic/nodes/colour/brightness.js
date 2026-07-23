// src/lib/aerolux/kinetic/nodes/colour/brightness.js
// manipulates the brightness of the input through an animatable knob.
// does not support extrapolating brightness values on purpose,
//  - functionality might be added based on user demand
import { colourMapField, nullField } from "../../field";
import { clamp63 } from "../../sharedHelpers";

export function createBrightnessField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const { brightness = 1.0 } = params;
    return colourMapField(inputField, (rgb, x, y, t) => {
        const bValue = resolveParam ? resolveParam('brightness', t) : (params.brightness ?? 1.0);
        const clampedB = Math.max(0.0, Math.min(1.0, bValue));
        if (!rgb) return null;
        return [
            clamp63(rgb[0] * clampedB),
            clamp63(rgb[1] * clampedB),
            clamp63(rgb[2] * clampedB),
        ];
    });
}