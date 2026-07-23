// src/lib/aerolux/kinetic/nodes/transforms/rotate.js
// huge improvement over the previous rotate node due to the redesigned kinetic engine.
// no snap/shear/nearest4/ area/radial algorithm choice is needed,
// no gap-filling pass required either since this is correct at any angle and at any device resolution.

import { rotateField, nullField } from "../../field";

export function createRotateField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const { pivotX = 0, pivotY = 0 } = params;
    const degreesArg = resolveParam ? (t) => resolveParam('degrees', t) : (params.degrees ?? 0);
    return rotateField(inputField, degreesArg, { x: pivotX, y: pivotY });
}