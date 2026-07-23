// src/lib/aerolux/kinetic/nodes/simulations/trail.js
// a cellular buffer/decay simulation node.

// known limitation on stateful nodes to be addressed:
// advance() has to sample the upstream field over some discrete grid to know what to remember,
// since it runs independently of wherever sample() will later be called from.
// as such, it does not yet support multi-device canvas layouts.
// more simulation nodes will be added in the future once this is worked out.

import { statefulField, nullField } from "../../field";
import { clamp63 } from "../../sharedHelpers";

export function createTrailField(params, context, inputField) {
    if (!inputField) return nullField;
    const { decay = 0.85, resolution = 9 } = params;

    return statefulField(
        { buffer: new Map() }, // "x,y" -> [r,g,b], both 0-63
        (state, dt, ctx) => {
            // fade everything already stored; drop cells that have faded to
            // black so the buffer doesn't grow forever.
            for (const [key, rgb] of state.buffer) {
                const faded = rgb.map(v => v * decay);
                if (faded[0] < 0.5 && faded[1] < 0.5 && faded[2] < 0.5) {
                    state.buffer.delete(key);
                } else {
                    state.buffer.set(key, faded);
                }
            }
            // sample the upstream field fresh over the fixed grid and blend
            // it in (max with whatever's already stored, so freshly-lit
            // pixels always show at full brightness immediately).
            const t = ctx?.currentTick ?? 0;
            for (let y = 0; y <= resolution; y++) {
                for (let x = 0; x <= resolution; x++) {
                    const rgb = inputField.sample(x, y, t);
                    if (!rgb) continue;
                    const key = `${x},${y}`;
                    const existing = state.buffer.get(key) ?? [0, 0, 0];
                    state.buffer.set(key, [
                        Math.max(existing[0], rgb[0]),
                        Math.max(existing[1], rgb[1]),
                        Math.max(existing[2], rgb[2]),
                    ]);
                }
            }
        },
        (state, x, y) => {
            const rgb = state.buffer.get(`${Math.round(x)},${Math.round(y)}`);
            return rgb ? rgb.map(clamp63) : null;
        },
    );
}