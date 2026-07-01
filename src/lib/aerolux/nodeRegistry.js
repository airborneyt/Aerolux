// src/lib/aerolux/nodeRegistry.js
// all node descriptors. this is where new notes are registered to be used in the editor

import { processRotate } from './nodes/rotate.js';
import { processFlip } from './nodes/flip.js';
import { processTranslate } from './nodes/translate.js';
import { processScale } from './nodes/scale.js';
import { processSpline } from './nodes/spline.js';
import { processGradientMap } from './nodes/gradientMap.js';
import { processHueShift } from './nodes/hueShift.js';
import { processColour } from './nodes/colourPalette.js';
import { processLayerMask } from './nodes/layerMask.js';
import { processMerge } from './nodes/merge.js';
import { processClipImport } from './nodes/clipImport.js';
import { processRipple } from './nodes/rippleGen.js';

// parameter type reference ──────────────────────────────────────────
//
// every param has: { type, default, label, hint? }
// additional fields per type:
//
//   'knob'    : { min, max, unit?, wrap?: bool, decimals?: int }
//               wrap:true lets the knob spin past min/max continuously
//               (e.g. degrees -180→180 that can go -360, -540, etc.)
//
//   'toggle'  : { }  (boolean, renders as a labelled switch)
//
//   'select'  : { options: [{ value, label }] }
//
//   'colour'  : { }  (opens palette picker, value is palette index)
//
//   'int'     : { min, max }  (integer, renders as drag-number input)
//
//   'float'   : { min, max, step?, decimals? }
//
// future types (reserved, not yet rendered):
//   'curve'   : automation lane breakpoint editor
//   'region'  : pad region selector (bitmask of 64 pads)

const pass = (noteOns) => noteOns;
const src  = ()        => [];

export const NODE_CATEGORIES = {
    SOURCE:    { id: 'source',    label: 'Sources',    icon: '◈', color: 'hsl(270,65%,60%)' },
    GENERATOR: { id: 'generator', label: 'Generators', icon: '⟡', color: 'hsl(270,65%,60%)' },
    COLOUR:    { id: 'colour',    label: 'Colour',     icon: '◉', color: 'hsl(38,80%,58%)'  },
    TRANSFORM: { id: 'transform', label: 'Transforms', icon: '⟳', color: 'hsl(210,70%,55%)' },
    TEMPORAL:  { id: 'temporal',  label: 'Temporal',   icon: '⏱', color: 'hsl(190,65%,50%)' },
    UTILITY:   { id: 'utility',   label: 'Utility',    icon: '⚙', color: 'hsl(220,20%,55%)' },
};

