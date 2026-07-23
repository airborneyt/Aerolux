// src/lib/aerolux/kinetic/nodes/colour/satMult.js
// multiplies the saturation of the input colour through an animatable value.
// supports extrapolation.

import { colourMapField, nullField } from "../../field";
import { rgb63ToHsl, hslToRgb63 } from "../../colourMath";

export function createSatMultField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    return colourMapField(inputField, (rgb, x, y, t) => {
        const multiplier = resolveParam && t !== undefined ? resolveParam('multiplier', t) : (params.multiplier ?? 100);
        const { h, s, l } = rgb63ToHsl(rgb[0], rgb[1], rgb[2]);
        const newS = Math.max(0, Math.min(2, s * (multiplier / 100)));
        return hslToRgb63(h, newS, l);
    });
}