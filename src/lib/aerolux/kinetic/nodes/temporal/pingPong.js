// src/lib/aerolux/kinetic/nodes/temporal/pingPong.js
// reverses direction at each boundary of a repeating window, so the upstream field indefinitely plays forwards then backwards and repeats.

// timeMapField wrapper: folds the sawtooth `t % (2*period)` back on itself.

import { timeMapField, nullField } from "../../field";

export function createPingPongField(params, context, inputField) {
    if (!inputField) return nullField;
    const { period = 192 } = params;
    const per = Math.max(period, 1);

    return timeMapField(inputField, (t) => {
        const cyclePos = ((t % (2 * per)) + 2 * per) % (2 * per); // 0..2*per, guards negative t
        return cyclePos <= per ? cyclePos : 2 * per - cyclePos;
    });
}