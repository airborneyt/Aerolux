// src/lib/aerolux/kinetic/nodes/transforms/scale.js
// resizes the input at the pivot point through the multiplication factor provided.

import { transformField, nullField } from "../../field";

export function createScaleField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const { pivotX = 0, pivotY = 0 } = params;
    return transformField(inputField, (x, y, t) => {
        const scaleArg = resolveParam ? resolveParam('scale', t) : (params.scale ?? 1);
        const s = scaleArg === 0 ? 0.0001 : scaleArg; // guard divide-by-zero
        return {
            x: (x - pivotX) / s + pivotX,
            y: (y - pivotY) / s + pivotY,
        };
    });
}