// src/lib/aerolux/kinetic/nodes/temporal/delay.js
// offsets the upstream field's time backward by a fixed number of ticks, so its effect appears to start later than the rest of the graph.

import { timeMapField, nullField } from "../../field";

export function createDelayField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const { delayTicks = 48 } = params;

    return timeMapField(inputField, (t) => {
        const delay = resolveParam ? resolveParam('delayTicks', t) : delayTicks;
        return Math.max(0, t - delay);
    });
}