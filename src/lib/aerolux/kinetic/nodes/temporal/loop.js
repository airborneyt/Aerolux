// src/lib/aerolux/kinetic/nodes/temporal/loop.js
// wraps time into a repeating window starting at `startTick`, so a finite-duration upstream effect repeats indefinitely instead of running once and going dark.

import { timeMapField, nullField } from "../../field";

export function createLoopField(params, context, inputField) {
    if (!inputField) return nullField;
    const { loopLength = 192, startTick = 0 } = params;
    const len = Math.max(loopLength, 1);

    return timeMapField(inputField, (t) => {
        const rel = t - startTick;
        const wrapped = ((rel % len) + len) % len; // guards negative t/rel
        return startTick + wrapped;
    });
}