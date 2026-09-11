// src/lib/aerolux/kinetic/nodes/generators/flower.js
// a mathematical rose curve that sweeps outward from an origin
// formula: r = maxRadius * |cos(petals * theta)|

import { resolveColourOrGradient, resolveCycleOpts, resolveCycleMode } from "../../sharedHelpers";
import { colourCycleField } from "../../field";
import { kinetic } from "../../../../../stores/kinetic.svelte";


// there are two bloom modes and they both share one growth-envelope calculation
// driven by growthSpeed (canvas u/s) and derived period (maxRadius/growthSpeed)
//
// continuous: grows from 0 to maxRadius once and stays fully bloomed (but rotates)
// cycle: grows from 0 to maxRadius, then resets to 0 and repeats

export function createFlowerField(params, context) {
    const {
        originX = 4.5, originY = 4.5,
        petals = 6,
        petalWidth = 0.35,        // stroke half-width around the rose curve (outline mode only)
        filled = true,
        rotationSpeedDeg = 6,     // degrees/second the whole flower spins
        growthSpeed = 1.2,        // canvas units/second the bloom radius grows
        maxRadius = 4,
        bloomMode = 'continuous', // 'continuous' | 'cyclic'
    } = params;
    const period = Math.max(maxRadius / Math.max(growthSpeed, 0.001), 0.001);

    const shapeField = {
        kind: 'stateless',
        sample(x, y, t) {
            const tSec = t / kinetic.transport.timeDiv;

            const currentRadius = bloomMode === 'cyclic'
                ? growthSpeed * (tSec % period)
                : Math.min(maxRadius, growthSpeed * tSec);
            if (currentRadius <= 0) return null;

            const dx = x - originX, dy = y - originY;
            const dist = Math.hypot(dx, dy);
            const theta = Math.atan2(dy, dx) - (rotationSpeedDeg * Math.PI / 180) * tSec;

            const roseR = currentRadius * Math.abs(Math.cos(petals * theta));
            if (roseR <= 0.001) return null;

            const lit = filled
                ? dist <= roseR
                : Math.abs(dist - roseR) <= petalWidth / 2;

            return lit ? 1 : null;
        },
    };

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, {...resolveCycleOpts(params.colour)});
}