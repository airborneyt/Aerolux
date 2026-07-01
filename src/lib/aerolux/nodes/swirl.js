// src/lib/aerolux/nodes/swirl.js
// advanced rotating algorithm
// supports inward and outward swirls

import { buildLaunchpadGrid } from "../midi-layout";
import { findNearestUnoccupied } from "./fillGaps";

// calculators

function toRad(deg) {
    return (deg * Math.PI) / 180;
}

function rotatePoint(x, y, px, py, angleRad) {
    const dx = x - px;
    const dy = y - py;

    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    return {
        x: px + (dx * cos - dy * sin),
        y: py + (dx * sin + dy * cos)
    };
}

// falloff models

function getFalloff(type, d, radius) {
    const t = d / radius;

    switch (type) {
        case "linear":
            return Math.max(0, 1 - t);

        case "smoothstep":
            return 1 - (t * t * (3 - 2 * t));

        case "exponential":
            return Math.exp(-3 * t);

        case "inverse":
            return 1 / (1 + 10 * t);

        case "gaussian":
            return Math.exp(-(t * t) * 4);

        case "sigmoid":
            return 1 / (1 + Math.exp(10 * (t - 0.5)));

        default:
            return 1;
    }
}

// distribution models

function getDistribution(type, d, radius) {
    const t = d / radius;

    switch (type) {
        case "centre":
            return 1 - t;

        case "edge":
            return t;

        case "bell":
            return Math.exp(-Math.pow((t - 0.5) * 4, 2));

        case "uniform":
        default:
            return 1;
    }
}

// main processor
export function processSwirl(events, params) {
    const {
        pivotX = 4,
        pivotY = 4,
        maximumAngle = 180,
        radius = 5,
        falloff = "smoothstep",
        distribution = "bell",
        mix = 1
    } = params;

    const pivot = { x: pivotX, y: pivotY };
    const results = [];

    for (const e of events) {
        const x = e.x;
        const y = e.y;

        const dx = x - pivot.x;
        const dy = y - pivot.y;

        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance === 0) {
            results.push(e);
            continue;
        }

        const fall = getFalloff(falloff, distance, radius);
        const dist = getDistribution(distribution, distance, radius);

        const influence = fall * dist;

        const angle = toRad(maximumAngle) * influence;

        const rotated = rotatePoint(
            x,
            y,
            pivot.x,
            pivot.y,
            angle
        );

        results.push({
            ...e,
            x: e.x + (rotated.x - e.x) * mix,
            y: e.y + (rotated.y - e.y) * mix
        });
    }

    return results;
}
