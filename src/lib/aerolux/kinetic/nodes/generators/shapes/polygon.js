// src/lib/aerolux/kinetic/nodes/generators/shapes/polygon.js

import { createShapeField, insidePolygon } from "./shapeSDF";

export function createPolygonField(params, context) {
    const { size = 4, sides = 6 } = params;
    return createShapeField(params, context, (lx, ly, shrink) =>
        insidePolygon(lx, ly, Math.max(0.01, size / 2 - shrink / 2), sides));
}