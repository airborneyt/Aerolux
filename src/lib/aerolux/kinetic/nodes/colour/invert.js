// src/lib/aerolux/kinetic/nodes/colour/invert.js
// inverts the colour of the input.
// an animatable knob for some cool trippy effects.

import { colourMapField, nullField } from "../../field";
import { clamp63 } from "../../sharedHelpers";

export function createInvertField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const { intensity = 0 } = params;
    return colourMapField(inputField, (rgb, x, y, t) => {
        const rawIntensity = resolveParam ? resolveParam('intensity', t) : (params.intensity ?? 0);
        const intensityFactor = rawIntensity / 100.0; 
        if (!rgb) return null;
        const [r, g, b] = rgb;
        const lerpR = r * (1.0 - intensityFactor) + (63 - r) * intensityFactor;
        const lerpG = g * (1.0 - intensityFactor) + (63 - g) * intensityFactor;
        const lerpB = b * (1.0 - intensityFactor) + (63 - b) * intensityFactor;
        return [
            clamp63(lerpR),
            clamp63(lerpG),
            clamp63(lerpB),
        ];
    });
}