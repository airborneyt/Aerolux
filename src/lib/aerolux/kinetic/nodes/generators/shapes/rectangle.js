// src/lib/aerolux/kinetic/nodes/generators/shapes/rectangle.js

import { createShapeField, insideRectangle } from "./shapeSDF";

export function createRectangleField(params, context) {
    const { width = 5, height = 3 } = params;
    return createShapeField(params, context, (lx, ly, shrink) =>
        insideRectangle(lx, ly, Math.max(0.01, width / 2 - shrink / 2), Math.max(0.01, height / 2 - shrink / 2)));
}