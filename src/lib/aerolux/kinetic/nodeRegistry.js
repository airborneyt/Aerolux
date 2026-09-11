// src/lib/aerolux/kinetic/nodeRegistry.js
// ============================================================================
// KINETIC ENGINE: NODE REGISTRY
// node contract: { id, label, icon, color, category, subcategory,
//   kind, role, hasInput, isMultiInput, params }
//   createField(params, context, inputField, inputFieldB, resolveParam) -> Field
//
// context: { palette, gradients, devices, canvasBounds, bpm, timeDiv, 
//   totalDuration } - compiled once per graph, never passed to nodes directly.
// device resolution occurs at sampling time in sampleDevice.js.
// ============================================================================

import { nullField }                    from './field.js';
import { createParamResolver, 
         createParamIntegrator }        from './automation.js';
import { compileGraph }                 from './compileGraph.js';
import { bakedFieldFromCache }          from './bake.js';

// shared params ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

import { modifierSharedParams, 
         edgeParams }                   from './field.js';
import { shapeSharedParams }            from './nodes/generators/shapes/shapeSDF.js';

// node imports –––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

// generators
import { createSweepField }             from './nodes/generators/sweep.js';
import { createRippleField }            from './nodes/generators/ripple.js';
import { createSpiralField }            from './nodes/generators/spiral.js';
import { createNoiseField }             from './nodes/generators/noise.js';
import { createWaveformField }          from './nodes/generators/waveform.js';
import { createFlashField }             from './nodes/generators/flash.js';
import { createClipImportField }        from './nodes/generators/clipImport.js';
import { createFlowerField }            from './nodes/generators/flower.js';
import { createRainfallField }          from './nodes/generators/rainfall.js';
import { createCheckerboardField }      from './nodes/generators/checkerboard.js';

    // shapes

    import { createCircleField }        from './nodes/generators/shapes/circle.js';
    import { createEllipseField }       from './nodes/generators/shapes/ellipse.js';
    import { createSquareField }        from './nodes/generators/shapes/square.js';
    import { createRectangleField }     from './nodes/generators/shapes/rectangle.js';
    import { createTriangleField }      from './nodes/generators/shapes/triangle.js';
    import { createStarField }          from './nodes/generators/shapes/star.js';
    import { createPolygonField }       from './nodes/generators/shapes/polygon.js';
    import { createXField }             from './nodes/generators/shapes/x.js';
    import { createPlusField }          from './nodes/generators/shapes/plus.js';

// transforms
import { createRotateField }            from './nodes/transforms/rotate.js';
import { createScaleField }             from './nodes/transforms/scale.js';
import { createShiftField }             from './nodes/transforms/shift.js';

// colour
import { createHueShiftField }          from './nodes/colour/hueShift.js';
import { createBrightnessField }        from './nodes/colour/brightness.js';
import { createSatMultField }           from './nodes/colour/satMult.js';
import { createContrastField }          from './nodes/colour/contrast.js';
import { createInvertField }            from './nodes/colour/invert.js';
import { createGammaField }             from './nodes/colour/gamma.js';
import { createPosteriseField }         from './nodes/colour/posterise.js';
import { createQuantiseField }          from './nodes/colour/quantise.js';

// temporal
import { createTimeRemapField }         from './nodes/temporal/timeRemap.js';
import { createPingPongField }          from './nodes/temporal/pingPong.js';
import { createLoopField }              from './nodes/temporal/loop.js';
import { createDelayField }             from './nodes/temporal/delay.js';
import { createClockScaleField }        from './nodes/temporal/clockScale.js';

// simulations
import { createTrailField }             from './nodes/simulations/trail.js';
import { createGameOfLifeField }        from './nodes/simulations/gameOfLife.js';
import { createDiffusionField }         from './nodes/simulations/diffusion.js';
import { createAttractorField }         from './nodes/simulations/attractor.js';
import { createFlowFieldField }         from './nodes/simulations/flowField.js';
import { createFlockingField }          from './nodes/simulations/flocking.js';
import { createReactionDiffusionField } from './nodes/simulations/reactionDiffusion.js';

// modifiers
import { createGravityField }           from './nodes/modifiers/gravity.js';
import { createWindField }              from './nodes/modifiers/wind.js';
import { createDragField }              from './nodes/modifiers/drag.js';
import { createVortexField }            from './nodes/modifiers/vortex.js';
import { createMagneticField }          from './nodes/modifiers/magnetic.js';
import { createExplodeField }           from './nodes/modifiers/explode.js';
import { createCollisionField }         from './nodes/modifiers/collision.js';
import { createAtomiseField }           from './nodes/modifiers/atomise.js';
import { createTurbulenceField }        from './nodes/modifiers/turbulence.js';
import { createShiverField }            from './nodes/modifiers/shiver.js';

// utility
import { createBlendField }             from './nodes/utility/blend.js';
import { createMathOperatorField }      from './nodes/utility/math.js';
import { createLogicField }             from './nodes/utility/logic.js';
import { createSelectionField }         from './nodes/utility/selection.js';

// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

