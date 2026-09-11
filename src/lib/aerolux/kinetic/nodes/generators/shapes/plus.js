// src/lib/aerolux/kinetic/nodes/generators/shapes/plus.js

import { createShapeField, insidePlus } from "./shapeSDF";

export function createPlusField(params, context) {
    const { armLength = 3, armWidth = 1 } = params;
    return createShapeField(params, context, (lx, ly, shrink) =>
        insidePlus(lx, ly, Math.max(0.01, armLength - shrink / 2), Math.max(0.01, armWidth - shrink)));
}