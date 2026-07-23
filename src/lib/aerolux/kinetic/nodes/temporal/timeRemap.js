// src/lib/aerolux/kinetic/nodes/temporal/timeRemap.js
// time remap, otherwise known as "pinch"
// a speed-curve node that warps time itself before it reaches the upstream field.
// motion speeds up and slows down within each repeating window instead of moving at a constant rate.

// operates over a repeating window of `period` ticks: 
// within each window, normalised progress p in [0,1) is warped through a curve, then mapped back into absolute ticks.

// "Pinch" specifically: a smooth, symmetric, monotonic warp `p' = p + amount * sin(2*pi*p) * 0.15`. 
// positive amount bunches time up at the start and end of each window and rushes through the middle.
// negative amount lingers in the middle and rushes the edges.

import { timeMapField, nullField } from "../../field";

function easeCurve(type, p, pinchAmount) {
    switch (type) {
        case 'easeIn':    return p * p;
        case 'easeOut':   return 1 - (1 - p) * (1 - p);
        case 'easeInOut': return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        case 'pinch':     return p + pinchAmount * Math.sin(2 * Math.PI * p) * 0.15;
        default:          return p; // 'linear'
    }
}

export function createTimeRemapField(params, context, inputField, inputFieldB, resolveParam) {
    if (!inputField) return nullField;
    const { curveType = 'pinch', pinchAmount = 0.5, period = 192 } = params;
    const per = Math.max(period, 1);

    return timeMapField(inputField, (t) => {
        const amount = resolveParam ? resolveParam('pinchAmount', t) : pinchAmount;
        const cycleIndex = Math.floor(t / per);
        const phase = (t - cycleIndex * per) / per; // 0..1 within this window
        const warpedPhase = easeCurve(curveType, phase, amount);
        return cycleIndex * per + warpedPhase * per;
    });
}