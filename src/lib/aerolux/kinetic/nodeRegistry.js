// src/lib/aerolux/kinetic/nodeRegistry.js
// ============================================================================
// KINETIC ENGINE: NODE REGISTRY
// every entry follows the node contract:
//   { id, label, icon, color, category, kind, role, hasInput, isMultiInput,
//     params, createField(params, context, inputField, inputFieldB, resolveParam) -> Field }
//
// `context` shape (built once per graph compile): { palette, gradients,
// devices, canvasBounds, bpm, timeDiv, totalDuration }. nodes never receive a
// single `device`. device resolution happens only at sampling time, in
// sampleDevice.js, never inside a node's own field logic.
// ============================================================================

import { nullField } from './field.js';
import { createParamResolver, createParamIntegrator } from './automation.js';
import { compileGraph } from './compileGraph.js';
import { bakedFieldFromCache } from './bake.js';

// node imports –––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

// generators
import { createSweepField } from './nodes/generators/sweep.js';
import { createRippleField } from './nodes/generators/ripple.js';
import { createSpiralField } from './nodes/generators/spiral.js';
import { createNoiseField } from './nodes/generators/noise.js';
import { createWaveformField } from './nodes/generators/waveform.js';
import { createFlashField } from './nodes/generators/flash.js';
import { createClipImportField } from './nodes/generators/clipImport.js';

// transforms
import { createRotateField } from './nodes/transforms/rotate.js';
import { createScaleField } from './nodes/transforms/scale.js';
import { createShiftField } from './nodes/transforms/shift.js';

// colour
import { createHueShiftField } from './nodes/colour/hueShift.js';
import { createBrightnessField } from './nodes/colour/brightness.js';
import { createSatMultField } from './nodes/colour/satMult.js';
import { createContrastField } from './nodes/colour/contrast.js';
import { createInvertField } from './nodes/colour/invert.js';
import { createGammaField } from './nodes/colour/gamma.js';
import { createPosteriseField } from './nodes/colour/posterise.js';
import { createQuantiseField } from './nodes/colour/quantise.js';

// temporal
import { createTimeRemapField } from './nodes/temporal/timeRemap.js';
import { createPingPongField } from './nodes/temporal/pingPong.js';
import { createLoopField } from './nodes/temporal/loop.js';
import { createDelayField } from './nodes/temporal/delay.js';
import { createClockScaleField } from './nodes/temporal/clockScale.js';

// simulations
import { createTrailField } from './nodes/simulations/trail.js';
import { createGameOfLifeField } from './nodes/simulations/gameOfLife.js';
import { createDiffusionField }  from './nodes/simulations/diffusion.js';

// utility
import { createBlendField } from './nodes/utility/blend.js';
import { createMathOperatorField } from './nodes/utility/math.js';
import { createLogicField } from './nodes/utility/logic.js';
import { createSelectionField } from './nodes/utility/selection.js';

// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

// group input / group input B ––––––––––––––––––––––––––––––––––––––––––––––––
// - utility, internal
/**
    boundary nodes inside a composite subgraph, produced only by grouping
    (kinetic.svelte.js's groupSelectionIntoComposite), never added manually.
    there is an `internal: true` flag in this node to prevent user addition.

    a groupInput/groupInputB node's "field" isn't wired from anything INSIDE
    the subjgraph (hasInput: false, same as any generator); it comes from
    OUTSIDE the composite entirely, supplied by resolveCompositeField as an
    extra field on the `context` passed into the recursive subgraph compile.
*/

function createGroupInputField(params, context) {
    return context?.groupInputField ?? nullField;
}
function createGroupInputBField(params, context) {
    return context?.groupInputFieldB ?? nullField;
}

// composite ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// - utility, internal
/**
    a composite instance carries its own embedded
    `subgraph:{nodeInstances, wires}` instead of relying on this createField
    at all. compileGraph never calls it directly; resolveField (below)
    special-cases `nodeId === 'composite'` and routes to resolveCompositeField
    instead, the same structual special-case already used for `output`.
    this entry exist for registry/menu/inspector consistency (and for testing)
*/

function createCompositeField(params, context, inputField) {
    return inputField ?? nullField;
}

