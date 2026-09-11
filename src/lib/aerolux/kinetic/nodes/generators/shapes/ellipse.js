// src/lib/kinetic/nodes/generators/shapes/ellipse.js

import { createShapeField, insideEllipse } from "./shapeSDF";

export function createEllipseField(params, context) {
    const { width = 5, height = 3 } = params;
    return createShapeField(params, context, (lx, ly, shrink) =>
        insideEllipse(lx, ly, Math.max(0.01, width / 2 - shrink / 2), Math.max(0.01, height / 2 - shrink / 2)));
}