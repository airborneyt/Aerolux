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
// discrete palette index happens exactly once, at export, never here.
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
    a field that returns the same colour everywhere, always

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
    generic coordinate-space wrapper

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
@param {Field|null} inputField
@param {number | ((t:number) => number)} degreesOrFn
@param {{x:number,y:number}} [pivot]
@returns {Field}
*/
export function rotateField(inputField, degreesOrFn, pivot = { x: 0, y: 0 }) {
    return transformField(inputField, (x, y, t) => {
        const degrees = typeof degreesOrFn === 'function' ? degreesOrFn(t) : degreesOrFn;
        const rad = -degrees * Math.PI / 180;
        const cx = x - pivot.x, cy = y - pivot.y;
        return {
            x: cx * Math.cos(rad) - cy * Math.sin(rad) + pivot.x,
            y: cx * Math.sin(rad) + cy * Math.cos(rad) + pivot.y,
        };
    });
}

/**
    wraps a mutable state object into a stateful field
@param {*} initialState
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
    colour-SPACE wrapper (remaps the colour an upstream field returns)

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
    time-space wrapper (remaps the time an upstream field is queried at)

@param {Field|null} inputField
@param {(t:number) => number} remapTime
@returns {Field}
*/
export function timeMapField(inputField, remapTime) {
    if (!inputField) return nullField;
    if (inputField.kind === 'stateful') return inputField;
    return {
        kind: 'stateless',
        sample(x, y, t) {
            return inputField.sample(x, y, remapTime(t));
        },
    };
}

/**
    time-bounds wrapper (makes a node active only within [startTick, endTick])

@param {Field|null} inputField
@param {number|null} [startTick]
@param {number|null} [endTick]
@returns {Field}
*/
export function gateField(inputField, startTick = null, endTick = null) {
    if (!inputField) return nullField;
    if (startTick == null && endTick == null) return inputField;

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

// local clamp helper
function clamp63(v) {
    return Math.max(0, Math.min(63, Math.round(v)));
}

/**
    colour-SOURCE wrapper (replaces an upstream SHAPE field's colour entirely) 
    reading it only for a brightness value in (0,1] (or null = unlit)

@param {Field|null} shapeField  sample() returns brightness (0,1] or null
@param {(t:number, triggerTick:number|null) => [number,number,number]} resolveColour
@param {'synced'|'perTrigger'} [mode]
@param {{resolution?:number, litThreshold?:number, cycleTicks?:number, holdMode?:'linked'|'full'}} [opts]
@returns {Field}
*/
export function colourCycleField(shapeField, resolveColour, mode = 'synced', opts = {}) {
    if (!shapeField) return nullField;
    const { resolution = 9, litThreshold = 0.001, cycleTicks = null, holdMode = 'linked' } = opts;
    const canHold = holdMode === 'full' && cycleTicks != null;

    function applyBrightness(rgb, brightness) {
        return [
            clamp63(rgb[0] * brightness),
            clamp63(rgb[1] * brightness),
            clamp63(rgb[2] * brightness),
        ];
    }

    if (mode !== 'perTrigger') {
        // synced mode has no "trigger" concept at all
        if (shapeField.kind === 'stateful') {
            let lastTick = 0;
            return {
                kind: 'stateful',
                advance(dt, ctx) {
                    lastTick = ctx?.currentTick ?? lastTick;
                    shapeField.advance(dt, ctx);
                },
                sample(x, y) {
                    const brightness = shapeField.sample(x, y);
                    if (brightness == null || brightness <= 0) return null;
                    const rgb = resolveColour(lastTick, null);
                    return rgb ? applyBrightness(rgb, brightness) : null;
                },
            };
        }
        return {
            kind: 'stateless',
            sample(x, y, t) {
                const brightness = shapeField.sample(x, y, t);
                if (brightness == null || brightness <= 0) return null;
                const rgb = resolveColour(t, null);
                return rgb ? applyBrightness(rgb, brightness) : null;
            },
        };
    }

    // perTrigger: tracks, per fixed grid cell:
    //   wasLitRaw:     the shape's own last-known lit/unlit state, used
    //                  only to detect fresh unlit->lit transitions
    //                  (including re-triggers mid-hold). never used
    //                  directly to decide whether to render.
    //   triggerTick:   the tick of the most recent such transition.
    //   brightness:    snapshot of the shape's brightness, updated only
    //                  while raw-lit (frozen at its last real value during
    //                  a 'full' hold, so a held pixel keeps whatever
    //                  intensity it had at the moment it went dark rather
    //                  than reading as undefined/zero).
    //   active:        whether this pixel should currently render at all
    //                  true while raw-lit, or (holdMode:'full' only)
    //                  while still within cycleTicks of its triggerTick.
    return statefulField(
        { wasLitRaw: new Map(), triggerTick: new Map(), brightness: new Map(), active: new Map(), lastTick: 0 },
        (state, dt, ctx) => {
            if (shapeField.kind === 'stateful') shapeField.advance(dt, ctx);
            const t = ctx?.currentTick ?? 0;
            state.lastTick = t;

            for (let gy = 0; gy <= resolution; gy++) {
                for (let gx = 0; gx <= resolution; gx++) {
                    const key = `${gx},${gy}`;
                    const rawBrightness = shapeField.kind === 'stateful'
                        ? shapeField.sample(gx, gy)
                        : shapeField.sample(gx, gy, t);
                    const rawLit = rawBrightness != null && rawBrightness > litThreshold;
                    const wasRawLit = state.wasLitRaw.get(key) ?? false;

                    // fresh trigger (or re-trigger during a hold)
                    if (rawLit && !wasRawLit) state.triggerTick.set(key, t);
                    state.wasLitRaw.set(key, rawLit);
                    if (rawLit) state.brightness.set(key, rawBrightness);

                    let active = rawLit;
                    if (!active && canHold) {
                        const triggerTick = state.triggerTick.get(key);
                        if (triggerTick != null) active = (t - triggerTick) < cycleTicks;
                    }
                    state.active.set(key, active);
                }
            }
        },
        (state, x, y) => {
            const key = `${Math.round(x)},${Math.round(y)}`;
            if (!state.active.get(key)) return null;
            const triggerTick = state.triggerTick.get(key) ?? state.lastTick;
            const rgb = resolveColour(state.lastTick, triggerTick);
            if (!rgb) return null;
            const brightness = state.brightness.get(key) ?? 1;
            return applyBrightness(rgb, brightness);
        },
    );
}