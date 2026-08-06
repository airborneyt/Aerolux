// src/lib/aerolux/kinetic/sharedHelpers.js
// ============================================================================
// KINETIC ENGINE: SHARED HELPERS

// small dependency-free helpers used across individual node files under
// nodes/generators/, nodes/simulation/, etc. not used by anything engine-specific
// or major.
//
// not imported from Velocity even though the other editor has similar functions.
// this is so that both editors stay independent as much as possible.
// ============================================================================

/**
    resolves a palette index to raw 6-bit RGB. Falls back to a visible grey
    rather than silently disappearing if the index or palette is missing, so a
    misconfigured node is obvious in preview instead of being invisible.

@param {Array<{i,r,g,b}>|undefined} palette
@param {number} idx
@returns {[number,number,number]}
*/
export function resolvePaletteColour(palette, idx) {
    const entry = palette?.[idx];
    if (!entry) return [40, 40, 40];
    return [entry.r, entry.g, entry.b];
}

export function clamp63(v) { return Math.max(0, Math.min(63, Math.round(v))); }

/**
    builds a (t, triggerTick) => RGB63 colour resolver from a
    ColourOrGradientControl value.

    this function only computes colour. whether a pixel should still be 
    rendering at all once its shape has gone unlit is handled by 
    colourCycleField (in field.js).

@param {{mode?:string, index?:number, gradientId?:string, cycleMode?:string, cycleTicks?:number}|undefined} value
@param {{palette?:Array, gradients?:Map}} context
@returns {(t:number, triggerTick:number|null) => [number,number,number]}
*/
export function resolveColourOrGradient(value, context) {
    const v = value ?? { mode: 'palette', index: 8 };

    if (v.mode !== 'gradient') {
        const rgb = resolvePaletteColour(context?.palette, v.index ?? 8);
        return () => rgb;
    }

    const gradientId = v.gradientId ?? 'current';
    const cycleTicks = Math.max(1, v.cycleTicks ?? 96);
    const grey = [40, 40, 40];

    return (t, triggerTick) => {
        const gradResult = context?.gradients?.get(gradientId);
        if (!gradResult?.length) return grey;

        const len = gradResult.length;
        let phase;
        if (v.cycleMode === 'perTrigger' && triggerTick != null) {
            phase = Math.min(1, Math.max(0, (t - triggerTick) / cycleTicks));
        } else {
            phase = (((t % cycleTicks) + cycleTicks) % cycleTicks) / cycleTicks;
        }
        const idx = Math.min(len - 1, Math.floor(phase * len));
        return resolvePaletteColour(context?.palette, gradResult[idx].velocity);
    };
}

/**
    'perTrigger' cycling only makes sense once a node has actually
    opted into it via its own colour param

@param {{mode?:string, cycleMode?:string}|undefined} colourValue
@returns {'synced'|'perTrigger'}
*/
export function resolveCycleMode(colourValue) {
    return colourValue?.mode === 'gradient' && colourValue.cycleMode === 'perTrigger'
        ? 'perTrigger' : 'synced';
}

/**
    support for the two options of colourCycleField's 'perTrigger' mode.
        - cycleTicks (how long the full gradient actually takes, so colourCycleField
          knows when a held cycle is allowed to finish)
        - holdMode ('linked' is the default, a pixel's colour stops the instant its
          shape goes unlit. 'full' = once triggered, the gradient is played through
          to completion regardless if whether the shape goes unlit first.)

@param {{mode?:string, cycleTicks?:number, holdMode?:string}|undefined} colourValue
@returns {{cycleTicks?:number, holdMode?:string}}
*/
export function resolveCycleOpts(colourValue) {
    if (colourValue?.mode !== 'gradient') return {};
    return {
        cycleTicks: Math.max(1, colourValue.cycleTicks ?? 96),
        holdMode: colourValue.holdMode ?? 'linked',
    };
}

// same fixed-step accumulator found in simClock.js, but made available here
// as the inner equivalent for a single node that wants to step at its own
// configurable rate (simClock was for the OUTER (whole graph) simulation clock)
export function createStepAccumulator(stepsPerSecond) {
    const stepDt = 1 / Math.max(0.0001, stepsPerSecond);
    let acc = 0;
    return {
        tick(dt) {
            acc += dt;
            let steps = 0;
            while (acc >= stepDt) { acc -= stepDt; steps++; }
            return steps;
        },
        reset() { acc = 0; },
    };
}