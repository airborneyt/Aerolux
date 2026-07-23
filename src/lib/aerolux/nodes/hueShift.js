import { colourMapField, nullField } from '../kinetic/field.js';
import { rgb63ToHsl, hslToRgb63 } from '../kinetic/colourMath.js';

export function createHueShiftField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    return colourMapField(inputField, (rgb, x, y, t) => {
        const degrees = resolveParam && t !== undefined ? resolveParam('degrees', t) : (params.degrees ?? 0);
        const { h, s, l } = rgb63ToHsl(rgb[0], rgb[1], rgb[2]);
        const newH = ((h + degrees / 360) % 1 + 1) % 1;
        return hslToRgb63(newH, s, l);
    });
}