// src/lib/aerolux/kinetic/nodes/colour/gamma.js
// corrects the gamma of the input by applying a power-law correction to the luminance.
// animatable knob.
// gamma > 1 brightens shadows (darker input -> lighter output)
// gamma < 1 darkens highlights (brighter input -> darker output)

import { colourMapField, nullField } from '../../field.js';
import { rgb63ToHsl, hslToRgb63 } from '../../colourMath.js'; 

export function createGammaField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const gamma = resolveParam ? resolveParam('gamma', 0) : (params.gamma ?? 1.0);
    return colourMapField(inputField, (rgb, x, y, t) => {
        const [r, g, b] = rgb;
        const { h, s, l: L_in_fraction } = rgb63ToHsl(r, g, b); 
        let L_out_fraction;
        if (L_in_fraction === 0) {
            L_out_fraction = 0;
        } else {
            L_out_fraction = Math.pow(L_in_fraction, gamma);
        }
        return hslToRgb63(h, s, L_out_fraction); 
    });
}