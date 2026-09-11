// src/lib/aerolux/kinetic/nodes/generators/shapes/square.js

import { createShapeField, insideSquare } from "./shapeSDF";

export function createSquareField(params, context) {
    const { size = 4 } = params;
    return createShapeField(params, context, (lx, ly, shrink) => insideSquare(lx, ly, Math.max(0.01, size / 2 - shrink / 2)));
}