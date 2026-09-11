// src/stores/kineticPreview.svelte.js
// ============================================================================
// KINETIC ENGINE: SHARED PREVIEW FRAMES
//
// a single place that compiles the graph and samples every device, so the
// inline primary-device preview (KineticPage.svelte) and the stage modal's
// tiled multi-device preview both read the same frames instead of each
// running their own compile+sample loop
// KineticPage.svelte's onMount calls tickPreview(t, dtSeconds) once per
// animation frame; everyone else just reads kineticPreview.framesByDevice
// ============================================================================

import { buildEngineContext } from './kinetic.svelte.js';
import { createGraphRunner } from '../lib/aerolux/kinetic/graphRunner.js';
import { sampleDeviceFrame, getDeviceGrid } from '../lib/aerolux/kinetic/sampleDevice.js';

export const kineticPreview = $state({
    framesByDevice: new Map(), // deviceId -> Map<sysexPad, [r,g,b]>
});

const runner = createGraphRunner(); // this loop's own instance: own cache, own sim clock

/**
 * recompiles the graph and resamples every enabled device. call once per
 * animation frame from whichever page owns the tick loop.
 * @param {number} t  current playhead tick
 * @param {number} [dtSeconds]  real elapsed wall-clock seconds since the last call
*/
export function tickPreview(t, dtSeconds = 0) {
    const ctx = buildEngineContext(t);
    // graph navigation (opening/closing a composite) swaps which
    // instances/wires resolve without bumping graphVersion, so the cache
    // key needs both.
    const cacheKey = `${ctx.graphVersion}:${ctx.pathKey}`;

    const compiled = runner.tick(ctx.instances, ctx.wires, cacheKey, ctx, dtSeconds);

    const grid = getDeviceGrid(); // single canonical grid, shared by every device
    const next = new Map();
    for (const device of ctx.devices) {
        if (!device.enabled) continue;
        // a device samples its own dedicated output if the graph has one
        // targeting it directly; otherwise it falls back to the shared
        // canvas-wide output. either, neither, or both can exist per graph.
        const field = compiled.outputs[device.id] ?? compiled.outputs.canvas;
        if (!field) continue;
        next.set(device.id, sampleDeviceFrame(device, grid, field, t));
    }
    kineticPreview.framesByDevice = next;
}

/** 
 * forces the next tickPreview() call to recompile from scratch, discarding
 * all current stateful field state, even if graphVersion/graphPath haven't
 * changed
*/
export function invalidatePreviewCompile() {
    runner.invalidate();
}