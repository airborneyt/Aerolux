// src/lib/aerolux/kinetic/nodes/simulation/gameOfLife.js
// Conway's Game of Life
//
// optional input; if wired, any currently-lit pixel on the upstream field
// is force-spawned alive at the start of each generation step, before the
// standard rules run. this lets an upstream generator (e.g. an imported
// clip) "paint" new life into the board over time.  when it is unwired it 
// creates a fully self-contained simulation from its own random seed.

import { statefulField, colourCycleField } from '../../field.js';
import { resolveColourOrGradient, resolveCycleMode, createStepAccumulator } from '../../sharedHelpers.js';

// pseudo-random hash 
function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

export function createGameOfLifeField(params, context, inputField) {
    const {
        resolution     = 9,
        density        = 0.35,  // initial random-seed live-cell probability
        seed           = 0,
        stepsPerSecond = 6,      // generations per second
        wrapEdges      = true,   // toroidal board
    } = params;

    const size = resolution + 1; // cells 0..resolution inclusive
    const accumulator = createStepAccumulator(stepsPerSecond);

    function neighbourCount(alive, gx, gy) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                let nx = gx + dx, ny = gy + dy;
                if (wrapEdges) {
                    nx = (nx + size) % size;
                    ny = (ny + size) % size;
                } else if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
                    continue;
                }
                if (alive.has(`${nx},${ny}`)) count++;
            }
        }
        return count;
    }

    // seed lazily
    let alive = null;
    function seedBoard() {
        alive = new Set();
        for (let gy = 0; gy < size; gy++) {
            for (let gx = 0; gx < size; gx++) {
                if (hashToUnit(gx, gy, seed) < density) alive.add(`${gx},${gy}`);
            }
        }
    }

    const shapeField = statefulField(
        {}, // no separate state object needed
        (state, dt, ctx) => {
            // propagate advance() upstream first unconditionally if the input is stateful itself
            if (inputField?.kind === 'stateful') inputField.advance(dt, ctx);

            if (!alive) seedBoard();

            const steps = accumulator.tick(dt);
            const t = ctx?.currentTick ?? 0;

            for (let i = 0; i < steps; i++) {
                if (inputField) {
                    for (let gy = 0; gy < size; gy++) {
                        for (let gx = 0; gx < size; gx++) {
                            const lit = inputField.kind === 'stateful'
                                ? inputField.sample(gx, gy)
                                : inputField.sample(gx, gy, t);
                            if (lit) alive.add(`${gx},${gy}`);
                        }
                    }
                }

                const next = new Set();
                for (let gy = 0; gy < size; gy++) {
                    for (let gx = 0; gx < size; gx++) {
                        const key = `${gx},${gy}`;
                        const n = neighbourCount(alive, gx, gy);
                        const isAlive = alive.has(key);
                        if (isAlive && (n === 2 || n === 3)) next.add(key);
                        else if (!isAlive && n === 3) next.add(key);
                    }
                }
                alive = next;
            }
        },
        (state, x, y) => {
            if (!alive) return null;
            return alive.has(`${Math.round(x)},${Math.round(y)}`) ? 1 : null;
        },
    );

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, { resolution });
}