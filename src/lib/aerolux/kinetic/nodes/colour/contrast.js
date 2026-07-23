// src/lib/aerolux/kinetic/nodes/colour/contrast.js
// manipulates the contrast of the input through an animatable knob.
// does support extrapolation, but clamped to a maximum value of 2.

import { colourMapField, nullField } from '../../field.js';
import { rgb63ToHsl, hslToRgb63 } from '../../colourMath.js';

export function createContrastField(params, context, inputField, inputFieldB, resolveParam) { 
  if (!inputField) return nullField; 
  return colourMapField(inputField, (rgb, x, y, t) => { 
    const multiplier = resolveParam && t !== undefined 
      ? resolveParam('multiplier', t) 
      : (params.multiplier ?? 100); 
    // convert multiplier to a factor (e.g., 100 -> 1.0, 150 -> 1.5, 50 -> 0.5)
    const factor = multiplier / 100;
    // convert input RGB to HSL (0-63 RGB -> 0-1 HSL) 
    const { h, s, l } = rgb63ToHsl(rgb[0], rgb[1], rgb[2]); 
    // calculate true contrast using 0.5 as the baseline midpoint
    const newL = Math.max(0, Math.min(1, 0.5 + (l - 0.5) * factor)); 
    // convert back to RGB63 
    return hslToRgb63(h, s, newL); 
  }); 
}
