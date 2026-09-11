// src/lib/aerolux/kinetic/nodes/generators/shapes/star.js

import { createShapeField, insideStar } from "./shapeSDF";

export function createStarField(params, context) {
    const { size = 4, points = 5, innerRadiusRatio = 0.5 } = params;
    return createShapeField(params, context, (lx, ly, shrink) =>
        insideStar(lx, ly, Math.max(0.01, size / 2 - shrink / 2), points, innerRadiusRatio));
}