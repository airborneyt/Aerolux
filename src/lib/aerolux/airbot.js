// src/lib/aerolux/airbot.js
// airbot model constants and utility functions.

import { findNearest } from './gradient.js';
import { gradToText, safeFilename } from './utils.js';

export const AI_MODEL = 'Qwen3-8B-q4f16_1-MLC';
export const AI_MODEL_SIZE = 'large';

export const AI_SYSTEM_PROMPT =
`/nothink
you are a JSON API. your entire response must be a single JSON object and nothing else. do not write any words, notes, or explanation, only the JSON object itself, starting with { and ending with }.
think as concisely as possible, use as little words as you can.

output this exact structure:
{
"name":"string",
"description":"string",
"stops":[
{"pos":0.0,"r":0,"g":0,"b":0},
{"pos":1.0,"r":0,"g":0,"b":0}],
"length":8,
"algorithm":"rgb | lab | hsl | vivid | stepped",
- hslDir: one of: shortest longest   (only used when algorithm is "hsl"),
"easing":"linear | easeIn | easeOut | sCurve | cubicIn | cubicOut | sineIn | sineOut | sineBoth | expoIn | expoOut | bounce | elastic"
}

algorithm advantages:
- rgb: simple and fast, but may produce muddy results
- lab: perceptually uniform, good for smooth gradients, but slower
- hsl: intuitive hue/saturation/lightness control, but can have uneven saturation transitions. can easily generate rainbow gradients even with limited stops by manipulating the direction.
- vivid: designed to maximise colourfulness, great for vibrant gradients, but can be less predictable
- stepped: creates distinct colour bands, ideal for posterisation or pixel art styles, but not suitable for smooth blends

rules:
- be creative. use any advantage you can get from the algorithms and easing options
- name: short gradient name, plain text, no quotes inside
- description: one sentence, plain text
- stops: 2 to 8 entries. First pos must be 0.0, last must be 1.0
- r g b: plain integers 0 to 255, no variables or placeholders
- length: integer 2 to 16
- algorithm: exactly one of: rgb lab hsl vivid stepped
- easing: exactly one of: linear easeIn easeOut sCurve cubicIn cubicOut
- output ONLY the JSON object. first character is {. Last character is }.`;

export const PLACEHOLDER_EXAMPLES = [
  'desert at sunset, warm oranges and deep reds, 16 stops, rgb algorithm, easeIn',
  'deep ocean, dark teals fading to black, 12 stops, hsl algorithm, sCurve easing',
  'northern lights, greens and purples across a dark sky, 10 stops, vivid algorithm, easeOut easing',
  'tropical forest, vivid greens with dappled yellow, 8 stops, stepped algorithm, linear easing',
  'neon city at night, electric blues and hot pinks, 14 stops, lab algorithm, cubicIn easing',
  'autumn forest, burnt oranges, yellows, and russet browns, 12 stops, hsl algorithm, sCurve easing',
  'snowstorm, cold whites and steel greys, 8 stops, rgb algorithm, easeOut easing',
  'volcano, glowing magma oranges fading to charcoal, 10 stops, vivid algorithm, cubicOut easing',
  'cherry blossom, soft pinks into pale white, 16 stops, lab algorithm, easeIn easing',
  'thunderstorm, dark purples with electric yellow, 12 stops, stepped algorithm, easeOut easing',
  'sunrise over mountains, lavender into warm gold, 14 stops, rgb algorithm, sCurve easing',
  'deep space, navy black with violet and cyan nebulae, 10 stops, vivid algorithm, easeOut easing',
];

export function colorToNearestPalette(r255, g255, b255, palette) {
  return findNearest(
    [r255 * 63/255, g255 * 63/255, b255 * 63/255],
    palette,
    'rgb'
  );
}

export function downloadSingleAiGradient(result, name) {
  const text = gradToText(result.velocities);
  const vels = result.velocities.map(v => v.velocity).join('_');
  const filename = `${safeFilename(name)}_${vels}`;
  return { text, filename };  // just returns the data, does nothing else
}