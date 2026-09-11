// src/lib/aerolux/kinetic/nodes/generators/shapes/x.js

import { createShapeField, insideXShape } from "./shapeSDF";

export function createXField(params, context) {
    const { armLength = 3, armWidth = 1 } = params;
    return createShapeField(params, context, (lx, ly, shrink) =>
        insideXShape(lx, ly, Math.max(0.01, armLength - shrink / 2), Math.max(0.01, armWidth - shrink)));
}