// group input / group input B ––––––––––––––––––––––––––––––––––––––––––––––––
// - utility, internal
/**
    boundary nodes from grouping (kinetic.svelte.js's groupSelectionIntoComposite),
    marked internal: true to prevent manual addition.

    groupInput/groupInputB nodes receive their field from outside the composite
    (hasInput: false), supplied by resolveCompositeField via context in recursive
    compilation.
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

const CATEGORY_COLOURS = {
    generator:  'var(--kinetic-node-generator)',
    shape:      'var(--kinetic-node-shape)',
    transform:  'var(--kinetic-node-transform)',
    colour:     'var(--kinetic-node-colour)',
    temporal:   'var(--kinetic-node-temporal)',
    utility:    'var(--kinetic-node-utility)',
    simulation: 'var(--kinetic-node-simulation)',
    modifier:   'var(--kinetic-node-modifier)',
}

export const NODE_DEFS = {

// generators –––––––––––––––––––––––––––––––––––––––––––––––––––––––
    
    clipImport: {
        id: 'clipImport', label: 'Clip Import', icon: '▬', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'Plays a loaded .mid file.',
        params: {
            clipData:    { type: 'clipImport', label: 'File', default: null },
            timeStretch: {
                type: 'float', label: 'Speed', default: 1.0, min: 0.1, max: 4.0, decimals: 2, unit: '×',
                animatable: true,
            },
            transpose: {
                type: 'int', label: 'Transpose', default: 0, min: -64, max: 64,
                animatable: true,
            },
        },
        createField: createClipImportField,
    },

    sweep: {
        id: 'sweep', label: 'Sweep', icon: '➡', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A repeating band travelling across the canvas.',
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
                hint: 'Thickness of the band.',
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
        id: 'ripple', label: 'Ripple', icon: '◉', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'Multiple overlapping rings launched at a steady interval.',
        params: {
            originX:        { type: 'float', label: 'Origin X', default: 4.5, min: -50, max: 50, decimals: 2 },
            originY:        { type: 'float', label: 'Origin Y', default: 4.5, min: -50, max: 50, decimals: 2 },
            speed:          {
                type: 'float', label: 'Speed', default: 0.08, min: 0.005, max: 1, decimals: 3,
                animatable: true,
                hint: 'Canvas units per tick each ring expands.',
            },
            ringWidth:      { type: 'float', label: 'Ring width', default: 1.2, min: 0.1, max: 10, decimals: 2, hint: 'Thickness of the ring.' },
            rippleInterval: { type: 'int', label: 'Launch every', default: 96, min: 4, max: 768, unit: 'ticks', hint: 'Ticks between successive ripple launches.' },
            rippleCount:    { type: 'int', label: 'Max overlapping', default: 4, min: 1, max: 10, hint: 'How many recent ripples to consider at once.' },
            decay:          { type: 'float', label: 'Decay per ripple', default: 0.7, min: 0.1, max: 0.99, decimals: 2, hint: 'Brightness fall-off per ring.' },
            colour:         { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createRippleField,
    },

    spiral: {
        id: 'spiral', label: 'Spiral', icon: '﹫', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A rotating arm winds outward from a centre point.',
        params: {
            centerX:      { type: 'float', label: 'Center X', default: 4.5, min: -50, max: 50, decimals: 2 },
            centerY:      { type: 'float', label: 'Center Y', default: 4.5, min: -50, max: 50, decimals: 2 },
            angularSpeed: {
                type: 'float', label: 'Angular speed', default: 1, min: -360, max: 360, decimals: 1, unit: '°/tick',
                animatable: true,
                hint: 'Degrees of rotation per tick.',
            },
            tightness:    { type: 'float', label: 'Tightness', default: 1.2, min: 0.1, max: 5, decimals: 2, hint: 'Radians of winding per canvas unit of radius. Lower = looser spiral.' },
            armWidth:     { type: 'float', label: 'Arm width', default: 0.6, min: 0.05, max: 3.14, decimals: 2, unit: 'rad', hint: 'Thickness of the arm.' },
            clockwise:    { type: 'toggle', label: 'Clockwise', default: true },
            colour:       { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createSpiralField,
    },

    noise: {
        id: 'noise', label: 'Noise', icon: '▦', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'Each pad shimmers with a randomly offset phase of the same wave.',
        params: {
            speed:         {
                type: 'float', label: 'Speed', default: 0.01, min: -0.2, max: 0.2, decimals: 4, unit: 'cycles/tick',
                animatable: true,
                hint: 'Cycles per tick.',
            },
            phaseRange:    { type: 'float', label: 'Phase spread', default: 1, min: 0, max: 1, decimals: 2, hint: '0 = every pad in sync, 1 = fully scattered phases.' },
            seed:          { type: 'int', label: 'Seed', default: 0, min: 0, max: 999999, hint: 'Change for a different (but repeatable) shimmer pattern.' },
            minBrightness: { type: 'float', label: 'Min brightness', default: 0.15, min: 0, max: 1, decimals: 2 },
            colour:        { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createNoiseField,
    },

    waveform: {
        id: 'waveform', label: 'Waveform', icon: '∿', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A wave sweeps across the canvas as a brightness modulation.',
        params: {
            angleDegrees: { type: 'knob', label: 'Direction', default: 0, min: -180, max: 180, unit: '°', wrap: true, decimals: 0 },
            speed:        {
                type: 'float', label: 'Speed', default: 0.05, min: -1, max: 1, decimals: 3,
                animatable: true,
                hint: 'Canvas units travelled per tick.',
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
        id: 'flash', label: 'Flash', icon: '✺', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'All pads flash in sync (or staggered by row/column) and decay.',
        params: {
            interval:      { type: 'int', label: 'Flash every', default: 96, min: 4, max: 768, unit: 'ticks', hint: 'Ticks between successive flashes.' },
            decayTicks:    { type: 'int', label: 'Decay over', default: 30, min: 1, max: 480, unit: 'ticks', hint: 'Brightness fall-off speed.' },
            stagger:       {
                type: 'select', label: 'Stagger', default: 'none',
                options: [
                    { value: 'none', label: 'None (all at once)' },
                    { value: 'row', label: 'By row' },
                    { value: 'column', label: 'By column' },
                ],
            },
            staggerAmount: { type: 'int', label: 'Stagger amount', default: 4, min: 0, max: 96, unit: 'ticks/index', hint: 'How many rows/column to stagger each flash by.' },
            colour:        { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createFlashField,
    },

    flower: {
        id: 'flower', label: 'Flower', icon: '❁', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A rotationally-symmetric rose-curve bloom spiralling out from an origin.',
        params: {
            originX: { type: 'float', label: 'Origin X', default: 4.5, min: -20, max: 20, decimals: 2 },
            originY: { type: 'float', label: 'Origin Y', default: 4.5, min: -20, max: 20, decimals: 2 },
            petals: { type: 'int', label: 'Petals', default: 6, min: 2, max: 16 },
            filled: { type: 'toggle', label: 'Filled', default: true, hint: 'Off = thin petal outline only.' },
            petalWidth: { type: 'float', label: 'Outline width', default: 0.35, min: 0.05, max: 3, decimals: 2, hint: 'Only used when Filled is off.' },
            maxRadius: { type: 'float', label: 'Max radius', default: 4, min: 0.5, max: 30, decimals: 2 },
            growthSpeed: { type: 'float', label: 'Growth speed', default: 1.2, min: 0.05, max: 20, decimals: 2, unit: 'units/s' },
            rotationSpeedDeg: { type: 'float', label: 'Rotation speed', default: 6, min: -360, max: 360, decimals: 1, unit: '°/s' },
            bloomMode: {
                type: 'select', label: 'Bloom mode', default: 'continuous',
                options: [
                    { value: 'continuous', label: 'Continuous (blooms once, stays open)' },
                    { value: 'cyclic', label: 'Cyclic (repeats)' },
                ],
            },
            colour: { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createFlowerField,
    },

    rainfall: {
        id: 'rainfall', label: 'Rainfall', icon: '☔', color: CATEGORY_COLOURS.generator,
        category: 'generator', subcategory: null, kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'Falling lines, one per active lane.',
        params: {
            fallSpeed: { type: 'float', label: 'Fall speed', default: 6, min: 0.1, max: 40, decimals: 2, unit: 'units/s' },
            dropLength: { type: 'float', label: 'Drop length', default: 1.5, min: 0.1, max: 15, decimals: 2 },
            density: { type: 'float', label: 'Density', default: 1, min: 0, max: 1, decimals: 2, hint: 'Fraction of lanes with an active drop.' },
            directionDeg: { type: 'knob', label: 'Direction', default: 90, min: -180, max: 180, unit: '°', wrap: true, decimals: 0, hint: '90° = straight down.' },
            loopLength: { type: 'float', label: 'Loop distance', default: 20, min: 2, max: 100, decimals: 1, hint: 'How far a drop travels before looping back to its start.' },
            seed: { type: 'int', label: 'Seed', default: 0, min: 0, max: 9999 },
            colour: { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createRainfallField,
    },
    
    checkerboard: {
        id: 'checkerboard', label: 'Checkerboard', icon: '▦', color: CATEGORY_COLOURS.generator,
        category: 'generator', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A checker grid.',
        params: {
            cellSize: { type: 'float', label: 'Cell size', default: 1, min: 0.1, max: 20, decimals: 2 },
            originX: { type: 'float', label: 'Origin X', default: 0, min: -20, max: 20, decimals: 2 },
            originY: { type: 'float', label: 'Origin Y', default: 0, min: -20, max: 20, decimals: 2 },
            rotation: { type: 'knob', label: 'Rotation', default: 0, min: -180, max: 180, unit: '°', wrap: true, decimals: 0 },
            colour: { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createCheckerboardField,
    },

    // shapes –––––––––––––––––––––––––––––––––––

    circle: {
        id: 'circle', label: 'Circle', icon: '●', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static circle.',
        params: { size: { type: 'float', label: 'Size', default: 4, min: 0.2, max: 30, decimals: 2 }, ...shapeSharedParams },
        createField: createCircleField,
    },

    ellipse: {
        id: 'ellipse', label: 'Ellipse', icon: '⬭', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static ellipse with independently controllable width and height.',
        params: {
            width: { type: 'float', label: 'Width', default: 5, min: 0.2, max: 40, decimals: 2 },
            height: { type: 'float', label: 'Height', default: 3, min: 0.2, max: 40, decimals: 2 },
            ...shapeSharedParams,
        },
        createField: createEllipseField,
    },

    square: {
        id: 'square', label: 'Square', icon: '■', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static square.',
        params: { size: { type: 'float', label: 'Size', default: 4, min: 0.2, max: 30, decimals: 2 }, ...shapeSharedParams },
        createField: createSquareField,
    },

    rectangle: {
        id: 'rectangle', label: 'Rectangle', icon: '▬', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static rectangle with independently controllable width and height.',
        params: {
            width: { type: 'float', label: 'Width', default: 5, min: 0.2, max: 40, decimals: 2 },
            height: { type: 'float', label: 'Height', default: 3, min: 0.2, max: 40, decimals: 2 },
            ...shapeSharedParams,
        },
        createField: createRectangleField,
    },

    triangle: {
        id: 'triangle', label: 'Triangle', icon: '▲', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static triangle (equilateral, iscosceles, or right-angled).',
        params: {
            size: { type: 'float', label: 'Size', default: 4, min: 0.2, max: 30, decimals: 2 },
            triangleType: {
                type: 'select', label: 'Type', default: 'equilateral',
                options: [
                    { value: 'equilateral', label: 'Equilateral' },
                    { value: 'isosceles', label: 'Isosceles' },
                    { value: 'right', label: 'Right-angle' },
                ],
            },
            apexWidthRatio: { type: 'float', label: 'Base width', default: 1, min: 0.05, max: 2, decimals: 2, hint: 'Only used when Type is Isosceles.' },
            ...shapeSharedParams,
        },
        createField: createTriangleField,
    },

    star: {
        id: 'star', label: 'Star', icon: '★', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static star with controllable point count and sharpness.',
        params: {
            size: { type: 'float', label: 'Size', default: 4, min: 0.2, max: 30, decimals: 2 },
            points: { type: 'int', label: 'Points', default: 5, min: 3, max: 12 },
            innerRadiusRatio: { type: 'float', label: 'Point sharpness', default: 0.5, min: 0.1, max: 0.95, decimals: 2, hint: 'Lower = sharper, more pointed.' },
            ...shapeSharedParams,
        },
        createField: createStarField,
    },

    polygon: {
        id: 'polygon', label: 'Polygon', icon: '⬡', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static regular polygon with controllable side count.',
        params: {
            size: { type: 'float', label: 'Size', default: 4, min: 0.2, max: 30, decimals: 2 },
            sides: { type: 'int', label: 'Sides', default: 6, min: 3, max: 16 },
            ...shapeSharedParams,
        },
        createField: createPolygonField,
    },

    x: {
        id: 'x', label: 'X', icon: '✕', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static X shape.',
        params: {
            armLength: { type: 'float', label: 'Arm length', default: 3, min: 0.2, max: 30, decimals: 2 },
            armWidth: { type: 'float', label: 'Arm width', default: 1, min: 0.05, max: 10, decimals: 2 },
            ...shapeSharedParams,
        },
        createField: createXField,
    },

    plus: {
        id: 'plus', label: 'Plus', icon: '✚', color: CATEGORY_COLOURS.shape,
        category: 'generator', subcategory: 'shape', kind: 'stateless', role: 'generator',
        hasInput: false, isMultiInput: false,
        hint: 'A static plus/cross shape.',
        params: {
            armLength: { type: 'float', label: 'Arm length', default: 3, min: 0.2, max: 30, decimals: 2 },
            armWidth: { type: 'float', label: 'Arm width', default: 1, min: 0.05, max: 10, decimals: 2 },
            ...shapeSharedParams,
        },
        createField: createPlusField,
    },

// transforms –––––––––––––––––––––––––––––––––––––––––––––––––––––––

    rotate: {
        id: 'rotate', label: 'Rotate', icon: '↻', color: CATEGORY_COLOURS.transform,
        category: 'transform', subcategory: null, kind: 'stateless', role: 'transform',
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
        id: 'shift', label: 'Shift', icon: '↔', color: CATEGORY_COLOURS.transform,
        category: 'transform', subcategory: null, kind: 'stateless', role: 'transform',
        hasInput: true, isMultiInput: false,
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
        id: 'scale', label: 'Scale', icon: '⇪', color: CATEGORY_COLOURS.transform,
        category: 'transform', subcategory: null, kind: 'stateless', role: 'transform',
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
        id: 'hueShift', label: 'Hue Shift', icon: '◐', color: CATEGORY_COLOURS.colour,
        category: 'colour', subcategory: null, kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Rotates the hue of the input colour.',
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
        id: 'brightness', label: 'Brightness', icon: '⊛', color: CATEGORY_COLOURS.colour,
        category: 'colour', subcategory: null, kind: 'stateless', role: 'colour',
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
        id: 'satMult', label: 'Sat Multiplier', icon: '✨', color: CATEGORY_COLOURS.colour,
        category: 'colour', subcategory: null, kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Multiplies the saturation of the input colour by the specified percentage.',
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
        id: 'contrast', label: 'Contrast', icon: '✨', color: CATEGORY_COLOURS.colour,
        category: 'colour', subcategory: null, kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Multiplies the contrast of the input colour by the specified percentage.',
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
        id: 'invert', label: 'Invert', icon: '🔀', color: CATEGORY_COLOURS.colour,
        category: 'colour', subcategory: null, kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Inverts the input colour based on an intensity percentage.',
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
        id: 'gamma', label: 'Gamma Corrector',  icon: '⟐',  color: CATEGORY_COLOURS.colour,
        category: 'colour', subcategory: null, kind: 'stateless',  role: 'colour', 
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
        id: 'posterise', label: 'Posterise', icon: '🔳', color: CATEGORY_COLOURS.colour,
        category: 'colour', subcategory: null, kind: 'stateless', role: 'colour',
        hasInput: true, isMultiInput: false,
        hint: 'Reduces the number of distinct colour tones in the input.',
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
        id: 'quantise', label: 'Quantise', icon: '⌖', color: CATEGORY_COLOURS.colour,
        category: 'colour', subcategory: null, kind: 'stateless', role: 'colour',
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
        id: 'timeRemap', label: 'Time Remap', icon: '⧖', color: CATEGORY_COLOURS.temporal,
        category: 'temporal', subcategory: null, kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'A speed curve ("pinch").',
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
        id: 'pingPong', label: 'Ping Pong', icon: '⇄', color: CATEGORY_COLOURS.temporal,
        category: 'temporal', subcategory: null, kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'Plays the input forward, then backward, then forward again, indefinitely.',
        params: {
            period: { type: 'int', label: 'Half-cycle length', default: 192, min: 4, max: 1920, unit: 'ticks', hint: 'Ticks for one forward pass, before it reverses.' },
        },
        createField: createPingPongField,
    },

    loop: {
        id: 'loop', label: 'Loop', icon: '↺', color: CATEGORY_COLOURS.temporal,
        category: 'temporal', subcategory: null, kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'Repeats a finite-duration input indefinitely.',
        params: {
            loopLength: { type: 'int', label: 'Loop length', default: 192, min: 4, max: 1920, unit: 'ticks' },
            startTick:  { type: 'int', label: 'Start tick', default: 0, min: 0, max: 1920 },
        },
        createField: createLoopField,
    },

    delay: {
        id: 'delay', label: 'Delay', icon: '⏱', color: CATEGORY_COLOURS.temporal,
        category: 'temporal', subcategory: null, kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'Offsets the input so its effect starts later.',
        params: {
            delayTicks: {
                type: 'int', label: 'Delay', default: 48, min: 0, max: 1920, unit: 'ticks',
                animatable: true,
            },
        },
        createField: createDelayField,
    },

    clockScale: {
        id: 'clockScale', label: 'Clock Scale', icon: '⏲', color: CATEGORY_COLOURS.temporal,
        category: 'temporal', subcategory: null, kind: 'stateless', role: 'temporal',
        hasInput: true, isMultiInput: false,
        hint: 'Speeds up, slows down, or reverses time reaching the input.',
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
        id: 'blend', label: 'Blend', icon: '⧉', color: CATEGORY_COLOURS.utility,
        category: 'utility', subcategory: null, kind: 'stateless', role: 'utility',
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
        id: 'math', label: 'Math', icon: '⊕', color: CATEGORY_COLOURS.utility,
        category: 'utility', subcategory: null, kind: 'stateless', role: 'utility',
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
        id: 'logic', label: 'Logic', icon: '⚡', color: CATEGORY_COLOURS.utility,
        category: 'utility', subcategory: null, kind: 'stateless', role: 'utility',
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
        id: 'selection', label: 'Selection', icon: '◉', color: CATEGORY_COLOURS.utility,
        category: 'utility', subcategory: null, kind: 'stateless', role: 'utility',
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
        id: 'trail', label: 'Trail', icon: '☄', color: CATEGORY_COLOURS.simulation,
        category: 'simulation', subcategory: null, kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Remembers recently-lit pixels and fades them out over time.',
        params: {
            decay:      { type: 'float', label: 'Decay per step', default: 0.85, min: 0.5, max: 0.99, decimals: 2 },
            resolution: { type: 'int',   label: 'Grid resolution', default: 9, min: 4, max: 20 },
        },
        createField: createTrailField,
    },

    gameOfLife: {
        id: 'gameOfLife', label: 'Game of Life', icon: '⧈', color: CATEGORY_COLOURS.simulation,
        category: 'simulation', subcategory: null, kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Conway\'s Game of Life.',
        params: {
            resolution:     { type: 'int',   label: 'Grid resolution', default: 9,    min: 4, max: 20 },
            density:        { type: 'float', label: 'Seed density',    default: 0.35, min: 0, max: 1, decimals: 2, hint: 'Initial probability a cell starts alive.' },
            seed:           { type: 'int',   label: 'Seed',            default: 0,    min: 0, max: 9999, hint: 'Change for a different (but repeatable) starting board.' },
            stepsPerSecond: { type: 'float', label: 'Generations/sec', default: 6,    min: 0.5, max: 30, decimals: 1 },
            wrapEdges:      { type: 'toggle', label: 'Wrap edges', default: true, hint: 'Toroidal board — off the right edge reappears on the left, etc.' },
            colour: {
                type: 'colourOrGradient', label: 'Colour',
                default: { mode: 'palette', index: 1 },
                hint: 'Per-pad gradient mode replays the gradient once from the exact tick each cell was born.',
            },
        },
        createField: createGameOfLifeField,
    },

    diffusion: {
        id: 'diffusion', label: 'Diffusion', icon: '◈', color: CATEGORY_COLOURS.simulation,
        category: 'simulation', subcategory: null, kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Energy spreads to neighbouring cells and fades over time.',
        params: {
            resolution:     { type: 'int',   label: 'Grid resolution',  default: 9,    min: 4, max: 20 },
            diffusionRate:  { type: 'float', label: 'Spread rate',      default: 0.15, min: 0, max: 0.24, decimals: 2, hint: 'Fraction of a cell\'s energy spread to each neighbour per step. Keep below 0.25 or the simulation can overshoot.' },
            decay:          { type: 'float', label: 'Decay per step',   default: 0.92, min: 0.5, max: 0.999, decimals: 3 },
            injectAmount:   { type: 'float', label: 'Inject amount',    default: 1.0,  min: 0, max: 2, decimals: 2 },
            stepsPerSecond: { type: 'float', label: 'Steps/sec',        default: 20,   min: 1, max: 60, decimals: 0 },
            colour: {
                type: 'colourOrGradient', label: 'Colour',
                default: { mode: 'palette', index: 1 },
            },
        },
        createField: createDiffusionField,
    },
    
    attractor: {
        id: 'attractor', label: 'Attractor', icon: '◎', color: CATEGORY_COLOURS.simulation,
        category: 'simulation', subcategory: null, kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Particles pulled toward a point.',
        params: {
            originX:        { type: 'float', label: 'Origin X', default: 4.5, min: -50, max: 50, decimals: 2 },
            originY:        { type: 'float', label: 'Origin Y', default: 4.5, min: -50, max: 50, decimals: 2 },
            resolution:     { type: 'int',   label: 'Grid resolution', default: 9, min: 4, max: 20 },
            count:          { type: 'int',   label: 'Particle count',  default: 16, min: 1, max: 60 },
            strength:       { type: 'float', label: 'Pull strength', default: 8, min: 0, max: 50, decimals: 1 },
            damping:        { type: 'float', label: 'Damping', default: 0.9, min: 0.5, max: 0.999, decimals: 3, hint: 'Lower = more orbit/overshoot before settling.' },
            decay:          { type: 'float', label: 'Trail decay', default: 0.92, min: 0.5, max: 0.99, decimals: 2 },
            seed:           { type: 'int',   label: 'Seed', default: 0, min: 0, max: 9999 },
            stepsPerSecond: { type: 'float', label: 'Steps/sec', default: 30, min: 1, max: 60, decimals: 0 },
            colour: { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createAttractorField,
    },

    flowField: {
        id: 'flowField', label: 'Flow Field', icon: '≋', color: CATEGORY_COLOURS.simulation,
        category: 'simulation', subcategory: null, kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Advects whatever colour is wired into it along a noise-derived flow, like dye carried by wind. Requires an input.',
        params: {
            resolution:     { type: 'int',   label: 'Grid resolution', default: 9, min: 4, max: 20 },
            noiseScale:     { type: 'float', label: 'Flow cell size', default: 3, min: 0.5, max: 10, decimals: 1, hint: 'Larger = broader, smoother flow patterns.' },
            swirlSpeed:     { type: 'float', label: 'Swirl speed', default: 0.002, min: 0, max: 0.05, decimals: 4, hint: 'Slowly rotates the whole flow field over time.' },
            pushFraction:   { type: 'float', label: 'Push amount', default: 0.6, min: 0.1, max: 1, decimals: 2, hint: 'Fraction of a cell\'s dye pushed to the next cell each step.' },
            decay:          { type: 'float', label: 'Decay per step', default: 0.92, min: 0.5, max: 0.99, decimals: 2 },
            seed:           { type: 'int',   label: 'Seed', default: 0, min: 0, max: 9999 },
            stepsPerSecond: { type: 'float', label: 'Steps/sec', default: 20, min: 1, max: 60, decimals: 0 },
        },
        createField: createFlowFieldField,
    },

    flocking: {
        id: 'flocking', label: 'Flocking', icon: '⌇', color: CATEGORY_COLOURS.simulation,
        category: 'simulation', subcategory: null, kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Boids: separation, alignment, cohesion.',
        params: {
            resolution:         { type: 'int',   label: 'Grid resolution', default: 9, min: 4, max: 20 },
            count:              { type: 'int',   label: 'Boid count', default: 12, min: 2, max: 60 },
            maxSpeed:           { type: 'float', label: 'Max speed', default: 3, min: 0.5, max: 10, decimals: 2 },
            separationRadius:   { type: 'float', label: 'Separation radius', default: 1.5, min: 0.2, max: 6, decimals: 2 },
            separationStrength: { type: 'float', label: 'Separation', default: 1.2, min: 0, max: 5, decimals: 2 },
            alignmentStrength:  { type: 'float', label: 'Alignment', default: 0.6, min: 0, max: 5, decimals: 2 },
            cohesionStrength:   { type: 'float', label: 'Cohesion', default: 0.4, min: 0, max: 5, decimals: 2 },
            decay:              { type: 'float', label: 'Trail decay', default: 0.9, min: 0.5, max: 0.99, decimals: 2 },
            wrapEdges:          { type: 'toggle', label: 'Wrap edges', default: true },
            seed:               { type: 'int',   label: 'Seed', default: 0, min: 0, max: 9999 },
            stepsPerSecond:     { type: 'float', label: 'Steps/sec', default: 20, min: 1, max: 60, decimals: 0 },
            colour: { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createFlockingField,
    },

    reactionDiffusion: {
        id: 'reactionDiffusion', label: 'Reaction-Diffusion', icon: '⁂', color: CATEGORY_COLOURS.simulation,
        category: 'simulation', subcategory: null, kind: 'stateful', role: 'simulation',
        hasInput: true, isMultiInput: false,
        hint: 'Gray-Scott two-chemical simulation. Produces organic Turing-pattern structures.',
        params: {
            resolution:        { type: 'int',   label: 'Grid resolution', default: 12, min: 4, max: 20 },
            feedRate:          { type: 'float', label: 'Feed rate',  default: 0.037, min: 0.01, max: 0.09, decimals: 4 },
            killRate:          { type: 'float', label: 'Kill rate',  default: 0.06,  min: 0.03, max: 0.08, decimals: 4 },
            diffusionA:        { type: 'float', label: 'Diffusion A', default: 1.0, min: 0.1, max: 2, decimals: 2 },
            diffusionB:        { type: 'float', label: 'Diffusion B', default: 0.5, min: 0.1, max: 2, decimals: 2 },
            seedDensity:       { type: 'float', label: 'Seed density', default: 0.02, min: 0, max: 0.3, decimals: 3, hint: 'Set to 0 to rely entirely on input injection instead of self-seeding.' },
            injectAmount:      { type: 'float', label: 'Inject amount', default: 1.0, min: 0, max: 2, decimals: 2 },
            wrapEdges:         { type: 'toggle', label: 'Wrap edges', default: true },
            seed:              { type: 'int',   label: 'Seed', default: 0, min: 0, max: 9999 },
            stepsPerSecond:    { type: 'float', label: 'Steps/sec', default: 30, min: 1, max: 60, decimals: 0 },
            iterationsPerStep: { type: 'int',   label: 'Iterations/step', default: 4, min: 1, max: 12 },
            colour: { type: 'colourOrGradient', label: 'Colour', default: { mode: 'palette', index: 1 } },
        },
        createField: createReactionDiffusionField,
    },

// modifiers ––––––––––––––––––––––––––––––––––––––––––––––––––––––––

    gravity: {
        id: 'gravity', label: 'Gravity', icon: '⇩', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateful', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'Gravity is the force that attracts a body towards the centre of the earth, or towards any other physical body having mass.',
        params: {
            accel: { type: 'float', label: 'Strength', default: 20, min: 0, max: 100, decimals: 1 },
            directionDeg: { type: 'knob', label: 'Direction', default: 90, min: -180, max: 180, unit: '°', wrap: true, decimals: 0, hint: '90° = straight down.' },
            ...modifierSharedParams, ...edgeParams('none'),
        },
        createField: createGravityField,
    },

    wind: {
        id: 'wind', label: 'Wind', icon: '≋', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateful', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'A constant directional force with gust parameters.',
        params: {
            strength: { type: 'float', label: 'Strength', default: 15, min: 0, max: 100, decimals: 1 },
            directionDeg: { type: 'knob', label: 'Direction', default: 0, min: -180, max: 180, unit: '°', wrap: true, decimals: 0 },
            gust: { type: 'float', label: 'Gustiness', default: 0.3, min: 0, max: 1, decimals: 2, hint: '0 = perfectly steady wind.' },
            ...modifierSharedParams, ...edgeParams('none'),
        },
        createField: createWindField,
    },

    drag: {
        id: 'drag', label: 'Drag', icon: '◗', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateful', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'Damps velocity over time (air resistance).',
        params: {
            coefficient: { type: 'float', label: 'Coefficient', default: 0.8, min: 0, max: 5, decimals: 2 },
            ...modifierSharedParams, ...edgeParams('none'),
        },
        createField: createDragField,
    },

    vortex: {
        id: 'vortex', label: 'Vortex', icon: '❃', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateful', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'A rotational (tangential) force around a point.',
        params: {
            centerX: { type: 'float', label: 'Center X', default: 4.5, min: -20, max: 20, decimals: 2 },
            centerY: { type: 'float', label: 'Center Y', default: 4.5, min: -20, max: 20, decimals: 2 },
            strength: { type: 'float', label: 'Strength', default: 12, min: -60, max: 60, decimals: 1, hint: 'Negative reverses spin direction.' },
            ...modifierSharedParams, ...edgeParams('none'),
        },
        createField: createVortexField,
    },

    magnetic: {
        id: 'magnetic', label: 'Magnetic', icon: '⌬', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateful', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'Pulls or pushes particles toward/from a point, or (Poles mode) a rotatable positive/negative dipole.',
        params: {
            mode: { type: 'select', label: 'Mode', default: 'point', options: [
                { value: 'point', label: 'Point' },
                { value: 'poles', label: 'Poles (dipole)' },
            ] },
            originX: { type: 'float', label: 'Origin X', default: 4.5, min: -20, max: 20, decimals: 2 },
            originY: { type: 'float', label: 'Origin Y', default: 4.5, min: -20, max: 20, decimals: 2 },
            strength: { type: 'float', label: 'Strength', default: 25, min: 0, max: 150, decimals: 1 },
            falloff: { type: 'select', label: 'Falloff', default: 'inverseSquare', options: [
                { value: 'linear', label: 'Linear' },
                { value: 'inverseSquare', label: 'Inverse square' },
            ] },
            polarity: { type: 'select', label: 'Polarity (Point mode)', default: 'attract', options: [
                { value: 'attract', label: 'Attract' },
                { value: 'repel', label: 'Repel' },
            ] },
            poleAngleDeg: { type: 'knob', label: 'Pole angle (Poles mode)', default: 0, min: -180, max: 180, unit: '°', wrap: true, decimals: 0 },
            poleGap: { type: 'float', label: 'Pole gap (Poles mode)', default: 4, min: 0.5, max: 20, decimals: 2 },
            ...modifierSharedParams, ...edgeParams('none'),
        },
        createField: createMagneticField,
    },

    explode: {
        id: 'explode', label: 'Explode', icon: '✷', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateful', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'Blasts the input\'s particles outward from a point and fades.',
        params: {
            originX: { type: 'float', label: 'Origin X', default: 4.5, min: -20, max: 20, decimals: 2 },
            originY: { type: 'float', label: 'Origin Y', default: 4.5, min: -20, max: 20, decimals: 2 },
            impulseStrength: { type: 'float', label: 'Blast strength', default: 30, min: 0, max: 150, decimals: 1 },
            triggerTick: { type: 'int', label: 'Trigger at tick', default: 0, min: 0, max: 1920 },
            lifespan: { type: 'float', label: 'Lifespan', default: 2, min: 0.1, max: 20, decimals: 1, unit: 's' },
            decay: { type: 'float', label: 'Decay', default: 0.9, min: 0, max: 0.999, decimals: 3, hint: 'Higher = particles slow down faster after the blast.' },
            ...modifierSharedParams, ...edgeParams('none'),
        },
        createField: createExplodeField,
    },

    collision: {
        id: 'collision', label: 'Collision', icon: '⊗', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateful', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'Makes every particle in this channel+scope group bounce off each other.',
        params: {
            radius: { type: 'float', label: 'Particle radius', default: 0.4, min: 0.05, max: 3, decimals: 2 },
            restitution: { type: 'float', label: 'Bounciness', default: 0.7, min: 0, max: 1, decimals: 2 },
            ...modifierSharedParams, ...edgeParams('none'),
        },
        createField: createCollisionField,
    },

    atomise: {
        id: 'atomise', label: 'Atomise', icon: '·°·', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateful', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'Continuously dissolves the input into fine dust.',
        params: {
            kickStrength: { type: 'float', label: 'Kick strength', default: 4, min: 0, max: 40, decimals: 1 },
            spread: { type: 'float', label: 'Spread', default: 1, min: 0, max: 1, decimals: 2, hint: '0 = every atom moves at the same speed, 1 = fully varied.' },
            lifespan: { type: 'float', label: 'Lifespan', default: 1.2, min: 0.1, max: 10, decimals: 1, unit: 's' },
            seed: { type: 'int', label: 'Seed', default: 0, min: 0, max: 9999 },
            ...modifierSharedParams, ...edgeParams('none'),
        },
        createField: createAtomiseField,
    },

    turbulence: {
        id: 'turbulence', label: 'Turbulence', icon: '〰', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateless', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'Warps the input\'s sampled position with drifting noise.',
        params: {
            amount: { type: 'float', label: 'Amount', default: 1.5, min: 0, max: 10, decimals: 2 },
            scale: { type: 'float', label: 'Noise scale', default: 0.5, min: 0.05, max: 5, decimals: 2 },
            speed: { type: 'float', label: 'Speed', default: 0.02, min: -1, max: 1, decimals: 3 },
            seed: { type: 'int', label: 'Seed', default: 0, min: 0, max: 9999 },
        },
        createField: createTurbulenceField,
    },

    shiver: {
        id: 'shiver', label: 'Shiver', icon: '⚡', color: CATEGORY_COLOURS.modifier,
        category: 'modifier', subcategory: null, kind: 'stateless', role: 'modifier',
        hasInput: true, isMultiInput: false,
        hint: 'Small, fast per-pad jitter.',
        params: {
            jitter: { type: 'float', label: 'Jitter amount', default: 0.4, min: 0, max: 3, decimals: 2 },
            rateHz: { type: 'float', label: 'Rate', default: 12, min: 0.5, max: 60, decimals: 1, unit: 'Hz' },
            seed: { type: 'int', label: 'Seed', default: 0, min: 0, max: 9999 },
        },
        createField: createShiverField,
    },

// miscellaneous ––––––––––––––––––––––––––––––––––––––––––––––––––––

    groupInput: {
        id: 'groupInput', label: 'Group Input', icon: '⇥', color: CATEGORY_COLOURS.utility,
        category: 'utility', subcategory: null, kind: 'stateless', role: 'utility',
        hasInput: false, isMultiInput: false, internal: true,
        hint: 'Stands in for whatever is wired into this composite from outside. Created automatically by grouping.',
        params: {},
        createField: createGroupInputField,
    },

    groupInputB: {
        id: 'groupInputB', label: 'Group Input B', icon: '⇥', color: CATEGORY_COLOURS.utility,
        category: 'utility', subcategory: null, kind: 'stateless', role: 'utility',
        hasInput: false, isMultiInput: false, internal: true,
        hint: 'Stands in for whatever is wired into this composite\'s second (B) input port from outside. Created automatically by grouping.',
        params: {},
        createField: createGroupInputBField,
    },

    composite: {
        id: 'composite', label: 'Composite', icon: '▣', color: CATEGORY_COLOURS.utility,
        category: 'utility', subcategory: null, kind: 'stateless', role: 'utility',
        hasInput: false, isMultiInput: false, internal: true,
        hint: 'A grouped sub-graph. Open it to edit its contents. Created automatically by grouping.',
        params: {},
        createField: createCompositeField,
    },

    output: {
        id: 'output', label: 'Output', icon: '⏹', color: CATEGORY_COLOURS.utility,
        category: 'utility', subcategory: null, kind: 'stateless', role: 'utility',
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
    return def.createField(params, context, fieldA, fieldB, resolveParam, integrateParam, instance.instanceId);
}