export const NODES = [

    // SOURCES ───────────────────────────────────────────────────────
    {
        id:       'clipimport',
        label:    'Clip Import',
        icon:     '▬',
        color:    'hsl(270,65%,60%)',
        category: 'source',
        hint:     'Replays a .mid lightshow clip through the node pipeline.',
        hasInput: false,
        processor: processClipImport,
        params: {
            // clipData holds the parsed file — set via setParam when the user
            // loads a file. type:'clipImport' routes to ClipImportControl in
            // NodeInspector, which calls parseClipFile and writes the result here.
            clipData: {
                type:    'clipImport',
                label:   'File',
                default: null,
            },
            timeStretch: {
                type:     'knob',
                label:    'Speed',
                min:      0.1,
                max:      4.0,
                step:     0.05,
                decimals: 2,
                unit:     '×',
                hint:     '1.0 = original speed. 2.0 = twice as fast.',
                default:  1.0,
            },
            transpose: {
                type:     'knob',
                label:    'Transpose',
                min:      -64,
                max:      64,
                step:     1,
                decimals: 0,
                unit:     'notes',
                hint:     'Shift all note numbers. Use to re-map clips between devices.',
                default:  0,
            },
            includeEdges: {
                type:    'toggle',
                label:   'Include edges',
                hint:    'Pass through notes that map to side buttons and corners.',
                default: true,
            },
            loopToFit: {
                type:    'toggle',
                label:   'Loop to fit',
                hint:    'Repeat the clip until the total duration is filled.',
                default: false,
            },
        },
    },

    // GENERATORS ────────────────────────────────────────────────────
    {
        id:       'spline',
        label:    'Spline',
        icon:     '〜',
        category: 'generator',
        hasInput: 'false',
        color:    'hsl(270,65%,60%)',
        isSource: true,
        hint:     'Animate a line through control points on the grid.',
        processor: processSpline,
        params: {
            controlPoints: { type: 'splinePoints', label: 'Control points', default: [{ col: 1, row: 1 }, { col: 8, row: 8 }] },
            curved:        { type: 'toggle', label: 'Curved',         default: true },
            direction:     { type: 'select', label: 'Direction',      default: 'forward',
                options: [{ value: 'forward', label: 'Forward' }, { value: 'reverse', label: 'Reverse' }, { value: 'pingpong', label: 'Ping-pong' }] },
            duration:      { type: 'int',    label: 'Duration (ticks)', default: 96, min: 1, max: 99999 },
            trailLength:   { type: 'int',    label: 'Trail length',    default: 0,   min: 0, max: 63 },
            trailDecay:    { type: 'float',  label: 'Trail decay',     default: 0.5, min: 0, max: 1, decimals: 2 },
            loop:          { type: 'toggle', label: 'Loop',            default: true },
            gradientRef:   { type: 'gradientRef', label: 'Gradient',   default: null },
            tension: {
                type:     'float',
                label:    'Tension',
                default:  0.5,
                min:      0,
                max:      1,
                decimals: 2,
                hint:     '0 = loose, 1 = tight. Only affects Catmull-Rom and Cardinal modes.',
            },
            smoothing: {
                type:    'select',
                label:   'Smoothing mode',
                default: 'catmull-rom',
                options: [
                    { value: 'catmull-rom', label: 'Catmull-Rom' },
                    { value: 'bezier',      label: 'Bezier (uses handles)' },
                    { value: 'cardinal',    label: 'Cardinal' },
                ],
            },
        },
    },
    {
        id:       'ripple generator',
        label:    'Ripple',
        icon:     '◎',
        color:    'hsl(270,65%,60%)',   // `color` not `timelineColor`
        category: 'generator',
        hint:     'Concentric rings expand from one or more origin points.',
        hasInput: false,
        processor: processRipple,
        params: {
            colourIdx: {
                type:    'paletteColour',
                label:   'Colour',
                default: 1,
            },
            origin: {
                type:    'select',
                label:   'Origin',
                default: 'center',
                options: [
                    { value: 'center',      label: 'Centre' },
                    { value: 'tl',          label: 'Top-left' },
                    { value: 'tr',          label: 'Top-right' },
                    { value: 'bl',          label: 'Bottom-left' },
                    { value: 'br',          label: 'Bottom-right' },
                    { value: 'all_corners', label: 'All corners' },
                    { value: 'top_edge',    label: 'Top edge' },
                    { value: 'bottom_edge', label: 'Bottom edge' },
                    { value: 'right_edge',  label: 'Right edge' },
                    { value: 'left_edge',   label: 'Left edge' },
                ],
            },
            speed: {
                type:     'knob',
                label:    'Speed',
                min:      0.1,
                max:      12.0,
                step:     0.1,
                decimals: 1,
                unit:     'units/s',
                hint:     'Grid units per second the front travels.',
                default:  2.0,
            },
            trailLength: {
                type:     'knob',
                label:    'Trail',
                min:      0,
                max:      8,
                step:     0.1,
                decimals: 1,
                unit:     'units',
                hint:     '0 = sharp ring. Higher = longer decay behind the front.',
                default:  2.5,
            },
            falloff: {
                type:    'select',
                label:   'Falloff',
                default: 'linear',
                options: [
                    { value: 'linear', label: 'Linear' },
                    { value: 'exp',    label: 'Exponential' },
                    { value: 'sharp',  label: 'Sharp ring' },
                ],
            },
            repeatInterval: {
                type:     'knob',
                label:    'Repeat',
                min:      0,
                max:      16,
                step:     0.25,
                decimals: 2,
                unit:     's',
                hint:     '0 = no repeat. Otherwise restarts every N seconds.',
                default:  4.0,
            },
            includeEdges: {
                type:    'toggle',
                label:   'Include edges',
                hint:    'Whether side buttons and corner cells participate.',
                default: false,
            },
        },
    },    

    // COLOUR ────────────────────────────────────────────────────────
    {
        id:       'gradientMap',
        label:    'Gradient Map',
        icon:     '◑',
        category: 'colour',
        color:    'hsl(38,80%,58%)',
        hint:     'Remap velocities through a gradient from the Velocity editor.',
        processor: processGradientMap,
        params: {
            gradientRef: { type: 'gradientRef', label: 'Gradient', default: null },
            mapMode: { type: 'select', label: 'Map mode', default: 'velocity',
                options: [{ value: 'velocity', label: 'By velocity' }, { value: 'time', label: 'By time' }] },
        },
    },
    {
        id:       'hueShift',
        label:    'Hue Shift',
        icon:     '◐',
        category: 'colour',
        color:    'hsl(38,80%,58%)',
        hint:     'Rotate hue of all velocities through the palette.',
        processor: processHueShift,
        params: {
            degrees: { type: 'knob',  label: 'Hue',   default: 0,   min: -180, max: 180, unit: '°', wrap: true,  decimals: 0 },
            satMult: { type: 'float', label: 'Sat ×', default: 1.0, min: 0,    max: 2,   decimals: 2 },
        },
    },
    {
        id:       'colour_palette',
        label:    'Palette Colour',
        icon:     '◈',
        color:    'hsl(38,80%,58%)',
        category: 'colour',
        hint:     'Fills pads with a single palette colour.',
        processor: processColour,
        params: {
            colourIdx: {
                type:    'paletteColour',
                label:   'Colour',
                default: 8,
            },
            zone: {
                type:    'select',
                label:   'Zone',
                default: 'all',
                options: [
                    { value: 'all',    label: 'All pads'     },
                    { value: 'main',   label: 'Main grid'    },
                    { value: 'edges',  label: 'Edges only'   },
                    { value: 'top',    label: 'Top row'      },
                    { value: 'bottom', label: 'Bottom row'   },
                    { value: 'left',   label: 'Left column'  },
                    { value: 'right',  label: 'Right column' },
                ],
            },
        },
    },

    // TRANSFORMS ────────────────────────────────────────────────────
    {
        id:       'rotate',
        label:    'Rotate',
        icon:     '↻',
        category: 'transform',
        color:    'hsl(210,70%,55%)',
        hint:     'Rotate spatial layout by any angle.',
        processor: processRotate,
        params: {
            degrees: {
                type:     'knob',
                label:    'Rotation',
                default:  0,
                min:      -180,
                max:      180,
                unit:     '°',
                wrap:     true,
                decimals: 1,
                hint:     'Positive = clockwise. Wraps freely past ±180.',
            },
            algorithm: {
                type:    'select',
                label:   'Algorithm',
                default: 'snap',
                options: [
                    { value: 'snap',     label: 'Snap: fast, gaps at odd angles' },
                    { value: 'shear',    label: 'Shear: 3-pass, fewer gaps'      },
                    { value: 'nearest4', label: 'Nearest-4: no gaps, slight blur' },
                    { value: 'area',     label: 'Area: coverage-weighted'         },
                    { value: 'radial',   label: 'Radial: preserves ring distance' },
                ],
                hint: 'How overlapping or off-grid pads are handled.',
            },
            fillGaps: {
                type:    'toggle',
                label:   'Fill gaps',
                default: false,
                hint:    'Assign dropped pads to the nearest available destination.',
            },
        },
    },
    {
        id:       'flip',
        label:    'Flip',
        icon:     '⇋',
        category: 'transform',
        color:    'hsl(210,70%,55%)',
        hint:     'Flip light effects horizontally or vertically.',
        processor: processFlip,
        params: {
            axis: { type: 'select', label: 'Axis', default: 'horizontal',
                options: [
                    { value: 'horizontal', label: 'Horizontal' }, 
                    { value: 'vertical', label: 'Vertical' }
                ] ,
                hint: 'Which axis to flip around.',
            },
        },
    },
    {
        id:       'translate',
        label:    'Translate',
        icon:     '⇄',
        category: 'transform',
        color:    'hsl(210,70%,55%)',
        hint:     'Shift light effects in the Launchpad grid.',
        processor: processTranslate,
        params: {
            deltaRow: { type: 'int', label: 'X offset', default: 0, min: -7, max: 7 },
            deltaCol: { type: 'int', label: 'Y offset', default: 0, min: -7, max: 7 },
        },
    },
    {
        id:       'scale',
        label:    'Scale',
        icon:     '⇪',
        category: 'transform',
        color:    'hsl(210,70%,55%)',
        hint:     'Scale light effects in the Launchpad grid.',
        processor: processScale,
        params: {
            scale: { type: 'float', label: 'Scale', default: '1', decimals: '1' },
            algorithm: {type: 'select', label: 'Algorithm', default: 'nearestneighbour',
                options: [
                    { value: 'nearestneighbour', label: 'Nearest Neighbour' },
                    { value: 'bilinear', label: 'Bilinear' },
                ],
                hint: 'Which scaling algorithm to use.'
            },
            fillGaps: {
                type:    'toggle',
                label:   'Fill gaps',
                default: false,
                hint:    'Assign dropped pads to the nearest available destination.',
            },
        }
    },

    // UTILITY ───────────────────────────────────────────────────────
    {
        id:          'layerMask',
        label:       'Layer Mask',
        icon:        '⧉',
        category:    'utility',
        color:       'hsl(220,20%,55%)',
        isMultiInput: true,
        hint:        'Composite two streams with blend modes and spatial masking. Connect a second node to the B input port.',
        processor: processLayerMask,
        params: {
            blendMode: { type: 'select', label: 'Blend mode', default: 'normal',
                options: [
                    { value: 'normal',   label: 'Normal'   },
                    { value: 'add',      label: 'Add'      },
                    { value: 'multiply', label: 'Multiply' },
                    { value: 'max',      label: 'Max (brightest)' },
                    { value: 'min',      label: 'Min (darkest)'   },
                    { value: 'screen',   label: 'Screen'   },
                    { value: 'gate',     label: 'Gate (B through A holes)' },
                    { value: 'mask',     label: 'Mask (B where A is lit)'  },
                ] },
            opacity:     { type: 'knob',   label: 'Opacity',       default: 1.0, min: 0, max: 1, decimals: 2 },
            regionMode:  { type: 'select', label: 'Region',        default: 'all',
                options: [
                    { value: 'all',    label: 'All pads'   },
                    { value: 'left',   label: 'Left half'  },
                    { value: 'right',  label: 'Right half' },
                    { value: 'top',    label: 'Top half'   },
                    { value: 'bottom', label: 'Bottom half'},
                ] },
            invertMask:  { type: 'toggle', label: 'Invert region', default: false },
            overlayOnly: { type: 'toggle', label: 'Overlay only',  default: false },
            timeOffset:  { type: 'int',    label: 'B time offset (ticks)', default: 0, min: -9999, max: 9999 },
        },
    },
    {
        id:         'merge',
        label:      'Merge',
        icon:       '⇥',
        category:   'utility',
        color:      'hsl(220,20%,55%)',
        isMultiInput: true,
        hint:       'Merges two stream without accounting for depth. Connect a second node to the B input port.',
        processor: processMerge,
        params: {
            opacity:     { type: 'knob',   label: 'Opacity',       default: 1.0, min: 0, max: 1, decimals: 2 },
            timeOffset:  { type: 'int',    label: 'B time offset (ticks)', default: 0, min: -9999, max: 9999 },
        },
    },
];

