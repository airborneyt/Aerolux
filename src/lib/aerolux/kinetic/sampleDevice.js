// src/lib/aerolux/kinetic/sampleDevice.js
// ============================================================================
// KINETIC ENGINE: DEVICE SAMPLING
//
// the one place a field graph actually meets physical hardware. nodes never
// know about devices; this module is where a device's local pad grid 
// (sourced from midi-layout.js) gets offset + rotated into canvas
// space, sampled, and packed into the sysexPad -> RGB63 Map that
// VirtualLP.svelte already knows how to render (its `sysexColors` prop,
// unchanged component).
//
// depending on midi-layout.js here does NOT violate the "Kinetic's engine
// never imports from Velocity's modules" rule established since
// colourMath.js/paletteSnap.js: that rule is about avoiding coupling to
// reactive STORE state (e.g. editor.palette), not about avoiding all shared
// infrastructure. midi-layout.js is pure, dependency-free hardware-topology
// data with zero imports of its own, already depended on by the untouched
// VirtualLP.svelte. essentially we are keeping the editors seperate at places
// they can change stores at (excluding palettes), but other fixed functions
// can be used interchangeably between the editors.
// ============================================================================

import { getCachedGrid } from '../midi-layout.js';

// ============================================================================
// THE ONE CANVAS SPACE (read this before touching x/y anything in this file)
//
// LOCAL DEVICE space (midi-layout.js): x=0..9 left->right, y=0..9
// BOTTOM->TOP (y=9 is the physical top edge). this matches real hardware
// labeling conventions (row 1 = bottom row on a real Launchpad) and is NOT
// changed here.
//
// CANVAS space (this file, and everywhere a device's position/rotation is
// used; StageModal.svelte, MultiDevicePreview.svelte, devicePlacement.js,
// kineticPreview.svelte.js, midiExport.js): x increases RIGHT, y increases
// DOWN. ordinary screen/CSS convention. `device.position` lives in this
// space and is used AS-IS for CSS `top`/`left` in both preview surfaces;
// nothing about position needs converting, only the LOCAL->CANVAS step
// below does, because local space's y-axis points the opposite way.
//
// rotation stays expressed with the same matrix as before (only its input
// changed). this still means "device.rotation increases clockwise, 
// as viewed top-down" (matching the ↻ icon used everywhere a device's 
// rotation is shown): rotating a device's local top edge by 90 now correctly 
// points it toward canvas +x (right), by 180 toward canvas +y (down), by 270 
// toward canvas -x (left).
// ============================================================================

const LOCAL_CENTRE = { x: 4.5, y: 4.5 };

/**
    thin re-export of midi-layout.js's own shared cache. 
    kept as a function (not a re-exported constant) so existing call 
    sites (`getDeviceGrid(device.model)` → `getDeviceGrid()`) only need
    their argument dropped, not restructuring into a direct import.

@returns {Array<{x:number,y:number,zone:string,sysexPad:number|null,exportNote:number|null}>}
*/
export function getDeviceGrid() {
    return getCachedGrid();
}

/**
    maps one local pad cell into canvas space via a device's rotation +
    position. see this module's header for the canvas-space convention
    this function is responsible for producing (Y-DOWN, matching
    device.position/CSS everywhere else).

@param {{x:number, y:number}} local
@param {{position:{x:number,y:number}, rotation:0|90|180|270}} device
@returns {{x:number, y:number}}
*/
export function localToCanvas(local, device) {
    const dx = local.x - LOCAL_CENTRE.x;
    const dy = LOCAL_CENTRE.y - local.y;

    let rx, ry;
    switch (device.rotation) {
        case 90:  rx = -dy; ry =  dx; break;
        case 180: rx = -dx; ry = -dy; break;
        case 270: rx =  dy; ry = -dx; break;
        default:  rx =  dx; ry =  dy; break; // 0
    }

    return {
        x: rx + LOCAL_CENTRE.x + device.position.x,
        y: ry + LOCAL_CENTRE.y + device.position.y,
    };
}

/**
    samples a compiled field at every one of a device's local pad cells and
    returns a sysexPad -> RGB63 Map, ready to hand to VirtualLP's `sysexColors`
    prop unchanged. unlit pads (field returned null) are simply absent from the
    map, matching VirtualLP's existing "missing = background" convention.

    logo AND mode both come through here.
    each has its own distinct position and its own distinct (preview-only)
    sysexPad, so both get sampled and both end up in the returned Map,
    independently. this function has no concept of "pick one for export".
    that choice only matters at the real-hardware boundary (midiExport.js).

@param {DeviceInstance} device
@param {Array<{sysexPad:number|null, x:number, y:number}>} localCells  from getDeviceGrid()
@param {Field|null} field   the canvas-targeted output field this device samples
@param {number} t
@returns {Map<number, [number,number,number]>}
*/
export function sampleDeviceFrame(device, localCells, field, t) {
    const frame = new Map();
    if (!field || !device?.enabled) return frame;

    for (const cell of localCells) {
        if (cell.sysexPad == null) continue;

        const canvasPos = localToCanvas(cell, device);
        const rgb = field.sample(canvasPos.x, canvasPos.y, t);
        if (!rgb) continue;

        const brightness = device.brightness ?? 1;
        const scaled = rgb.map(v => Math.max(0, Math.min(63, Math.round(v * brightness))));
        frame.set(cell.sysexPad, scaled);
    }

    return frame;
}