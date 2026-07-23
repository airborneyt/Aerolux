// src/lib/aerolux/kinetic/nodes/utility/blend.js
// two-input field combinator.

// blend differs from logic as it applies depth/layer masking rather than colour masking.

import { clamp63 } from "../../sharedHelpers";

function blendChannel(mode, a, b, opacity) {
    switch (mode) {
        case 'add':      return a + b * opacity;
        case 'multiply': return (a * b / 63) * opacity + a * (1 - opacity);
        case 'max':      return Math.max(a, b * opacity);
        default:         return a * (1 - opacity) + b * opacity; // 'normal'
    }
}

export function createBlendField(params, context, inputField, inputFieldB) {
    const { mode = 'normal', opacity = 1 } = params;
    return {
        kind: 'stateless',
        sample(x, y, t) {
            const a = inputField  ? inputField.sample(x, y, t)  : null;
            const b = inputFieldB ? inputFieldB.sample(x, y, t) : null;
            if (!a && !b) return null;
            if (!a) return b;
            if (!b) return a;
            return [
                clamp63(blendChannel(mode, a[0], b[0], opacity)),
                clamp63(blendChannel(mode, a[1], b[1], opacity)),
                clamp63(blendChannel(mode, a[2], b[2], opacity)),
            ];
        },
    };
}