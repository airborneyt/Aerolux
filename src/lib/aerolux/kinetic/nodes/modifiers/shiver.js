// src/lib/aerolux/kinetic/nodes/modifiers/shiver.js

import { nullField, transformField } from "../../field";
import { kinetic } from "../../../../../stores/kinetic.svelte";

function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

export function createShiverField(params, context, inputField) {
    if (!inputField) return nullField;
    const { jitter = 0.4, rateHz = 12, seed = 0 } = params;
    return transformField(inputField, (x, y, t) => {
        const tSec = t / kinetic.transport.timeDiv;
        const phase = Math.floor(tSec * rateHz);
        const n1 = hashToUnit(Math.round(x), Math.round(y), seed + phase) - 0.5;
        const n2 = hashToUnit(Math.round(x) + 71, Math.round(y) + 13, seed + phase) - 0.5;
        return { x: x + n1 * jitter, y: y + n2 * jitter };
    });
}