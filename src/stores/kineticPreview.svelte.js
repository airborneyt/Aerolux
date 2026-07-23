// src/stores/kineticPreview.svelte.js
// ============================================================================
// KINETIC ENGINE: SHARED PREVIEW FRAMES
//
// a single place that compiles the graph and samples every device, so the
// inline primary-device preview (KineticPage.svelte) and the stage modal's
// tiled multi-device preview both read the same frames instead of each
// running their own compile+sample loop.
// KineticPage.svelte's onMount calls tickPreview(t) once per animation
// frame; everyone else just reads kineticPreview.framesByDevice.
//
// this is also where multi-device output targeting actually resolves: a
// device samples its own dedicated output field if one targets it, and falls
// back to the shared canvas field otherwise.
//
// each device is sampled against its own real per-model grid (getDeviceGrid). 
// devices of different models now correctly get different pad layouts. 
//
// this reads the graph via currentInstances()/currentWires() (the nested-graph-aware 
// accessors). this mirrors whichever graph level is currently open; the preview
// will follow whatever breadcrumb is active.
// ============================================================================

import { kinetic, currentInstances, currentWires } from './kinetic.svelte.js';
import { editor } from './velocity.svelte.js';
import { compileGraph } from '../lib/aerolux/kinetic/compileGraph.js';
import { resolveField } from '../lib/aerolux/kinetic/nodeRegistry.js';
import { sampleDeviceFrame, getDeviceGrid } from '../lib/aerolux/kinetic/sampleDevice.js';

export const kineticPreview = $state({
    framesByDevice: new Map(), // deviceId -> Map<sysexPad, [r,g,b]>
});

/**
    recompiles the graph and resamples every enabled device. call once per
    animation frame from whichever page owns the tick loop.

@param {number} t
*/
export function tickPreview(t) {
    const context  = { palette: editor.palette, devices: kinetic.devices };
    const compiled = compileGraph(currentInstances(), currentWires(), context, resolveField);

    const next = new Map();
    for (const device of kinetic.devices) {
        if (!device.enabled) continue;
        // a device samples its own dedicated output if the graph has one
        // targeting it directly; otherwise it falls back to the shared
        // canvas-wide output. either, neither, or both can exist per graph.
        const field = compiled.outputs[device.id] ?? compiled.outputs.canvas;
        if (!field) continue;
        next.set(device.id, sampleDeviceFrame(device, getDeviceGrid(device.model), field, t));
    }
    kineticPreview.framesByDevice = next;
}