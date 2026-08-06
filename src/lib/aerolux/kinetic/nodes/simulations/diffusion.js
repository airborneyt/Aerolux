// src/lib/aerolux/kinetic/nodes/simulation/diffusion.js
// spreads brightness to neighbouring cells
// 
// this node uses a three-stage pipeline per simulation step:
//   1. INJECT:    any lit upstream pixel adds energy to its own cell
//
//   2. SPREAD:    each cell bleeds a fraction of its value into its
//                 4-neighbourhood (edges clamp, energy that is out of 
//                 bounds is lost
//
//   3. DECAY:     the whole board loses a fraction of its energy, so an
//                 unfed board eventually goes dark rather than reaching a
//                 static equilibrium and staying lit forever

import { statefulField, colourCycleField } from '../../field.js';
import { resolveColourOrGradient, resolveCycleMode, createStepAccumulator } from '../../sharedHelpers.js';

export function createDiffusionField(params, context, inputField) {
    const {
        resolution     = 9,
        diffusionRate  = 0.15, // fraction of a cell's value spread to each orthogonal neighbour per step
        decay          = 0.92, // brightness multiplier applied to the whole board per step
        injectAmount   = 1.0,  // energy added per lit upstream pixel per step
        stepsPerSecond = 20,
    } = params;

    const size = resolution + 1;
    const accumulator = createStepAccumulator(stepsPerSecond);
    const idx = (gx, gy) => gy * size + gx;

    let grid = null;

    const shapeField = statefulField(
        {},
        (state, dt, ctx) => {
            if (inputField?.kind === 'stateful') inputField.advance(dt, ctx);
            if (!grid) grid = new Float64Array(size * size);

            const steps = accumulator.tick(dt);
            const t = ctx?.currentTick ?? 0;

            for (let s = 0; s < steps; s++) {
                // 1. inject
                if (inputField) {
                    for (let gy = 0; gy < size; gy++) {
                        for (let gx = 0; gx < size; gx++) {
                            const lit = inputField.kind === 'stateful'
                                ? inputField.sample(gx, gy)
                                : inputField.sample(gx, gy, t);
                            if (lit) {
                                const key = idx(gx, gy);
                                grid[key] = Math.min(1, grid[key] + injectAmount);
                            }
                        }
                    }
                }

                // 2. spread
                const next = new Float64Array(size * size);
                for (let gy = 0; gy < size; gy++) {
                    for (let gx = 0; gx < size; gx++) {
                        const v = grid[idx(gx, gy)];
                        if (v <= 0) continue;

                        let outflow = 0;
                        const neighbours = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]];
                        for (const [nx, ny] of neighbours) {
                            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
                            const flow = v * diffusionRate;
                            next[idx(nx, ny)] += flow;
                            outflow += flow;
                        }
                        next[idx(gx, gy)] += v - outflow;
                    }
                }

                // 3. decay
                for (let i = 0; i < next.length; i++) next[i] *= decay;
                grid = next;
            }
        },
        (state, x, y) => {
            if (!grid) return null;
            const gx = Math.round(x), gy = Math.round(y);
            if (gx < 0 || gx >= size || gy < 0 || gy >= size) return null;
            const v = grid[idx(gx, gy)];
            return v > 0.003 ? Math.min(1, v) : null;
        },
    );

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { resolution });
}