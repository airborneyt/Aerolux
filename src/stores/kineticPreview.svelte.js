// src/stores/kineticPreview.svelte.js
// ============================================================================
// KINETIC ENGINE: SHARED PREVIEW FRAMES
//
// a single place that compiles the graph and samples every device, so the
// inline primary-device preview (KineticPage.svelte) and the Stage modal's
// tiled multi-device preview both read the same frames instead of each
// running their own compile+sample loop.
// KineticPage.svelte's onMount calls tickPreview(t, dtSeconds) once per
// animation frame; everyone else just reads kineticPreview.framesByDevice.
// ============================================================================

import { kinetic, currentInstances, currentWires, availableGradients } from './kinetic.svelte.js';
import { editor } from './velocity.svelte.js';
import { compileGraph } from '../lib/aerolux/kinetic/compileGraph.js';
import { resolveField } from '../lib/aerolux/kinetic/nodeRegistry.js';
import { sampleDeviceFrame, getDeviceGrid } from '../lib/aerolux/kinetic/sampleDevice.js';
import { createSimClock } from '../lib/aerolux/kinetic/simClock.js';

export const kineticPreview = $state({
    framesByDevice: new Map(), // deviceId -> Map<sysexPad, [r,g,b]>
});

// persistent compile cache –––––––––––––––––––––––––––––––––––––––––
let cachedCompile  = null;
let cachedVersion  = -1;
let cachedPathKey  = null;
const simClock = createSimClock(); // default 60Hz

/**
    recompiles the graph and resamples every enabled device. call once per
    animation frame from whichever page owns the tick loop.

@param {number} t  current playhead tick
@param {number} [dtSeconds]  real elapsed wall-clock seconds since the last call
*/
export function tickPreview(t, dtSeconds = 0) {
    const context = { palette: editor.palette, devices: kinetic.devices, gradients: availableGradients.map };

    const pathKey = kinetic.graphPath.join('>');
    const stale = !cachedCompile || cachedVersion !== kinetic.graphVersion || cachedPathKey !== pathKey;

    if (stale) {
        cachedCompile = compileGraph(currentInstances(), currentWires(), context, resolveField);
        cachedVersion = kinetic.graphVersion;
        cachedPathKey = pathKey;
        simClock.reset(); // fresh fields
    }

    if (cachedCompile.statefulFields.length && dtSeconds > 0) {
        simClock.tick(dtSeconds, cachedCompile.statefulFields, { ...context, currentTick: t });
    }

    const grid = getDeviceGrid(); // single canonical grid, shared by every device
    const next = new Map();
    for (const device of kinetic.devices) {
        if (!device.enabled) continue;
        // a device samples its own dedicated output if the graph has one
        // targeting it directly; otherwise it falls back to the shared
        // canvas-wide output. either, neither, or both can exist per graph.
        const field = cachedCompile.outputs[device.id] ?? cachedCompile.outputs.canvas;
        if (!field) continue;
        next.set(device.id, sampleDeviceFrame(device, grid, field, t));
    }
    kineticPreview.framesByDevice = next;
}

/**
    forces the next tickPreview() call to recompile from scratch, discarding
    all current stateful field state, even if graphVersion/graphPath haven't
    changed.
*/
export function invalidatePreviewCompile() {
    cachedCompile = null;
}