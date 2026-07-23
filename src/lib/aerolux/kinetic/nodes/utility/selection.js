// src/lib/aerolux/kinetic/nodes/utility/selection.js
// interesting utility node to manipulate and animate thresholds to swap between two inputs.

import { clamp63 } from "../../sharedHelpers";

export function createSelectionField(params, context, inputField, inputFieldB, resolveParam) {
    const { mode = 'switch', threshold = 0, opacity = 0.5 } = params;

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

        // Helper to get animatable value (static or interpolated)
        const getVal = (key, t) => resolveParam ? resolveParam(key, t) : params[key];

        switch (mode) {
          case 'switch':
            // Switch based on a single channel threshold (e.g., Red > Threshold)
            const condition = getVal('threshold', t);
            const isTrue = r1 > condition; // Using Red as the selector signal
            return [
              clamp63(isTrue ? r2 : r1),
              clamp63(isTrue ? g2 : g1),
              clamp63(isTrue ? b2 : b1),
            ];

          case 'blend':
            // Blend the two fields using the opacity parameter
            const op = getVal('opacity', t);
            const factor = op === 1 ? 1 : (op === 0 ? 0 : op);
            
            return [
              clamp63(r1 * (1 - factor) + r2 * factor),
              clamp63(g1 * (1 - factor) + g2 * factor),
              clamp63(b1 * (1 - factor) + b2 * factor),
            ];

          default:
            return [r1, g1, b1];
        }
      },
    };
  }