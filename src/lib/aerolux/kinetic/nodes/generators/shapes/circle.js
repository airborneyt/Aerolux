// src/lib/aerolux/kinetic/nodes/generators/shapes/circle.js

import { createShapeField, insideCircle } from "./shapeSDF";

export function createCircleField(params, context) {
    const { size = 4 } = params;
    return createShapeField(params, context, (lx, ly, shrink) => insideCircle(lx, ly, Math.max(0.01, size / 2 - shrink / 2)));
}