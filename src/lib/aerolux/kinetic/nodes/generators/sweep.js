// src/lib/aerolux/knetic/nodes/generators/sweep.js
// a line travels across the canvas in an adjustable direction.

import { resolvePaletteColour } from "../../sharedHelpers";

export function createSweepField(params, context, inputField, inputFieldB, resolveParam, integrateParam) {
    const {
        angleDegrees = 0,   // sweep direction; 0 = along +x, 90 = along +y
        period       = 4,   // how often a new line is fired
        colourIdx    = 8,
    } = params;

    const rgb = resolvePaletteColour(context?.palette, colourIdx);
    const per = Math.max(period, 0.0001); // guard against div-by-zero on a bad param
    const rad = angleDegrees * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = Math.sin(rad);

    return {
        kind: 'stateless',
        sample(x, y, t) {
            const bandWidth = resolveParam ? resolveParam('bandWidth', t) : (params.bandWidth ?? 1);
            // project (x,y) onto the sweep direction vector
            const pos    = x * dirX + y * dirY;
            const offset = integrateParam
                ? integrateParam('speed', t)
                : (params.speed ?? 0.05) * t;
            let local = (pos - offset) % per;
            if (local < 0) local += per;
            return local < bandWidth ? rgb : null;
        },
    };
}