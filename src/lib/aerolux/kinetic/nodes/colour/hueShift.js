// src/lib/aerolux/kinetic/nodes/colour/hueShift.js
// shifts the hue of the input in a similar fashion as velocity.
// calculations are kept separate and not imported from velocity to keep the two
// editors independent.
// animatable knob.

import { colourMapField, nullField } from "../../field";
import { rgb63ToHsl, hslToRgb63 } from "../../colourMath";

export function createHueShiftField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    return colourMapField(inputField, (rgb, x, y, t) => {
        const degrees = resolveParam && t !== undefined ? resolveParam('degrees', t) : (params.degrees ?? 0);
        const { h, s, l } = rgb63ToHsl(rgb[0], rgb[1], rgb[2]);
        const newH = ((h + degrees / 360) % 1 + 1) % 1;
        return hslToRgb63(newH, s, l);
    });
}