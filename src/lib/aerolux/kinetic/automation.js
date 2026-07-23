// src/lib/aerolux/kinetic/automation.js
// ============================================================================
// KINETIC ENGINE: AUTOMATION
//
// a node's `createField(params, context, inputField, inputFieldB, resolveParam, integrateParam)`
// receives the plain static `params` object PLUS TWO animation helpers, 
// one for each of the two fundamentally different kinds of animatable params
//
//   resolveParam(key, t)    = for POSITION-LIKE params: a direct
//                             instantaneous value used as-is in the
//                             formula (a rotation angle, a band width).
//   integrateParam(key, t)  = for RATE-LIKE params: a value that gets
//                             multiplied against (or otherwise integrated
//                             over) elapsed time to produce a position or
//                             phase (a sweep's speed, an angular velocity,
//                             an oscillator's frequency).
//
// both are opt-in per param, per node.
// ============================================================================

/**
    linear interpolation across a sorted breakpoint lane.
    holds the first/last value outside the lane's own tick range, 
    interpolates linearly between the two points bracketing `t` otherwise.

@param {Array<{tick:number, value:number}>} lane  must be sorted by tick ascending
@param {number} t
@param {number} fallback  used if the lane is empty
@returns {number}
*/
export function sampleAutomationLane(lane, t, fallback) {
    if (!lane || !lane.length) return fallback;
    if (t <= lane[0].tick) return lane[0].value;
    if (t >= lane[lane.length - 1].tick) return lane[lane.length - 1].value;

    for (let i = 0; i < lane.length - 1; i++) {
        if (t >= lane[i].tick && t <= lane[i + 1].tick) {
            const span = lane[i + 1].tick - lane[i].tick;
            const frac = span === 0 ? 0 : (t - lane[i].tick) / span;
            return lane[i].value + frac * (lane[i + 1].value - lane[i].value);
        }
    }
    return lane[lane.length - 1].value; // unreachable given the bounds checks above, kept defensive
}

/**
    analytic definite integral of a piecewise-linear automation lane (or a
    constant fallback rate, when there's no lane) from 0 to t.

    computed as a running sum of trapezoid areas: before the first
    breakpoint the lane is held constant at `lane[0].value` (matching
    `sampleAutomationLane`'s own hold-before-first-point behaviour), each
    segment between consecutive breakpoints is a linear ramp (trapezoid area
    = average height * width), and after the last breakpoint the lane is
    held constant at the final value. Every segment is clipped to `t` if `t`
    falls inside it, so this is correct for sampling at ANY t, not just
    exactly on a breakpoint.

@param {Array<{tick:number, value:number}>} lane  sorted by tick ascending
@param {number} t
@param {number} fallbackRate  constant rate used when there's no lane at all
@returns {number}
*/
export function integrateAutomationLane(lane, t, fallbackRate) {
    if (t <= 0) return 0;
    if (!lane || !lane.length) return fallbackRate * t;

    let acc = 0;
    let prevTick = 0;

    for (let i = 0; i < lane.length; i++) {
        const bp = lane[i];
        const segStart = prevTick;
        const segEnd = Math.min(bp.tick, t);

        if (segEnd > segStart) {
            if (i === 0) {
                // before the first breakpoint: held constant at lane[0].value.
                acc += bp.value * (segEnd - segStart);
            } else {
                const prevBp = lane[i - 1];
                const span = bp.tick - prevBp.tick;
                const frac = span === 0 ? 0 : (segEnd - prevBp.tick) / span;
                const valueAtSegEnd = prevBp.value + frac * (bp.value - prevBp.value);
                // trapezoid area from (prevBp.tick, prevBp.value) to (segEnd, valueAtSegEnd).
                acc += (prevBp.value + valueAtSegEnd) / 2 * (segEnd - segStart);
            }
        }

        prevTick = bp.tick;
        if (bp.tick >= t) return acc;
    }

    // t is beyond the last breakpoint => held constant at the final value.
    const last = lane[lane.length - 1];
    acc += last.value * (t - last.tick);
    return acc;
}

/**
    builds the resolveParam(key, t) function passed into every node's
    createField. falls back to the plain static param value whenever that key
    has no automation lane (or an empty one), so a param with automation and a
    param without look identical to a node that doesn't care about the
    distinction.

@param {Object} params
@param {Object<string, Array<{tick,value}>>} [automation]
@returns {(key:string, t:number) => *}
*/
export function createParamResolver(params, automation) {
    return function resolveParam(key, t) {
        const lane = automation?.[key];
        if (!lane || !lane.length) return params[key];
        return sampleAutomationLane(lane, t, params[key]);
    };
}

/**
    builds the integrateParam(key, t) function passed into every node's
    createField, as the counterpart to createParamResolver for RATE-like
    params. 
    falls back to `params[key] * t` (identical to every rate-like param's 
    pre-fix behaviour) whenever that key has no automation lane;
    same "looks identical when unanimated" guarantee createParamResolver already gives.

    for a param whose accumulation window doesn't start at global t=0, 
    call this twice and subtract: `integrateParam(key, t) - integrateParam(key, launchTick)`;
    valid by the definite integral's additivity (∫[a,b] = F(b) - F(a)), and exact even
    while the rate itself is being animated across that window.

@param {Object} params
@param {Object<string, Array<{tick,value}>>} [automation]
@returns {(key:string, t:number) => number}
*/
export function createParamIntegrator(params, automation) {
    return function integrateParam(key, t) {
        const lane = automation?.[key];
        return integrateAutomationLane(lane, t, params[key]);
    };
}