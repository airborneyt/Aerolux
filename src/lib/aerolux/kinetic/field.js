// src/lib/aerolux/kinetic/field.js
// ============================================================================
// KINETIC ENGINE: FIELD ENGINE
//
// a field is either:
//   stateless : { kind: 'stateless', sample(x, y, t) -> RGB63 | null }
//   stateful  : { kind: 'stateful', advance(dt, context) -> void,
//                 sample(x, y) -> RGB63 | null }
//
// colour stays in this continuous space through the whole graph; snapping to a
// discrete palette index happens exactly once, at export, never
// here. this is what avoids the "hue-shift jumps between palette entries"
// problem.
// ============================================================================

/** 
    always unlit. safe default for unwired inputs. 
    add this to every node that is NOT a generator.
    this ensures light still passes with no changes. 
*/
export const nullField = Object.freeze({
    kind: 'stateless',
    sample() { return null; },
});

/**
    a field that returns the same colour everywhere, always.

    @param {[number,number,number]} rgb63
@returns {Field}
*/
export function constantField(rgb63) {
    return {
        kind: 'stateless',
        sample() { return rgb63; },
    };
}

/**
    generic coordinate-space wrapper; the pattern every geometric transform
    (scale/translate/flip/warp) reduces to. `remap(x, y, t)` returns the
    coordinate to sample on the *upstream* field; the wrapper never touches
    colour itself.

    this is what makes transforms gapless and resolution-independent: there is
    no discrete pad remapping anywhere, so no gap-filling logic is needed.

@param {Field|null} inputField
@param {(x:number, y:number, t:number) => {x:number, y:number}} remap
@returns {Field}
*/
export function transformField(inputField, remap) {
    if (!inputField) return nullField;
    return {
        kind: 'stateless',
        sample(x, y, t) {
            const p = remap(x, y, t);
            return inputField.sample(p.x, p.y, t);
        },
    };
}

/**
    proof-of-concept rotate wrapper built on transformField. safe to use in
    other nodes, instead of building the rotateField from scratch.

@param {Field|null} inputField
@param {number | ((t:number) => number)} degreesOrFn  static angle, or a function of t for animated rotation
@param {{x:number,y:number}} [pivot]
@returns {Field}
*/
export function rotateField(inputField, degreesOrFn, pivot = { x: 0, y: 0 }) {
    return transformField(inputField, (x, y, t) => {
        const degrees = typeof degreesOrFn === 'function' ? degreesOrFn(t) : degreesOrFn;
        const rad = -degrees * Math.PI / 180; // inverse-rotate the sample point
        const cx = x - pivot.x, cy = y - pivot.y;
        return {
            x: cx * Math.cos(rad) - cy * Math.sin(rad) + pivot.x,
            y: cx * Math.sin(rad) + cy * Math.cos(rad) + pivot.y,
        };
    });
}

/**
    wraps a mutable state object into a stateful field, so individual stateful
    nodes don't each hand-roll the `kind: 'stateful'` shape by hand.

@param {*} initialState        held by reference, mutated in place by `step`
@param {(state:*, dt:number, context:*) => void} step
@param {(state:*, x:number, y:number) => ([number,number,number]|null)} read
@returns {Field}
*/
export function statefulField(initialState, step, read) {
    const state = initialState;
    return {
        kind: 'stateful',
        advance(dt, context) { step(state, dt, context); },
        sample(x, y) { return read(state, x, y); },
    };
}

/**
    colour-space wrapper; the counterpart to transformField.
    colourMapField remaps the colour the upstream field returns. this is the
    pattern every colour node (hue shift, saturation, brightness, posterise,
    tint...) reduces to.

    `mapFn(rgb, x, y, t)` receives the upstream RGB63 triple plus the sample
    coordinates for context (e.g. a vignette that darkens by distance from
    centre). most colour nodes only need `rgb`. `t` is `undefined` when
    wrapping a stateful field (its sample() has no t to forward).

@param {Field|null} inputField
@param {(rgb:[number,number,number], x:number, y:number, t:number|undefined) => [number,number,number]} mapFn
@returns {Field}
*/
export function colourMapField(inputField, mapFn) {
    if (!inputField) return nullField;

    if (inputField.kind === 'stateful') {
        return {
            kind: 'stateful',
            advance(dt, context) { inputField.advance(dt, context); },
            sample(x, y) {
                const rgb = inputField.sample(x, y);
                return rgb ? mapFn(rgb, x, y, undefined) : null;
            },
        };
    }

    return {
        kind: 'stateless',
        sample(x, y, t) {
            const rgb = inputField.sample(x, y, t);
            return rgb ? mapFn(rgb, x, y, t) : null;
        },
    };
}

/**
    time-space wrapper; the third member of the remapping-wrapper trio alongside
    transformField (coordinate space) and colourMapField (colour space).
    timeMapField remaps the time it's queried at; `x`/`y`/colour are left alone.
    this is the pattern every temporal utility (Time Remap/Pinch, Ping Pong, Loop,
    Delay, Clock Divider/Multiplier) reduces to.

    only meaningful for stateless upstream fields. a stateful field's
    `sample(x,y)` doesn't take `t` at all, so there is no time parameter to remap.
    passing a stateful field through timeMapField returns it unchanged
    (still stateful) rather than silently no-op-wrapping it, since remapping a thing 
    that has no time axis is a no-op by definition.

@param {Field|null} inputField
@param {(t:number) => number} remapTime
@returns {Field}
*/
export function timeMapField(inputField, remapTime) {
    if (!inputField) return nullField;
    if (inputField.kind === 'stateful') return inputField; // no time axis to remap = harmless pass-through
    return {
        kind: 'stateless',
        sample(x, y, t) {
            return inputField.sample(x, y, remapTime(t));
        },
    };
}
/**
    time-bounds wrapper; makes a node active only within [startTick, endTick]
    (either end may be null/omitted for an open bound).

    stateless fields simply return null outside the window. 
    stateful fields are trickier: their `sample(x,y)` doesn't take t, 
    so gating has to happen at `advance()` time instead, using `context.currentTick` 
    (set by whoever drives the sim clock each frame. see simClock.js / kineticPreview.svelte.js). 
    gating advance() rather than sample() means a stateful node's simulation genuinely freezes
    while outside its active window, rather than silently evolving unseen.

@param {Field|null} inputField
@param {number|null} [startTick]
@param {number|null} [endTick]
@returns {Field}
*/
export function gateField(inputField, startTick = null, endTick = null) {
    if (!inputField) return nullField;
    if (startTick == null && endTick == null) return inputField; // no-op

    const inRange = (t) =>
        (startTick == null || t >= startTick) && (endTick == null || t <= endTick);

    if (inputField.kind === 'stateful') {
        return {
            kind: 'stateful',
            advance(dt, context) {
                if (context?.currentTick == null || inRange(context.currentTick)) {
                    inputField.advance(dt, context);
                }
            },
            sample(x, y) { return inputField.sample(x, y); },
        };
    }

    return {
        kind: 'stateless',
        sample(x, y, t) { return inRange(t) ? inputField.sample(x, y, t) : null; },
    };
}