/**
    resolves a composite instance's field by recursively compiling its own
    embedded subgraph.

    the outer inputField/inputFieldB (whatever's wired into the composite
    from the OUTSIDE) are threaded into the recursive compile via
    `context.groupInputField`/`groupInputFieldB`, which groupInput/
    groupInputB's own createField reads directly. this is what
    makes the boundary nodes work without any change to the node contract.

    the subgraph's own `target: 'group'` output node (created by grouping)
    supplies the composite's outward-facing field via
    `compiled.outputs.group`. compileGraph.js's outputs map was already
    target-keyed and never hardcoded to know about `'canvas'` specifically,
    so nothing there needed to change.

    if the recursive compile finds NO stateful fields inside, the group
    output field is passed straight through.
    if it DOES find stateful fields, the whole composite must itself report
    `kind: 'stateful'` so the OUTER graph's tick loop knows to advance it:
    `advance()` fans out to every inner stateful field; `sample()` supplies
    the group output with the most recent `context.currentTick` this
    composite was advanced with, in case the group output itself happens to
    be internally stateless (and therefore expects a `t` argument its own
    `sample()` doesn't normally receive as a stateful wrapper).

@param {Object} instance  a `nodeId === 'composite'` NodeInstance
@param {Field|null} inputField
@param {Field|null} inputFieldB
@param {Object} context
@returns {Field}
*/
export function resolveCompositeField(instance, inputField, inputFieldB, context) {
    const subgraph = instance?.subgraph;
    if (!subgraph) return nullField;

    // bake caching: if this composite has a live bake cache, 
    // read from it instead of recompiling/resampling the subgraph.
    // kinetic.svelte.js is responsible for clearing `instance.baked` (and
    // the cache itself) whenever the subgraph is edited while open
    // (see invalidateBakesAlongPath there).
    if (instance.baked && instance.bakedCache) {
        return bakedFieldFromCache(instance.bakedCache);
    }

    const innerContext = {
        ...context,
        groupInputField:  inputField ?? null,
        groupInputFieldB: inputFieldB ?? null,
    };
    const compiled = compileGraph(subgraph.nodeInstances, subgraph.wires, innerContext, resolveField);
    const groupField = compiled.outputs.group ?? nullField;

    if (!compiled.statefulFields.length) {
        return groupField; // no stateful nodes inside: pass straight through
    }

    let lastTick = 0;
    return {
        kind: 'stateful',
        advance(dt, ctx) {
            lastTick = ctx?.currentTick ?? lastTick;
            for (const f of compiled.statefulFields) f.advance(dt, ctx);
        },
        sample(x, y) {
            return groupField.kind === 'stateful'
                ? groupField.sample(x, y)
                : groupField.sample(x, y, lastTick);
        },
    };
}

// compileGraph.js recognises nodeId === 'output' structurally and reads
// params.target / params.timeRange directly. it does not call this
// createField (see compileGraph.js's OUTPUT_NODE_ID handling). this entry
// exists so the node still shows up normally in a menu/inspector with real
// params to edit.

function createOutputField(params, context, inputField) {
    return inputField ?? nullField;
}

// registry ─────────────────────────────────────────────────────────────––––––

