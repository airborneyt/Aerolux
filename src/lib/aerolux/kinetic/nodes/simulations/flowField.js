// src/lib/aerolux/kinetic/nodes/simulations/flowField.js
import { statefulField } from '../../field.js';
import { createStepAccumulator, clamp63 } from '../../sharedHelpers.js';

function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}
function flowAngle(x, y, t, noiseScale, seed, swirlSpeed) {
    const cellX = Math.floor(x / noiseScale), cellY = Math.floor(y / noiseScale);
    return hashToUnit(cellX, cellY, seed) * Math.PI * 2 + t * swirlSpeed;
}

export function createFlowFieldField(params, context, inputField) {
    const {
        resolution = 9, noiseScale = 3, swirlSpeed = 0.002,
        decay = 0.92, pushFraction = 0.6, seed = 0, stepsPerSecond = 20,
    } = params;
    const size = resolution + 1;
    const accumulator = createStepAccumulator(stepsPerSecond);
    let buffer = null;

    return statefulField({},
        (state, dt, ctx) => {
            if (inputField?.kind === 'stateful') inputField.advance(dt, ctx);
            if (!buffer) buffer = new Map();
            const steps = accumulator.tick(dt);
            const t = ctx?.currentTick ?? 0;
            for (let s = 0; s < steps; s++) {
                // decay existing dye
                for (const [key, rgb] of buffer) {
                    const faded = rgb.map(v => v * decay);
                    if (faded[0] < 0.5 && faded[1] < 0.5 && faded[2] < 0.5) buffer.delete(key);
                    else buffer.set(key, faded);
                }
                // advect: push each cell's dye toward the local flow direction
                const next = new Map(buffer);
                for (const [key, rgb] of buffer) {
                    const [gx, gy] = key.split(',').map(Number);
                    const angle = flowAngle(gx, gy, t, noiseScale, seed, swirlSpeed);
                    const nx = Math.round(gx + Math.cos(angle)), ny = Math.round(gy + Math.sin(angle));
                    if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
                    const nkey = `${nx},${ny}`;
                    const existing = next.get(nkey) ?? [0, 0, 0];
                    const pushed = rgb.map(v => v * pushFraction);
                    next.set(nkey, [Math.max(existing[0], pushed[0]), Math.max(existing[1], pushed[1]), Math.max(existing[2], pushed[2])]);
                }
                buffer = next;
                // inject fresh dye wherever input is lit
                if (inputField) {
                    for (let gy = 0; gy < size; gy++) {
                        for (let gx = 0; gx < size; gx++) {
                            const rgb = inputField.kind === 'stateful' ? inputField.sample(gx, gy) : inputField.sample(gx, gy, t);
                            if (!rgb) continue;
                            const key = `${gx},${gy}`;
                            const existing = buffer.get(key) ?? [0, 0, 0];
                            buffer.set(key, [Math.max(existing[0], rgb[0]), Math.max(existing[1], rgb[1]), Math.max(existing[2], rgb[2])]);
                        }
                    }
                }
            }
        },
        (state, x, y) => {
            if (!buffer) return null;
            const rgb = buffer.get(`${Math.round(x)},${Math.round(y)}`);
            return rgb ? rgb.map(clamp63) : null;
        });
}