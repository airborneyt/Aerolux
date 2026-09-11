// src/lib/aerolux/kinetic/nodes/simulations/reactionDiffusion.js
import { statefulField, colourCycleField } from '../../field.js';
import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts, createStepAccumulator } from '../../sharedHelpers.js';

function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

export function createReactionDiffusionField(params, context, inputField) {
    const {
        resolution = 12, feedRate = 0.037, killRate = 0.06,
        diffusionA = 1.0, diffusionB = 0.5, seedDensity = 0.02, injectAmount = 1.0,
        seed = 0, wrapEdges = true, stepsPerSecond = 30, iterationsPerStep = 4,
    } = params;

    const size = resolution + 1;
    const N = size * size;
    const idx = (gx, gy) => gy * size + gx;
    const accumulator = createStepAccumulator(stepsPerSecond);
    let A = null, B = null;

    function seedGrid() {
        A = new Float64Array(N).fill(1);
        B = new Float64Array(N).fill(0);
        for (let gy = 0; gy < size; gy++) {
            for (let gx = 0; gx < size; gx++) {
                if (hashToUnit(gx, gy, seed) < seedDensity) B[idx(gx, gy)] = 1;
            }
        }
    }
    function neighbourSum(grid, gx, gy) {
        let sum = 0;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            let nx = gx + dx, ny = gy + dy;
            if (wrapEdges) { nx = (nx + size) % size; ny = (ny + size) % size; }
            else { nx = Math.max(0, Math.min(size - 1, nx)); ny = Math.max(0, Math.min(size - 1, ny)); }
            sum += grid[idx(nx, ny)];
        }
        return sum;
    }

    const shapeField = statefulField({},
        (state, dt, ctx) => {
            if (inputField?.kind === 'stateful') inputField.advance(dt, ctx);
            if (!A) seedGrid();
            const steps = accumulator.tick(dt);
            const t = ctx?.currentTick ?? 0;
            for (let s = 0; s < steps; s++) {
                if (inputField) {
                    for (let gy = 0; gy < size; gy++) {
                        for (let gx = 0; gx < size; gx++) {
                            const lit = inputField.kind === 'stateful' ? inputField.sample(gx, gy) : inputField.sample(gx, gy, t);
                            if (lit) B[idx(gx, gy)] = Math.min(1, B[idx(gx, gy)] + injectAmount);
                        }
                    }
                }
                for (let iter = 0; iter < iterationsPerStep; iter++) {
                    const nextA = new Float64Array(N), nextB = new Float64Array(N);
                    for (let gy = 0; gy < size; gy++) {
                        for (let gx = 0; gx < size; gx++) {
                            const i = idx(gx, gy);
                            const a = A[i], b = B[i];
                            const lapA = neighbourSum(A, gx, gy) - 4 * a;
                            const lapB = neighbourSum(B, gx, gy) - 4 * b;
                            const reaction = a * b * b;
                            nextA[i] = Math.max(0, Math.min(1, a + (diffusionA * lapA - reaction + feedRate * (1 - a))));
                            nextB[i] = Math.max(0, Math.min(1, b + (diffusionB * lapB + reaction - (killRate + feedRate) * b)));
                        }
                    }
                    A = nextA; B = nextB;
                }
            }
        },
        (state, x, y) => {
            if (!B) return null;
            const gx = Math.round(x), gy = Math.round(y);
            if (gx < 0 || gx >= size || gy < 0 || gy >= size) return null;
            const v = B[idx(gx, gy)];
            return v > 0.02 ? Math.min(1, v) : null;
        });

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { resolution, ...resolveCycleOpts(params.colour) });
}