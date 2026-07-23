// src/lib/aerolux/kinetic/nodes/transforms/shift.js
// translates the input field by the values provided.

import { transformField, nullField } from "../../field";

// translation is done inversely, i.e. moving the input to the right requires a calculation to the left.

export function createShiftField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const shiftXArg = resolveParam ? (t) => resolveParam('shiftX', t) : (params.shiftX ?? 0);
    const shiftYArg = resolveParam ? (t) => resolveParam('shiftY', t) : (params.shiftY ?? 0);

    return transformField(inputField, (x, y, t) => {
      return {
        x: x - shiftXArg(t),
        y: y - shiftYArg(t)
      };
    });
  }