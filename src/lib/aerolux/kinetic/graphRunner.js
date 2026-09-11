// src/lib/aerolux/kinetic/graphRunner.js
// ============================================================================
// KINETIC ENGINE: SHARED COMPILE + ADVANCE CORE
//
// this is part of an engine unification for VirtualLP instances and
// live launchpad output (livePush.js) to improve performance, since
// both loops need the same steps every tick
// (recompile the graph when its changed, advance every stateful field,
// then sample a field).
// the two loops still have their own clocks and own sink
// ============================================================================

import { compileGraph } from './compileGraph.js';
import { resolveField } from './nodeRegistry.js';
import { createSimClock } from './simClock.js';

/**
 * creates one runner instance
 * @param {number} [simRateHz] fixed-step rate for stateful fields
 * @returns {{ tick, invalidate }}
 */
export function createGraphRunner(simRateHz = 60) {
    let cachedCompile = null;
    let cachedKey = null;
    const simClock = createSimClock(simRateHz);

    return {
        /**
         * recompiles if `cacheKey` changed since the last call
         * @param {Array} instances
         * @param {Array} wires
         * @param {string|number} cacheKey
         * @param {Object} context {palette, devices, gradients, currentTick, ...}
         * @param {number} dtSeconds seconds elapsed since last tick call
         * @returns {{ outputs: Record<string,*>, statefulFields: Array }}
         */
        tick(instances, wires, cacheKey, context, dtSeconds) {
            if (cacheKey !== cachedKey) {
                cachedCompile = compileGraph(instances, wires, context, resolveField);
                cachedKey = cacheKey;
                simClock.reset(); // fields were rebuilt; stale accumulator would misalign the next step
            }

            if (cachedCompile.statefulFields.length && dtSeconds > 0) {
                simClock.tick(dtSeconds, cachedCompile.statefulFields, context);
            }

            return cachedCompile;
        },

        /** forces the next tick() to recompile from scratch even if cacheKey is unchanged. */
        invalidate() {
            cachedCompile = null;
            cachedKey = null;
        },
    };
}

/**
 * samples a field correctly regardless of kind
 * every call site that samples a compiled output must go through this
 * rather than calling field.sample() directly
 * @param {import('./field.js').Field|null|undefined} field
 * @param {number} x
 * @param {number} y
 * @param {number} t
 * @returns {[number,number,number]|null}
 */
export function sampleField(field, x, y, t) {
    if (!field) return null;
    return field.kind === 'stateful' ? field.sample(x, y) : field.sample(x, y, t);
}