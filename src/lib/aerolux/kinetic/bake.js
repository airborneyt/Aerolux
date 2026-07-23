// src/lib/aerolux/kinetic/bake.js
// ============================================================================
// KINETIC ENGINE: BAKE CACHING
//
// bake = precompute a composite's output across an authoring window and
// cache it, so scrubbing/playback read the cache instead of recompiling and
// resampling the composite's subgraph live every frame. cache invalidation
// itself lives in kinetic.svelte.js (invalidateBakesAlongPath) since it's a
// reactive-store concern (which composite is currently open, what just got
// edited). this file only knows how to build and read a cache, the same
// engine/store split every other Kinetic module already follows.
//
// grid convention: same fixed single-device local grid.
// this is a known limitation.
// a baked field has to pick SOME discrete set of points to precompute against, 
// since (like any stateful field's advance()) it can't know in advance which 
// physical device(s) will eventually sample it. bake does not yet generalise 
// to an arbitrary multi-device canvas layout. this must be fixed in the future.
//
// tick convention: samples every `tickStep` ticks across [0, totalDuration],
// matching midiExport.js's own established sampling pattern. between cached
// ticks, colour is treated as constant (same rationale midiExport.js already
// documents for delta-encoding: nothing meaningful changes in between a
// stateful field's own simulation steps).
//
// resolveField is always passed in by the caller (kinetic.svelte.js), never
// imported from nodeRegistry.js here. same decoupling pattern
// compileGraph.js already uses, so this file has zero knowledge of what
// nodes exist.
// ============================================================================

import { compileGraph } from './compileGraph.js';

const DEFAULT_RESOLUTION       = 9;   // matches simulation node defaults
const DEFAULT_TICK_STEP        = 4;   // matches midiExport.js's default
const DEFAULT_TOTAL_DURATION   = 960; // matches KineticTimeline.svelte's default authoring window
const DEFAULT_TICKS_PER_SECOND = 96;  // matches kinetic.svelte.js's transport ticks

/**
    precomputes a composite instance's own subgraph output across
    [0, totalDuration] ticks, sampled over a fixed local grid.

    KNOWN, DELIBERATE LIMITATION: this bakes the composite's OWN internal
    subgraph only. if the composite has external inputs (groupInput/
    groupInputB), whatever field was wired in from outside AT BAKE TIME gets
    baked in as part of the result. composites with no external inputs
    (the common case so far) aren't affected by this at all.

@param {Object} instance  a nodeId==='composite' NodeInstance
@param {(instance,fieldA,fieldB,context)=>(import('./field.js').Field|null)} resolveField
@param {Object} [context]  engine context (palette, devices, etc.). NOT
    given a live groupInputField/groupInputFieldB here; if the composite has
    external inputs, pass them in `context.groupInputField`/`groupInputFieldB`
    yourself if you want them reflected in the bake (see limitation above).
@param {{ totalDuration?:number, tickStep?:number, resolution?:number, ticksPerSecond?:number }} [opts]
@returns {{ tickStep:number, resolution:number, totalDuration:number, frames: Map<number, Map<string,[number,number,number]>> }}
*/
export function bakeComposite(instance, resolveField, context = {}, opts = {}) {
    const {
        totalDuration  = DEFAULT_TOTAL_DURATION,
        tickStep       = DEFAULT_TICK_STEP,
        resolution     = DEFAULT_RESOLUTION,
        ticksPerSecond = DEFAULT_TICKS_PER_SECOND,
    } = opts;

    const frames = new Map();
    const subgraph = instance?.subgraph;
    if (!subgraph) return { tickStep, resolution, totalDuration, frames };

    const compiled = compileGraph(subgraph.nodeInstances, subgraph.wires, context, resolveField);
    const field = compiled.outputs.group ?? null;
    if (!field) return { tickStep, resolution, totalDuration, frames };

    const isStateful = field.kind === 'stateful';

    for (let t = 0; t <= totalDuration; t += tickStep) {
        if (isStateful) {
            field.advance(tickStep / ticksPerSecond, { currentTick: t });
        }
        const frame = new Map();
        for (let y = 0; y <= resolution; y++) {
            for (let x = 0; x <= resolution; x++) {
                const rgb = isStateful ? field.sample(x, y) : field.sample(x, y, t);
                if (rgb) frame.set(`${x},${y}`, rgb);
            }
        }
        frames.set(t, frame);
    }

    return { tickStep, resolution, totalDuration, frames };
}

/**
    wraps a bake cache into a lookup field. always `kind: 'stateless'` from
    the OUTER graph's point of view, regardless of whether the thing that was
    baked was itself stateful. the whole point of baking is that the outer
    graph no longer needs to advance() anything for this composite; the cache
    already captured every step.

@param {{tickStep:number, resolution:number, totalDuration:number, frames:Map}} cache
@returns {import('./field.js').Field}
*/
export function bakedFieldFromCache(cache) {
    const tickKeys = cache?.frames ? [...cache.frames.keys()].sort((a, b) => a - b) : [];
    return {
        kind: 'stateless',
        sample(x, y, t) {
            if (!tickKeys.length) return null;
            const clampedT = Math.max(0, Math.min(cache.totalDuration, t ?? 0));
            // largest cached tick <= clampedT ; constant-until-next-step,
            // same rationale as midiExport.js's delta-encoding.
            let tick = tickKeys[0];
            for (const k of tickKeys) {
                if (k > clampedT) break;
                tick = k;
            }
            const frame = cache.frames.get(tick);
            if (!frame) return null;
            // nearest cached grid cell
            return frame.get(`${Math.round(x)},${Math.round(y)}`) ?? null;
        },
    };
}