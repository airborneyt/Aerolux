// src/lib/aerolux/kinetic/nodes/generators/shapes/shapeSDF.js
//
// this is a "shared dependency functions" page from which shapes can 
// import stuff and use to generate the shape required. since most
// of the shape generators use the same functions internally, it is better
// to keep them delocalised so they can be reused instead of having to rewrite
// them everywhere
//
// the shared params for the shape nodes are also in this document

// this rotates and/or offsets a canvas point into a shape's local unrotated space
export function localisePoint(x, y, originX, originY, rotationDeg) {
    const dx = x - originX, dy = y - originY;
    const rad = -rotationDeg * Math.PI / 180;
    return {
        lx: dx * Math.cos(rad) - dy * Math.sin(rad),
        ly: dx * Math.sin(rad) + dy * Math.cos(rad),
    };
}

export function insideCircle(lx, ly, radius) {
    return (lx * lx + ly * ly) <= radius * radius;
}

export function insideEllipse(lx, ly, radiusX, radiusY) {
    const rx = Math.max(radiusX, 0.001), ry = Math.max(radiusY, 0.001);
    return ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry)) <= 1;
}

export function insideSquare(lx, ly, halfSize) {
    return Math.abs(lx) <= halfSize && Math.abs(ly) <= halfSize;
}

export function insideRectangle(lx, ly, halfWidth, halfHeight) {
    return Math.abs(lx) <= halfWidth && Math.abs(ly) <= halfHeight;
}

// distance from centre vs the polygon's radius at this angle
export function insidePolygon(lx, ly, radius, sides) {
    const dist = Math.hypot(lx, ly);
    if (dist > radius) return false;
    const theta = Math.atan2(ly, lx);
    const segmentAngle = (2 * Math.PI) / sides;
    const angleFromVertex = ((theta % segmentAngle) + segmentAngle) % segmentAngle - segmentAngle / 2;
    const edgeDist = radius * Math.cos(segmentAngle / 2) / Math.cos(angleFromVertex);
    return dist <= edgeDist;
}

// 3 triangle variants; equilateral, isosceles, right
export function insideTriangle(lx, ly, size, variant, apexWidthRatio = 1) {
    const half = size / 2;
    if (variant === 'right') {
        // right angle at (-half, half)
        if (ly < -half || ly > half || lx < -half) return false;
        const heightFrac = (ly + half) / size; // 0 at top, 1 at bottom
        const maxLx = -half + size * heightFrac;
        return lx <= maxLx;
    }
    if (variant === 'isosceles') {
        const baseHalf = half * Math.max(0.05, apexWidthRatio);
        if (ly < -half || ly > half) return false;
        const heightFrac = (ly + half) / size; // 0 at apex, 1 at base
        const widthAtY = baseHalf * heightFrac;
        return Math.abs(lx) <= widthAtY;
    }
    // equilateral
    return insidePolygon(lx, ly - size * 0.11, size * 0.577, 3);
}

/**
    stars alternate between outer radius (points) and inner radius (valleys)
    every half-segment

@param {number} innerRadiusRatio  0-1, how deep the valleys cut in (lower = pointier)
*/
export function insideStar(lx, ly, outerRadius, points, innerRadiusRatio = 0.5) {
    const dist = Math.hypot(lx, ly);
    if (dist > outerRadius) return false;
    const theta = Math.atan2(ly, lx) + Math.PI / 2; // point 0 straight up
    const segment = Math.PI / points;
    const angleInSeg = ((theta % (2 * segment)) + (2 * segment)) % (2 * segment);
    const t = Math.abs(angleInSeg - segment) / segment; // 0 at outer point, 1 at inner valley
    const localOuter = outerRadius;
    const localInner = outerRadius * innerRadiusRatio;
    const edgeRadius = localOuter + (localInner - localOuter) * t;
    return dist <= edgeRadius;
}

export function insidePlus(lx, ly, armLength, armWidth) {
    const inHorizontal = Math.abs(ly) <= armWidth / 2 && Math.abs(lx) <= armLength;
    const inVertical   = Math.abs(lx) <= armWidth / 2 && Math.abs(ly) <= armLength;
    return inHorizontal || inVertical;
}

export function insideXShape(lx, ly, armLength, armWidth) {
    const rad = -Math.PI / 4;
    const rx = lx * Math.cos(rad) - ly * Math.sin(rad);
    const ry = lx * Math.sin(rad) + ly * Math.cos(rad);
    return insideCross(rx, ry, armLength, armWidth);
}

/**
    allows the user to control the thickness of the line and give
    the space a 'donut' effect

@param {boolean} insideOuter
@param {boolean} insideInner
@param {boolean} filled
@param {boolean} donut
*/
export function applyFillMode(insideOuter, insideInner, filled, donut) {
    if (donut) return insideOuter && !insideInner;
    return filled ? insideOuter : (insideOuter && !insideInner);
}

export const shapeSharedParams = {
    originX: { type: 'float', label: 'Origin X', default: 4.5, min: -20, max: 20, decimals: 2 },
    originY: { type: 'float', label: 'Origin Y', default: 4.5, min: -20, max: 20, decimals: 2 },
    rotation: { type: 'knob', label: 'Rotation', default: 0, min: -180, max: 180, unit: '°', wrap: true, decimals: 0 },
    filled: { type: 'toggle', label: 'Filled', default: true, hint: 'Off = thin outline only. Ignored when Donut is on.' },
    donut: { type: 'toggle', label: 'Donut', default: false, hint: 'Shows only a ring/border of the shape, at the width set below.' },
    borderThickness: { type: 'float', label: 'Border thickness', default: 0.6, min: 0.05, max: 10, decimals: 2, hint: 'Only used when Donut is on.' },
    colour: { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
};

export const OUTLINE_STROKE_WIDTH = 0.3; // fixed thin border used for filled:false, donut:false

// shape wrapper

import { resolveColourOrGradient, resolveCycleMode, resolveCycleOpts } from "../../../sharedHelpers";
import { colourCycleField } from "../../../field";

export function createShapeField(params, context, insideAt) {
    const { originX = 4.5, originY = 4.5, rotation = 0, filled = true, donut = false, borderThickness = 0.6 } = params;
    const shrink = donut ? borderThickness * 2 : (!filled ? OUTLINE_STROKE_WIDTH * 2 : 0);

    const shapeField = {
        kind: 'stateless',
        sample(x, y) {
            const { lx, ly } = localisePoint(x, y, originX, originY, rotation);
            const insideOuter = insideAt(lx, ly, 0);
            if (!insideOuter) return null;
            const insideInner = shrink > 0 ? insideAt(lx, ly, shrink) : false;
            return applyFillMode(insideOuter, insideInner, filled, donut) ? 1 : null;
        },
    };

    const resolveColour = resolveColourOrGradient(params.colour, context);
    const cycleMode = resolveCycleMode(params.colour);
    return colourCycleField(shapeField, resolveColour, cycleMode, {...resolveCycleOpts(params.colour)});
}