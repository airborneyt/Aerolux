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
//
// every breakpoint carries its own `interp` describing how the segment
// staring at that point behaves on its way to the next one:
//   'hold':         stays at this point's value until the next point, then
//                   jumps (a step function)
//   'linear':       straight ramp (the only behaviour that existed before)
//   'easeIn':        quadratic, slow start
//   'easeOut':       quadratic, slow finish
//   'easeInOut':     cubic smoothstep, slow at both ends
// ============================================================================

export const INTERP_TYPES = ['hold', 'linear', 'easeIn', 'easeOut', 'easeInOut'];

export const INTERP_LABELS = {
    hold:      'Hold',
    linear:    'Linear',
    easeIn:    'Ease In',
    easeOut:   'Ease Out',
    easeInOut: 'Ease In/Out',
};

/**
    value at local fraction p (0..1) across a segment from v0 to v1, per the
    segment's own interp type (carried on its start point).

@param {number} v0
@param {number} v1
@param {number} p  0..1
@param {string} interp  one of INTERP_TYPES
@returns {number}
*/
function easedValueAt(v0, v1, p, interp) {
    const d = v1 - v0;
    switch (interp) {
        case 'hold':      return v0;
        case 'easeIn':    return v0 + p * p * d;
        case 'easeOut':   return v0 + (2 * p - p * p) * d;
        case 'easeInOut': { const e = p * p * (3 - 2 * p); return v0 + e * d; } // classic smoothstep
        default:          return v0 + p * d; // 'linear'
    }
}

/**
    definite integral, ∫[0,P] value(p) dp, of the same curve easedValueAt
    evaluates (i.e. the polynomial's own antiderivative)
    `P` is the local fraction reached so far within this segment (0..1) (may 
    be less than 1 if `t` falls inside the segment rather than past its end).

@param {number} v0
@param {number} v1
@param {number} P  0..1
@param {string} interp
@returns {number}
*/
function easedIntegral0ToP(v0, v1, P, interp) {
    const d = v1 - v0;
    switch (interp) {
        case 'hold':      return v0 * P;
        case 'easeIn':    return v0 * P + d * (P ** 3) / 3;
        case 'easeOut':   return v0 * P + d * (P ** 2 - (P ** 3) / 3);
        case 'easeInOut': return v0 * P + d * (P ** 3 - (P ** 4) / 2);
        default:          return v0 * P + d * (P ** 2) / 2; // 'linear'
    }
}

/**
    samples a sorted breakpoint lane at tick `t`, using each segment's own
    `interp` (carried on its start point; falls back to 'linear' if unset).
    holds the first/last value outside the lane's own tick range.

@param {Array<{tick:number, value:number, interp?:string}>} lane  must be sorted by tick ascending
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
            const p = span === 0 ? 0 : (t - lane[i].tick) / span;
            return easedValueAt(lane[i].value, lane[i + 1].value, p, lane[i].interp ?? 'linear');
        }
    }
    return lane[lane.length - 1].value; // unreachable given the bounds checks above, kept defensive
}

/**
    analytic definite integral of a piecewise-eased automation lane (or a
    constant fallback rate, when there's no lane) from 0 to t.

@param {Array<{tick:number, value:number, interp?:string}>} lane  sorted by tick ascending
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
                const P = span === 0 ? 0 : (segEnd - prevBp.tick) / span; // local fraction of this segment reached by `t`
                acc += span * easedIntegral0ToP(prevBp.value, bp.value, P, prevBp.interp ?? 'linear');
            }
        }

        prevTick = bp.tick;
        if (bp.tick >= t) return acc;
    }

    // t is beyond the last breakpoint (held constant at the final value).
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
@param {Object<string, Array<{tick,value,interp?}>>} [automation]
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
@param {Object<string, Array<{tick,value,interp?}>>} [automation]
@returns {(key:string, t:number) => number}
*/
export function createParamIntegrator(params, automation) {
    return function integrateParam(key, t) {
        const lane = automation?.[key];
        return integrateAutomationLane(lane, t, params[key]);
    };
}