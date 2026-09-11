// src/lib/aerolux/kinetic/nodes/generators/checkerboard.js

import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts } from "../../sharedHelpers";
import { localisePoint } from "./shapes/shapeSDF";
import { colourCycleField } from "../../field";

export function createCheckerboardField(params, context) {
    const {
        cellSize = 1, originX = 0, originY = 0, rotation = 0,
    } = params;

    const shapeField = {
        kind: 'stateless',
        sample(x, y) {
            const { lx, ly } = localisePoint(x, y, originX, originY, rotation);
            const cellX = Math.floor(lx / Math.max(cellSize, 0.01));
            const cellY = Math.floor(ly / Math.max(cellSize, 0.01));
            const parity = ((cellX + cellY) % 2 + 2) % 2;
            return parity === 0 ? 1 : null;
        },
    };

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, {...resolveCycleOpts(params.colour)});
}