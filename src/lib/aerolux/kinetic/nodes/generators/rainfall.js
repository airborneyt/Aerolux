// src/lib/aerolux/kinetic/nodes/generators/rainfall.js
// a falling line per active lane

import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts } from "../../sharedHelpers";
import { kinetic } from "../../../../../stores/kinetic.svelte";
import { colourCycleField } from "../../field";

// another hashToUnit 💔
function hashToUnit(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
}


export function createRainfallField(params, context) {
    const {
        fallSpeed = 6,       // canvas units/second
        dropLength = 1.5,
        density = 1,       // 0-1, fraction of lanes active
        directionDeg = 90,   // 90° = straight down (canvas Y-down)
        loopLength = 20,     // how far a drop travels before looping back
        seed = 0,
    } = params;

    const rad = directionDeg * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = Math.sin(rad);
    const perpX = -dirY, perpY = dirX;
    const loop = Math.max(loopLength, dropLength + 0.01);

    const shapeField = {
        kind: 'stateless',
        sample(x, y, t) {
            const lane = Math.round(x * perpX + y * perpY);

            const activeRoll = hashToUnit(lane, 0, seed);
            if (activeRoll > density) return null; // this lane has no rain

            const phase = hashToUnit(lane, 1, seed); // 0-1, random start offset per lane

            const tSec = t / kinetic.transport.timeDiv;
            const front = ((phase * loop + fallSpeed * tSec) % loop + loop) % loop;

            const along = x * dirX + y * dirY;
            const alongWrapped = ((along % loop) + loop) % loop;

            let behindFront = front - alongWrapped;
            if (behindFront < 0) behindFront += loop;

            return behindFront <= dropLength ? 1 : null;
        },
    };

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, {...resolveCycleOpts(params.colour)});
}