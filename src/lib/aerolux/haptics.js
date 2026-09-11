// src/lib/aerolux/haptics.js
// based on sound.js and uses roughly the same structure
// there are a bunch of named importable functions to be used throughout

import { invoke } from '@tauri-apps/api/core';
import { settings } from '../../stores/settings.svelte.js';

let available = false;

export async function initHaptics() {
    try {
        available = await invoke('haptics_available');
    } catch {
        available = false;
    }
}

function enabled() {
    return available && (settings.haptics?.enabled ?? true);
}

function fire(pattern) {
    if (!enabled()) return;
    invoke('haptic_fire', { pattern }).catch(() => {});
}

// raw patterns –––––––––––––––––––––––––––––––––––––––––––––––––––––
// 0 = alignment (sharp double-tap), 
// 1 = levelChange (single tap),
// 2 = generic (soft thud). 
// these three map directly to hardware; build new 'feels' by composing them below.

const PATTERN = { ALIGNMENT: 0, LEVEL_CHANGE: 1, GENERIC: 2 };

// named variations (component library) –––––––––––––––––––––––––––––
// add a description above the variants

// sharp and precise
// usage: snapping a stop to a grid, a value hitting a boundary
export function hapticSnap() {
    fire(PATTERN.ALIGNMENT);
}

// single soft tap for a light acknowledgement
// usage: toggle flipped, tab switched
export function hapticTick() {
    fire(PATTERN.LEVEL_CHANGE);
}

// deep thud with a soft echo for major/destructive actions
// two generics staggered a beat apart
// usage: new project, clear presets, reset settings
export function hapticMajorAction() {
    fire(PATTERN.GENERIC);
    setTimeout(() => fire(PATTERN.ALIGNMENT), 65);
    setTimeout(() => fire(PATTERN.LEVEL_CHANGE), 140);
}

// sharper double-hit variant of the above for confirm-style actions
// usage: when you want more "click" and "thud"
export function hapticConfirm() {
    fire(PATTERN.ALIGNMENT);
    setTimeout(() => fire(PATTERN.LEVEL_CHANGE), 40);
}

// variants for a continuous or throttled feel (drags like sliders, knobs, gradient bar)
// below is an accumulator that the drag variants should use to create this dragging feel

/**
    this is a per-drag accumulator. it calls .tick(delta) with the raw momvement
    delta (px, degrees, whatever unit the control drags in) on every pointermove;
    it fires a tick internally once accumulated movement crosses 'stepSize' then resets.

@param {number} stepSize movement units between ticks. smaller = denser
*/
export function createDragHaptic(stepSize = 6) {
    let acc = 0;
    return {
        tick(delta) {
            acc += Math.abs(delta);
            if (acc >= stepSize) {
                acc = 0;
                hapticTick();
            }
        },
        reset() { acc = 0; },
    };
}