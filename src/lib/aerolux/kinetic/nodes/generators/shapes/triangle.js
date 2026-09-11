// src/lib/aerolux/kinetic/nodes/generators/shapes/triangle.js

import { createShapeField, insideTriangle } from "./shapeSDF";

export function createTriangleField(params, context) {
    const { size = 4, triangleType = 'equilateral', apexWidthRatio = 1 } = params;
    return createShapeField(params, context, (lx, ly, shrink) =>
        insideTriangle(lx, ly, Math.max(0.01, size - shrink), triangleType, apexWidthRatio));
}