export const NODE_BY_ID = Object.fromEntries(NODES.map(n => [n.id, n]));

// Group by category for the node menu
export function getMenuGroups() {
    const groups = new Map();
    for (const cat of Object.values(NODE_CATEGORIES)) {
        const nodes = NODES.filter(n => n.category === cat.id);
        if (nodes.length) groups.set(cat.id, { ...cat, nodes });
    }
    return [...groups.values()];
}

export function processGraph(nodeInstances, context) {

    const wires = context?.wires ?? [];

    if (wires.length) {
        return processWiredGraph(nodeInstances, wires, context);
    }

    let events = [];

    for (const instance of nodeInstances) {

        if (!instance.enabled)
            continue;

        const desc = NODE_BY_ID[instance.nodeId];

        if (!desc?.processor)
            continue;

        if (desc.nodeType === 'generator') {

            events = desc.processor(
                events,
                instance.params,
                context
            );

        } else {

            events = desc.processor(
                events,
                instance.params,
                context
            );
        }
    }

    return events;
}

function processWiredGraph(nodeInstances, wires, context) {
    const instances = new Map(nodeInstances.map(instance => [instance.instanceId, instance]));
    const incoming = new Map();
    const outgoing = new Map();
    const cache = new Map();
    const visiting = new Set();

    for (const wire of wires) {
        if (!instances.has(wire.fromId) || !instances.has(wire.toId)) continue;
        if (!incoming.has(wire.toId)) incoming.set(wire.toId, []);
        if (!outgoing.has(wire.fromId)) outgoing.set(wire.fromId, []);
        incoming.get(wire.toId).push(wire);
        outgoing.get(wire.fromId).push(wire);
    }

    function run(instanceId) {
        if (cache.has(instanceId)) return cache.get(instanceId);
        if (visiting.has(instanceId)) return [];

        const instance = instances.get(instanceId);
        const desc = NODE_BY_ID[instance?.nodeId];
        if (!instance?.enabled || !desc?.processor) {
            cache.set(instanceId, []);
            return [];
        }

        visiting.add(instanceId);

        const inputWires = incoming.get(instanceId) ?? [];
        const streamA = mergeStreams(
            inputWires
                .filter(wire => wire.toPort !== 'inputB')
                .map(wire => run(wire.fromId))
        );
        const streamB = mergeStreams(
            inputWires
                .filter(wire => wire.toPort === 'inputB')
                .map(wire => run(wire.fromId))
        );

        const baseStream = desc.isSource && !inputWires.length ? [] : streamA;
        const result = desc.isMultiInput
            ? desc.processor(baseStream, instance.params, context, streamB)
            : desc.processor(baseStream, instance.params, context);

        visiting.delete(instanceId);
        cache.set(instanceId, result);
        return result;
    }

    const sinks = nodeInstances
        .filter(instance => instance.enabled)
        .filter(instance => !(outgoing.get(instance.instanceId)?.length));

    return mergeStreams(sinks.map(instance => run(instance.instanceId)));
}

function mergeStreams(streams) {
    return streams
        .flat()
        .filter(Boolean)
        .sort((a, b) => (a.absTime ?? 0) - (b.absTime ?? 0) || (a.noteNum ?? 0) - (b.noteNum ?? 0));
}