export const NODE_DEFS = {

// generators –––––––––––––––––––––––––––––––––––––––––––––––––––––––
    
    clipImport: {
        id: 'clipImport', label: 'Clip Import', icon: '▬', color: 'hsl(270,65%,60%)',
        category: 'generator', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'Replays a loaded .mid file.',
        params: {
            clipData:    { type: 'clipImport', label: 'File', default: null },
            timeStretch: {
                type: 'float', label: 'Speed', default: 1.0, min: 0.1, max: 4.0, decimals: 2, unit: '×',
                animatable: true, // position-like (a direct multiplier each sample) — wired through resolveParam
            },
            transpose: {
                type: 'int', label: 'Transpose', default: 0, min: -64, max: 64,
                animatable: true, // position-like (a direct note offset each sample) — wired through resolveParam
            },
        },
        createField: createClipImportField,
    },

    sweep: {
        id: 'sweep', label: 'Sweep', icon: '➡', color: 'hsl(270,65%,60%)',
        category: 'generator', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A repeating coloured band travelling across the canvas in any direction.',
        params: {
            angleDegrees: {
                type: 'knob', label: 'Direction', default: 0, min: -180, max: 180,
                unit: '°', wrap: true, decimals: 0,
                hint: '0° sweeps along +x, 90° along +y.',
            },
            speed: {
                type: 'float', label: 'Speed', default: 0.05, min: -1, max: 1, decimals: 3,
                animatable: true,
                hint: 'Canvas units travelled per tick. Negative reverses direction.',
            },
            bandWidth: {
                type: 'float', label: 'Band width', default: 1, min: 0.1, max: 20, decimals: 2,
                animatable: true,
            },
            period: {
                type: 'float', label: 'Repeat period', default: 4, min: 0.1, max: 40, decimals: 2,
                hint: 'Distance between repeats.',
            },
            colour: { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createSweepField,
    },

    ripple: {
        id: 'ripple', label: 'Ripple', icon: '◉', color: 'hsl(270,65%,60%)',
        category: 'generator', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'Multiple overlapping rings launched at a steady interval, older ones dimmer.',
        params: {
            originX:        { type: 'float', label: 'Origin X', default: 4.5, min: -50, max: 50, decimals: 2 },
            originY:        { type: 'float', label: 'Origin Y', default: 4.5, min: -50, max: 50, decimals: 2 },
            speed:          {
                type: 'float', label: 'Speed', default: 0.08, min: 0.005, max: 1, decimals: 3,
                animatable: true,
                hint: 'Canvas units per tick each ring expands. Safe to animate.',
            },
            ringWidth:      { type: 'float', label: 'Ring width', default: 1.2, min: 0.1, max: 10, decimals: 2 },
            rippleInterval: { type: 'int', label: 'Launch every', default: 96, min: 4, max: 960, unit: 'ticks', hint: 'Ticks between successive ripple launches.' },
            rippleCount:    { type: 'int', label: 'Max overlapping', default: 4, min: 1, max: 10, hint: 'How many recent ripples to consider at once.' },
            decay:          { type: 'float', label: 'Decay per ripple', default: 0.7, min: 0.1, max: 0.99, decimals: 2 },
            colour:         { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createRippleField,
    },

    spiral: {
        id: 'spiral', label: 'Spiral', icon: '﹫', color: 'hsl(270,65%,60%)',
        category: 'generator', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A rotating arm winds outward from a centre point.',
        params: {
            centerX:      { type: 'float', label: 'Center X', default: 4.5, min: -50, max: 50, decimals: 2 },
            centerY:      { type: 'float', label: 'Center Y', default: 4.5, min: -50, max: 50, decimals: 2 },
            angularSpeed: {
                type: 'float', label: 'Angular speed', default: 1, min: -360, max: 360, decimals: 1, unit: '°/tick',
                animatable: true,
                hint: 'Degrees of rotation per tick. Safe to animate.',
            },
            tightness:    { type: 'float', label: 'Tightness', default: 1.2, min: 0.1, max: 5, decimals: 2, hint: 'Radians of winding per canvas unit of radius. Lower = looser spiral.' },
            armWidth:     { type: 'float', label: 'Arm width', default: 0.6, min: 0.05, max: 3.14, decimals: 2, unit: 'rad' },
            clockwise:    { type: 'toggle', label: 'Clockwise', default: true },
            colour:       { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createSpiralField,
    },

    noise: {
        id: 'noise', label: 'Noise', icon: '▦', color: 'hsl(270,65%,60%)',
        category: 'generator', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'Each pad shimmers with a randomly (but repeatably) offset phase of the same wave.',
        params: {
            speed:         {
                type: 'float', label: 'Speed', default: 0.01, min: -0.2, max: 0.2, decimals: 4, unit: 'cycles/tick',
                animatable: true,
                hint: 'Cycles per tick. Safe to animate.',
            },
            phaseRange:    { type: 'float', label: 'Phase spread', default: 1, min: 0, max: 1, decimals: 2, hint: '0 = every pad in sync, 1 = fully scattered phases.' },
            seed:          { type: 'int', label: 'Seed', default: 0, min: 0, max: 999999, hint: 'Change for a different (but repeatable) shimmer pattern.' },
            minBrightness: { type: 'float', label: 'Min brightness', default: 0.15, min: 0, max: 1, decimals: 2 },
            colour:        { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createNoiseField,
    },

    waveform: {
        id: 'waveform', label: 'Waveform', icon: '∿', color: 'hsl(270,65%,60%)',
        category: 'generator', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A sine, triangle, or square wave sweeps across the canvas as a brightness modulation.',
        params: {
            angleDegrees: { type: 'knob', label: 'Direction', default: 0, min: -180, max: 180, unit: '°', wrap: true, decimals: 0 },
            speed:        {
                type: 'float', label: 'Speed', default: 0.05, min: -1, max: 1, decimals: 3,
                animatable: true,
                hint: 'Canvas units travelled per tick. Safe to animate.',
            },
            frequency:    { type: 'float', label: 'Frequency', default: 0.3, min: 0.01, max: 5, decimals: 2, unit: 'cycles/unit' },
            waveType:     {
                type: 'select', label: 'Wave shape', default: 'sine',
                options: [
                    { value: 'sine', label: 'Sine' },
                    { value: 'triangle', label: 'Triangle' },
                    { value: 'square', label: 'Square' },
                ],
            },
            amplitude:    { type: 'float', label: 'Amplitude', default: 1, min: 0, max: 1, decimals: 2, hint: 'Modulation depth, 0 = no effect, 1 = full brightness swing.' },
            colour:       { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createWaveformField,
    },

    flash: {
        id: 'flash', label: 'Flash', icon: '✺', color: 'hsl(270,65%,60%)',
        category: 'generator', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'All pads flash in sync (or staggered by row/column) and decay.',
        params: {
            interval:      { type: 'int', label: 'Flash every', default: 96, min: 4, max: 960, unit: 'ticks' },
            decayTicks:    { type: 'int', label: 'Decay over', default: 30, min: 1, max: 480, unit: 'ticks' },
            stagger:       {
                type: 'select', label: 'Stagger', default: 'none',
                options: [
                    { value: 'none', label: 'None (all at once)' },
                    { value: 'row', label: 'By row' },
                    { value: 'column', label: 'By column' },
                ],
            },
            staggerAmount: { type: 'int', label: 'Stagger amount', default: 4, min: 0, max: 96, unit: 'ticks/index' },
            colour:        { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createFlashField,
    },

// transforms –––––––––––––––––––––––––––––––––––––––––––––––––––––––

    rotate: {
        id: 'rotate', label: 'Rotate', icon: '↻', color: 'hsl(210,70%,55%)',
        category: 'transform', kind: 'stateless', role: 'transform',
        hasInput: true, isMultiInput: false,
        hint: 'Rotates the input around a pivot point.',
        params: {
            degrees: {
                type: 'knob', label: 'Rotation', default: 0, min: -180, max: 180,
                unit: '°', wrap: true, decimals: 1,
                animatable: true,
            },
            pivotX: { type: 'float', label: 'Pivot X', default: 0, min: -50, max: 50, decimals: 2, },
            pivotY: { type: 'float', label: 'Pivot Y', default: 0, min: -50, max: 50, decimals: 2, },
        },
        createField: createRotateField,
    },

    shift: {
        id: 'shift',
        label: 'Shift',
        icon: '↔',
        color: 'hsl(210,70%,55%)',
        category: 'transform',
        kind: 'stateless',
        role: 'transform',
        hasInput: true,
        isMultiInput: false,
        hint: 'Shifts the input field horizontally and/or vertically by the given amounts.',
        params: {
            shiftX: {
                type: 'float', label: 'X Shift', default: 0, min: -100, max: 100,
                unit: 'pad units', decimals: 1,
                animatable: true,
            },
            shiftY: {
                type: 'float', label: 'Y Shift', default: 0, min: -100, max: 100,
                unit: 'pad units', decimals: 1,
                animatable: true,
            }
        },
        createField: createShiftField,
    },    

    scale: {
        id: 'scale', label: 'Scale', icon: '⇪', color: 'hsl(210,70%,55%)',
        category: 'transform', kind: 'stateless', role: 'transform',
        hasInput: true, isMultiInput: false,
        hint: 'Scales the input toward/away from a pivot point.',
        params: {
            scale:  { type: 'float', label: 'Scale', default: 1, min: 0.05, max: 8, decimals: 2, animatable: true },
            pivotX: { type: 'float', label: 'Pivot X', default: 0, min: -50, max: 50, decimals: 2 },
            pivotY: { type: 'float', label: 'Pivot Y', default: 0, min: -50, max: 50, decimals: 2 },
        },
        createField: createScaleField,
    },

// colour –––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

    hueShift: {
        id: 'hueShift', label: 'Hue Shift', icon: '◐', color: 'hsl(38,80%,58%)',
        category: 'colour', kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Rotates the hue of whatever colour the input produces.',
        params: {
            degrees: {
                type: 'knob', label: 'Hue', default: 0, min: -180, max: 180,
                unit: '°', wrap: true, decimals: 0,
                animatable: true,
            },
        },
        createField: createHueShiftField,
    },

    brightness: {
        id: 'brightness', label: 'Brightness', icon: '⊛', color: 'hsl(38,80%,58%)',
        category: 'colour', kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Scales the luminance of the input colour.',
        params: {
            brightness: {
                type: 'knob', label: 'Brightness', default: 1.0, min: 0, max: 1,
                unit: 'x', decimals: 2, wrap: false,
                animatable: true,
            },
        },
        createField: createBrightnessField,
    },   

    satMult: {
        id: 'satMult', label: 'Sat Multiplier', icon: '✨', color: 'hsl(38,80%,58%)',
        category: 'colour', kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Multiply the saturation of the input colour by the specified percentage.',
        params: {
            multiplier: {
                type: 'knob', label: 'Saturation Multiplier', default: 100, min: 0, max: 200,
                unit: '%', wrap: false, decimals: 1,
                hint: '0% = Grayscale, 100% = Original, >100% = Over-saturated.',
                animatable: true,
            },
        },
        createField: createSatMultField,
    },

    contrast: {
        id: 'contrast', label: 'Contrast', icon: '✨', color: 'hsl(38,80%,58%)',
        category: 'colour', kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Multiply the contrast of the input colour by the specified percentage.',
        params: {
            multiplier: {
                type: 'knob', label: 'Contrast Multiplier', default: 100, min: 0, max: 200,
                unit: '%', wrap: false, decimals: 1,
                hint: 'Higher values increase contrast.',
                animatable: true,
            },
        },
        createField: createContrastField,
    },

    invert: {
        id: 'invert', label: 'Invert', icon: '🔀', color: 'hsl(38,80%,58%)',
        category: 'colour',
        kind: 'stateless',
        role: 'colour',
        hasInput: true,
        isMultiInput: false,
        hint: 'Inverts the colour of the input field based on an intensity percentage.',
        params: {
            intensity: {
                type: 'knob', label: 'Invert Intensity', default: 0, min: 0, max: 100,
                unit: '%', wrap: false, decimals: 1,
                hint: '0% = No change. 100% = Full colour inversion.',
                animatable: true,
            },
        },
        createField: createInvertField,
    },

    gamma: {
        id: 'gamma', label: 'Gamma Corrector',  icon: '⟐',  color: 'hsl(38,80%,58%)',
        category: 'colour',  kind: 'stateless',  role: 'colour', 
        hasInput: true,  isMultiInput: false,
        hint: 'Adjusts the perceived brightness curve via power-law gamma correction.',
        params: {
            gamma: {
                type: 'knob', label: 'Gamma', default: 1.0, min: 0.1, max: 3.0,
                unit: '',
                wrap: false,
                decimals: 2,
                hint: '1.0 is linear. >1 brightens shadows; <1 darkens highlights.',
                animatable: true,
            }
        },
        createField: createGammaField,
    },

    posterise: {
        id: 'posterise', label: 'Posterise', icon: '🔳', color: 'hsl(38,80%,58%)',
        category: 'colour', kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Reduces the number of distinct colour tones in the input by quantising the colour space.',
        params: {
            level: {
                type: 'knob', label: 'Level (%)', default: 100, min: 1, max: 100,
                unit: '%', wrap: false, decimals: 1,
                hint: 'The percentage of steps retained. 100% means no change.',
                animatable: true,
            },
        },
        createField: createPosteriseField,
    },

    quantise: {
        id: 'quantise', label: 'Quantise', icon: '⌖', color: 'hsl(38,80%,58%)',
        category: 'colour', kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Snaps the color to a discrete grid based on strength.',
        params: {
            quantiseStrength: {
                type: 'knob', label: 'Quantisation Strength', default: 0.5, min: 0.0, max: 1.0,
                unit: '', wrap: false, decimals: 2,
                hint: '0.0 = No change. 1.0 = Snaps to the finest grid available.',
                animatable: true,
            }
        },
        createField: createQuantiseField,
    },

// temporal –––––––––––––––––––––––––––––––––––––––––––––––––––––––––

    timeRemap: {
        id: 'timeRemap', label: 'Time Remap', icon: '⧖', color: 'hsl(190,65%,50%)',
        category: 'temporal', kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'A speed curve ("pinch"). Warps time within each repeating window so motion speeds up and slows down instead of moving at a constant rate.',
        params: {
            period:      { type: 'int', label: 'Window length', default: 192, min: 4, max: 1920, unit: 'ticks' },
            curveType:   {
                type: 'select', label: 'Curve', default: 'pinch',
                options: [
                    { value: 'linear', label: 'Linear (no effect)' },
                    { value: 'easeIn', label: 'Ease in' },
                    { value: 'easeOut', label: 'Ease out' },
                    { value: 'easeInOut', label: 'Ease in/out' },
                    { value: 'pinch', label: 'Pinch (symmetric)' },
                ],
            },
            pinchAmount: {
                type: 'float', label: 'Pinch amount', default: 0.5, min: -10, max: 10, decimals: 2,
                animatable: true,
                hint: 'Only used when curve is "Pinch". Positive = slow-fast-slow, negative = fast-slow-fast.',
            },
        },
        createField: createTimeRemapField,
    },

    pingPong: {
        id: 'pingPong', label: 'Ping Pong', icon: '⇄', color: 'hsl(190,65%,50%)',
        category: 'temporal', kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'Plays the input forward, then backward, then forward again, indefinitely.',
        params: {
            period: { type: 'int', label: 'Half-cycle length', default: 192, min: 4, max: 1920, unit: 'ticks', hint: 'Ticks for one forward pass, before it reverses.' },
        },
        createField: createPingPongField,
    },

    loop: {
        id: 'loop', label: 'Loop', icon: '↺', color: 'hsl(190,65%,50%)',
        category: 'temporal', kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'Repeats a finite-duration input indefinitely, instead of running once and going dark.',
        params: {
            loopLength: { type: 'int', label: 'Loop length', default: 192, min: 4, max: 1920, unit: 'ticks' },
            startTick:  { type: 'int', label: 'Start tick', default: 0, min: 0, max: 1920 },
        },
        createField: createLoopField,
    },

    delay: {
        id: 'delay', label: 'Delay', icon: '⏱', color: 'hsl(190,65%,50%)',
        category: 'temporal', kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'Offsets the input so its effect starts later than the rest of the graph. Held frozen before the delay elapses.',
        params: {
            delayTicks: {
                type: 'int', label: 'Delay', default: 48, min: 0, max: 1920, unit: 'ticks',
                animatable: true,
            },
        },
        createField: createDelayField,
    },

    clockScale: {
        id: 'clockScale', label: 'Clock Scale', icon: '⏲', color: 'hsl(190,65%,50%)',
        category: 'temporal', kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'Speeds up, slows down, or reverses time reaching the input (unified clock divider/multiplier).',
        params: {
            factor: {
                type: 'float', label: 'Factor', default: 1, min: -4, max: 4, decimals: 2,
                animatable: true,
                hint: '>1 = faster, <1 = slower, negative = reversed, 1 = no effect.',
            },
        },
        createField: createClockScaleField,
    },

// utility ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

    blend: {
        id: 'blend', label: 'Blend', icon: '⧉', color: 'hsl(220,20%,55%)',
        category: 'utility', kind: 'stateless', role: 'utility',
        hasInput: true, isMultiInput: true,
        hint: 'Combines two inputs. Connect a second node to the B input port.',
        params: {
            mode: {
                type: 'select', label: 'Blend mode', default: 'normal',
                options: [
                    { value: 'normal',   label: 'Normal' },
                    { value: 'add',      label: 'Add' },
                    { value: 'multiply', label: 'Multiply' },
                    { value: 'max',      label: 'Max (brightest)' },
                ],
            },
            opacity: { type: 'float', label: 'Opacity', default: 1, min: 0, max: 1, decimals: 2 },
        },
        createField: createBlendField,
    },

    math: {
        id: 'math', label: 'Math', icon: '⊕', color: 'hsl(220, 20%, 55%)',
        category: 'utility', kind: 'stateless', role: 'utility',
        hasInput: true, isMultiInput: true,
        hint: 'Perform arithmetic operations on two fields.',
        params: {
            operation: {
                type: 'select', label: 'Operation', default: 'add', min: -180, max: 180,
                unit: '°', wrap: true,
                options: [
                    { value: 'add', label: 'Add' },
                    { value: 'sub', label: 'Subtract' },
                    { value: 'mul', label: 'Multiply' },
                    { value: 'div', label: 'Divide' },
                    { value: 'mod', label: 'Modulo' },
                    { value: 'clamp', label: 'Clamp' },
                    { value: 'remap', label: 'Remap' },
                    { value: 'lerp', label: 'Lerp' },
                ],
            },
            minVal: {
                type: 'knob', label: 'Min', default: 0, min: 0, max: 63, unit: 'RGB',
            },
            maxVal: {
                type: 'knob', label: 'Max', default: 63, min: 0, max: 63, unit: 'RGB',
            },
            lowVal: {
                type: 'knob', label: 'Low', default: 0, min: 0, max: 63, unit: 'RGB',
            },
            highVal: {
                type: 'knob', label: 'High', default: 63, min: 0, max: 63, unit: 'RGB',
            },
        },
        createField: createMathOperatorField,
    },

    logic: {
        id: 'logic', label: 'Logic', icon: '⚡', color: 'hsl(220, 20%, 55%)',
        category: 'utility', kind: 'stateless', role: 'utility',
        hasInput: true, isMultiInput: true,
        hint: 'Perform boolean logic operations on two fields.',
        params: {
            operation: {
                type: 'select',
                label: 'Operation',
                default: 'and',
                options: [
                    { value: 'and', label: 'AND' },
                    { value: 'or', label: 'OR' },
                    { value: 'not', label: 'NOT' },
                    { value: 'xor', label: 'XOR' },
                    { value: 'compare', label: 'Compare' },
                ],
            },
            compareMode: {
                type: 'select',
                label: 'Compare Mode',
                default: 'eq',
                options: [
                    { value: 'eq', label: 'Equal' },
                    { value: 'gt', label: 'Greater' },
                    { value: 'lt', label: 'Less' },
                    { value: 'gte', label: 'Greater or Equal' },
                    { value: 'lte', label: 'Less or Equal' },
                ],
            },
        },
        createField: createLogicField,
    },    

    selection: {
        id: 'selection', label: 'Selection', icon: '◉', color: 'hsl(220, 20%, 55%)',
        category: 'utility', kind: 'stateless', role: 'utility',
        hasInput: true, isMultiInput: true,
        hint: 'Select between two fields based on a condition or blend them.',
        params: {
            mode: {
                type: 'select', label: 'Mode', default: 'switch',
                options: [
                    { value: 'switch', label: 'Switch' },
                    { value: 'blend', label: 'Blend' },
                ],
            },
            threshold: {
                type: 'knob', label: 'Threshold', default: 0, min: 0, max: 63,
                unit: 'RGB',
                animatable: true,
            },
            opacity: {
                type: 'knob', label: 'Opacity', default: 0.5, min: 0, max: 1,
                unit: '1.0',
                animatable: true,
            },
        },
        createField: createSelectionField,
    },    

// simulation –––––––––––––––––––––––––––––––––––––––––––––––––––––––

    trail: {
        id: 'trail', label: 'Trail', icon: '☄', color: 'hsl(150,55%,50%)',
        category: 'simulation', kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Remembers recently-lit pixels and fades them out over time. Single-device grid only for now (see the node-authoring guide).',
        params: {
            decay:      { type: 'float', label: 'Decay per step', default: 0.85, min: 0.5, max: 0.99, decimals: 2 },
            resolution: { type: 'int',   label: 'Grid resolution', default: 9, min: 4, max: 20 },
        },
        createField: createTrailField,
    },

    gameOfLife: {
        id: 'gameOfLife', label: 'Game of Life', icon: '⧈', color: 'hsl(150,55%,50%)',
        category: 'simulation', kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Conway\'s Game of Life. Leave the input unwired for a self-contained random-seeded board, or wire something in to spawn new live cells wherever it\'s lit. Single-device grid only for now (see the node-authoring guide).',
        params: {
            resolution:     { type: 'int',   label: 'Grid resolution', default: 9,    min: 4, max: 20 },
            density:        { type: 'float', label: 'Seed density',    default: 0.35, min: 0, max: 1, decimals: 2, hint: 'Initial probability a cell starts alive.' },
            seed:           { type: 'int',   label: 'Seed',            default: 0,    min: 0, max: 9999, hint: 'Change for a different (but repeatable) starting board.' },
            stepsPerSecond: { type: 'float', label: 'Generations/sec', default: 6,    min: 0.5, max: 30, decimals: 1 },
            wrapEdges:      { type: 'toggle', label: 'Wrap edges', default: true, hint: 'Toroidal board — off the right edge reappears on the left, etc.' },
            colour: {
                type: 'colourOrGradient', label: 'Colour',
                default: { mode: 'palette', index: 8 },
                hint: 'Per-pad gradient mode replays the gradient once from the exact tick each cell was born.',
            },
        },
        createField: createGameOfLifeField,
    },

    diffusion: {
        id: 'diffusion', label: 'Diffusion', icon: '◈', color: 'hsl(150,55%,50%)',
        category: 'simulation', kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Energy spreads to neighbouring cells and fades over time. Wire something in to inject energy wherever it\'s lit — an unwired input just decays to nothing.',
        params: {
            resolution:     { type: 'int',   label: 'Grid resolution',  default: 9,    min: 4, max: 20 },
            diffusionRate:  { type: 'float', label: 'Spread rate',      default: 0.15, min: 0, max: 0.24, decimals: 2, hint: 'Fraction of a cell\'s energy spread to each neighbour per step. Keep below 0.25 or the simulation can overshoot.' },
            decay:          { type: 'float', label: 'Decay per step',   default: 0.92, min: 0.5, max: 0.999, decimals: 3 },
            injectAmount:   { type: 'float', label: 'Inject amount',    default: 1.0,  min: 0, max: 2, decimals: 2 },
            stepsPerSecond: { type: 'float', label: 'Steps/sec',        default: 20,   min: 1, max: 60, decimals: 0 },
            colour: {
                type: 'colourOrGradient', label: 'Colour',
                default: { mode: 'palette', index: 8 },
            },
        },
        createField: createDiffusionField,
    },

// miscellaneous ––––––––––––––––––––––––––––––––––––––––––––––––––––

    groupInput: {
        id: 'groupInput', label: 'Group Input', icon: '⇥', color: 'hsl(220,20%,55%)',
        category: 'utility', kind: 'stateless', role: 'utility',
        hasInput: false, isMultiInput: false, internal: true,
        hint: 'Stands in for whatever is wired into this composite from outside. Created automatically by grouping.',
        params: {},
        createField: createGroupInputField,
    },

    groupInputB: {
        id: 'groupInputB', label: 'Group Input B', icon: '⇥', color: 'hsl(220,20%,55%)',
        category: 'utility', kind: 'stateless', role: 'utility',
        hasInput: false, isMultiInput: false, internal: true,
        hint: 'Stands in for whatever is wired into this composite\'s second (B) input port from outside. Created automatically by grouping.',
        params: {},
        createField: createGroupInputBField,
    },

    composite: {
        id: 'composite', label: 'Composite', icon: '▣', color: 'hsl(220,20%,45%)',
        category: 'utility', kind: 'stateless', role: 'utility',
        hasInput: false, isMultiInput: false, internal: true,
        hint: 'A grouped sub-graph. Open it to edit its contents. Created automatically by grouping.',
        params: {},
        createField: createCompositeField,
    },

    output: {
        id: 'output', label: 'Output', icon: '⏹', color: 'hsl(220,20%,55%)',
        category: 'utility', kind: 'stateless', role: 'utility',
        hasInput: true, isMultiInput: false,
        params: {
            target: {
                type: 'select', label: 'Target', default: 'canvas',
                options: [{ value: 'canvas', label: 'Canvas (all devices)' }],
            },
        },
        createField: createOutputField,
    },
};

// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

/**
    the resolveField implementation compileGraph.js expects. matches its
    `(instance, fieldA, fieldB, context) => Field|null` signature exactly.
    builds this instance's resolveParam(key, t) from its params + automation
    and passes it as createField's 5th argument.
*/
export function resolveField(instance, fieldA, fieldB, context) {
    if (instance?.nodeId === 'composite') {
        return resolveCompositeField(instance, fieldA, fieldB, context);
    }
    const def = NODE_DEFS[instance.nodeId];
    if (!def) return null;
    const params = instance.params ?? {};
    const resolveParam = createParamResolver(params, instance.automation);
    const integrateParam = createParamIntegrator(params, instance.automation);
    return def.createField(params, context, fieldA, fieldB, resolveParam, integrateParam);
}