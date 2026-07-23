// src/lib/aerolux/kinetic/nodes/utility/math.js
// allows users to use mathematical calculations on input streams.

import { clamp63 } from '../../sharedHelpers.js';

export function createMathOperatorField(params, context, inputField, inputFieldB, resolveParam) {
    const { operation = 'add', minVal = 0, maxVal = 63, lowVal = 0, highVal = 63 } = params;
    return {
        kind: 'stateless',
        sample(x, y, t) {
            const a = inputField ? inputField.sample(x, y, t) : null;
            const b = inputFieldB ? inputFieldB.sample(x, y, t) : null;
            if (!a && !b) return null;
            if (!a) return b;
            if (!b) return a;
            const [r1, g1, b1] = a;
            const [r2, g2, b2] = b;
            switch (operation) {
            case 'add':
                return [
                    clamp63(r1 + r2),
                    clamp63(g1 + g2),
                    clamp63(b1 + b2),
                ];
            case 'sub':
                return [
                    clamp63(r1 - r2),
                    clamp63(g1 - g2),
                    clamp63(b1 - b2),
                ];
            case 'mul':
                return [
                    clamp63(r1 * r2),
                    clamp63(g1 * g2),
                    clamp63(b1 * b2),
                ];
            case 'div':
                return [
                    clamp63(r2 === 0 ? 0 : Math.round(r1 / r2)),
                    clamp63(g2 === 0 ? 0 : Math.round(g1 / g2)),
                    clamp63(b2 === 0 ? 0 : Math.round(b1 / b2)),
                ];
            case 'mod':
                return [
                    clamp63(r1 % r2),
                    clamp63(g1 % g2),
                    clamp63(b1 % b2),
                ];
            case 'clamp':
                return [
                    clamp63(Math.max(minVal, Math.min(maxVal, r1))),
                    clamp63(Math.max(minVal, Math.min(maxVal, g1))),
                    clamp63(Math.max(minVal, Math.min(maxVal, b1))),
                ];
            case 'remap':
                const rangeIn = highVal - lowVal || 1;
                const rangeOut = maxVal - minVal || 1;
                const mappedR = clamp63(minVal + Math.round(((r1 - lowVal) / rangeIn) * rangeOut));
                const mappedG = clamp63(minVal + Math.round(((g1 - lowVal) / rangeIn) * rangeOut));
                const mappedB = clamp63(minVal + Math.round(((b1 - lowVal) / rangeIn) * rangeOut));
                return [mappedR, mappedG, mappedB];

            case 'lerp':
                if (!b) return [r1, g1, b1];
                return [
                    clamp63(Math.round(r1 + (r2 - r1) * 0.5)),
                    clamp63(Math.round(g1 + (g2 - g1) * 0.5)),
                    clamp63(Math.round(b1 + (b2 - b1) * 0.5)),
                ];

            default:
                return [r1, g1, b1];
            }
        },
    };
}