// src/lib/aerolux/kinetic/nodes/temporal/clockScale.js
// speeds up or slows down time reaching the upstream field by a constant multiplier.

import { timeMapField, nullField } from "../../field";

export function createClockScaleField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const { factor = 1 } = params;

    return timeMapField(inputField, (t) => {
        const f = resolveParam ? resolveParam('factor', t) : factor;
        return t * f;
    });
}