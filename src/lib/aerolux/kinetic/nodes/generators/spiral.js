// src/lib/aerolux/kinetic/nodes/generators/spiral.js
// colour travels in a spiral path across the canvas.

// a rotating arm whose angle, at a given radius, winds further behind/ahead of the arm's overall rotation the further out it goes.
// tightness controls how many radians of winding per canvas unit of radius.

import { resolvePaletteColour } from "../../sharedHelpers";

export function createSpiralField(params, context, inputField, inputFieldB, resolveParam, integrateParam) {
    const {
        centerX   = 4.5,
        centerY   = 4.5,
        tightness = 1.2,   // radians of angular winding per canvas unit of radius
        armWidth  = 0.6,   // angular band half-width (radians) around the arm
        colourIdx = 8,
        clockwise = true,
    } = params;

    const rgb = resolvePaletteColour(context?.palette, colourIdx);
    const dir = clockwise ? 1 : -1;

    return {
        kind: 'stateless',
        sample(x, y, t) {
            const dx = x - centerX, dy = y - centerY;
            const r = Math.hypot(dx, dy);
            const theta = Math.atan2(dy, dx);

            const cumulativeDegrees = integrateParam
                ? integrateParam('angularSpeed', t)
                : (params.angularSpeed ?? 30) * t;
            const armAngle = dir * (cumulativeDegrees * Math.PI / 180) - r * tightness;

            // angular distance between theta and armAngle, wrapped to [-pi, pi].
            let diff = (theta - armAngle) % (2 * Math.PI);
            if (diff > Math.PI) diff -= 2 * Math.PI;
            if (diff < -Math.PI) diff += 2 * Math.PI;

            return Math.abs(diff) < armWidth ? rgb : null;
        },
    };
}