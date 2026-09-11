// src/lib/aerolux/kinetic/nodes/modifiers/turbulence.js

import { transformField, nullField } from "../../field";

function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

export function createTurbulenceField(params, context, inputField) {
    if (!inputField) return nullField;
    const { amount = 1.5, scale = 0.5, speed = 0.02, seed = 0 } = params;
    return transformField(inputField, (x, y, t) => {
        const n1 = hashToUnit(Math.round(x * scale * 10), Math.round((y + t * speed) * scale * 10), seed) - 0.5;
        const n2 = hashToUnit(Math.round((x + t * speed) * scale * 10), Math.round(y * scale * 10), seed + 1) - 0.5;
        return { x: x + n1 * amount, y: y + n2 * amount };
    });
}