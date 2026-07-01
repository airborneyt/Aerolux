# Kinetic Node Authoring and Launchpad Layout Guide

This document explains how Kinetic nodes are built in Aerolux, from the simplest possible node to more advanced graph-aware nodes, and how the Launchpad note layout is defined and extended when you add new buttons or coordinate regions.

## What Kinetic Is

Kinetic is the node-based MIDI effect workspace in Aerolux. The main entry point is [`src/components/pages/KineticPage.svelte`](../src/components/pages/KineticPage.svelte), which wires together:

- the node graph canvas
- the node palette
- the inspector
- the timeline
- the Launchpad preview
- export to MIDI

The actual runtime state for the workspace lives in [`src/stores/kinetic.svelte.js`](../src/stores/kinetic.svelte.js), while node definitions and processors live in [`src/lib/aerolux/nodeRegistry.js`](../src/lib/aerolux/nodeRegistry.js) and `src/lib/aerolux/nodes/`.

## The Core Mental Model

Every Kinetic node has two parts:

1. A **descriptor** in `nodeRegistry.js`
2. A **processor** in `src/lib/aerolux/nodes/`

The descriptor tells the UI how to render the node:

- label, icon, category, colour
- parameter schema
- whether it is a source or multi-input node
- which processor to call

The processor is the logic that transforms a stream of note events.

The standard event shape used throughout the system is:

```js
{
  absTime: number,
  noteNum: number,
  velocity: number,
  velBytePos: number
}
```

## Where Nodes Are Wired In

The main pipeline is:

- `KineticPage` reads `kinetic.nodeInstances`
- `processGraph(...)` walks the nodes in order
- if wires exist, `processGraph(...)` resolves connected streams through the graph
- if there are no wires, nodes run as a simple linear chain for quick prototyping
- each node processor returns a transformed event array
- the result is used for preview and export

Relevant files:

- [`src/components/pages/KineticPage.svelte`](../src/components/pages/KineticPage.svelte)
- [`src/lib/aerolux/nodeRegistry.js`](../src/lib/aerolux/nodeRegistry.js)
- [`src/stores/kinetic.svelte.js`](../src/stores/kinetic.svelte.js)

## Building A New Node

### 1) Decide the node type

There are a few useful patterns already in the repo:

- **Source nodes** generate events from scratch
- **Transforms** modify existing events
- **Colour remaps** change velocity-to-colour meaning
- **Utility / multi-input nodes** combine two streams
- **Editor-backed nodes** expose richer custom controls in the inspector

You can start simple and then grow a node into something much more complex without changing the overall architecture.

### 2) Add the descriptor

Add a new entry to `NODES` in [`src/lib/aerolux/nodeRegistry.js`](../src/lib/aerolux/nodeRegistry.js).

Minimal example:

```js
{
  id: 'myNode',
  label: 'My Node',
  icon: '✦',
  category: 'transform',
  color: 'hsl(210,70%,55%)',
  hint: 'Short description shown in the palette and inspector.',
  processor: processMyNode,
  params: {
    amount: {
      type: 'float',
      label: 'Amount',
      default: 0.5,
      min: 0,
      max: 1,
      decimals: 2,
    },
  },
}
```

The `params` schema drives the inspector automatically.

### 3) Implement the processor

Create a file in [`src/lib/aerolux/nodes/`](../src/lib/aerolux/nodes/) and export a function.

Example shape:

```js
export function processMyNode(noteOns, params, context) {
  const { amount = 0.5 } = params;
  const { palette = [] } = context;

  return noteOns.map(ev => ({
    ...ev,
    velocity: Math.max(0, Math.min(127, Math.round(ev.velocity * amount))),
  }));
}
```

Then import it at the top of `nodeRegistry.js` and reference it in the descriptor.

## Node Design Patterns

### Very Simple Nodes

Best for:

- one knob
- one toggle
- one straightforward transformation

Examples in the codebase:

- [`src/lib/aerolux/nodes/hueShift.js`](../src/lib/aerolux/nodes/hueShift.js)
- [`src/lib/aerolux/nodes/gradientMap.js`](../src/lib/aerolux/nodes/gradientMap.js)

Good shape:

- early-return if no work is needed
- keep the processor pure
- do not mutate external state

### Source Nodes

Source nodes ignore incoming events and build a new stream.

Example:

- [`src/lib/aerolux/nodes/clipImport.js`](../src/lib/aerolux/nodes/clipImport.js)

Source nodes usually:

- read raw context data
- create a fresh event array
- apply timing / looping / scaling
- return the full stream

### Spatial Transform Nodes

These nodes remap notes on the grid rather than just changing colour or timing.

Example:

- [`src/lib/aerolux/nodes/rotate.js`](../src/lib/aerolux/nodes/rotate.js)

Useful when you want:

- rotation
- translation
- reflection
- gap filling
- snapping between a grid and side buttons

### Colour and Palette Nodes

These nodes reinterpret velocity as colour information.

Examples:

- [`src/lib/aerolux/nodes/gradientMap.js`](../src/lib/aerolux/nodes/gradientMap.js)
- [`src/lib/aerolux/nodes/hueShift.js`](../src/lib/aerolux/nodes/hueShift.js)

These work well when paired with the Velocity editor because the Kinetic store can receive gradients through:

- [`registerGradient`](../src/stores/kinetic.svelte.js)
- [`availableGradients`](../src/stores/kinetic.svelte.js)

At runtime, Kinetic passes the Velocity editor palette as `context.palette` and the registered gradient map as `context.gradients`. A `null` gradient reference means "use the current live gradient", which is stored under the `current` key.

### Multi-Input Utility Nodes

Use this pattern when a node combines two streams.

Example:

- [`src/lib/aerolux/nodes/layerMask.js`](../src/lib/aerolux/nodes/layerMask.js)

This is the most flexible pattern in the current system. It can support:

- blend modes
- masking
- gating
- time offsets
- region selection
- overlay-only behaviour

If you are building a genuinely complex node, this is usually the right base pattern.

Multi-input nodes need both a descriptor flag and graph wires:

```js
{
  id: 'myComposite',
  label: 'My Composite',
  isMultiInput: true,
  processor: processMyComposite,
  // ...
}
```

The processor signature receives the second input as the fourth argument:

```js
export function processMyComposite(streamA, params, context, streamB = []) {
  return [...streamA, ...streamB].sort((a, b) => a.absTime - b.absTime);
}
```

## Adding Custom Inspector UI

The inspector is auto-generated in [`src/components/studio/NodeInspector.svelte`](../src/components/studio/NodeInspector.svelte).

Supported param types currently include:

- `knob`
- `toggle`
- `select`
- `int`
- `float`
- `splinePoints`
- `gradientRef`

If your node needs a special UI, you have two options:

1. Use one of the existing param types and let the inspector generate the control
2. Add a new custom control and route that param type explicitly in `NodeInspector.svelte`

For example:

- `splinePoints` opens [`SplinePointsControl.svelte`](../src/components/studio/controls/SplinePointsControl.svelte)
- `gradientRef` opens [`GradientRefControl.svelte`](../src/components/studio/controls/GradientRefControl.svelte)

For a more advanced spline workflow, the inspector also opens:

- [`src/components/studio/SplineAdvancedEditor.svelte`](../src/components/studio/SplineAdvancedEditor.svelte)

## Going From Basic To Very Complex

Here is a practical progression.

### Level 1: One parameter, one output

Example idea:

- multiply velocity by a scalar
- shift all notes by a fixed amount
- change note colours using one lookup

This is ideal when you want to prove the plumbing works.

### Level 2: Multiple parameters

Add a small amount of behaviour branching:

- a knob plus a toggle
- a select plus a numeric value
- a minimum/maximum range

Keep the processor pure and deterministic.

### Level 3: Structured data

Use richer param values like:

- arrays of points
- nested objects
- region masks
- gradient references

The current spline node is the clearest example of this style.

### Level 4: Context-aware nodes

Read from `context` as well as `params`.

Examples of available context data include:

- `device`
- `palette`
- `gradients`
- `totalDuration`
- `timeDiv`
- `bpm`
- `wires`

This lets nodes react to:

- the current palette
- imported gradients
- song length
- rhythmic resolution
- tempo

### Level 5: Stream-combining nodes

Use a second input stream, plus a secondary port on the graph node.

That is the pattern used by `layerMask`.

This style unlocks:

- sidechain-like masking
- compositing
- interaction between two rhythms
- overlay logic

### Level 6: Domain-specific editors

If a node needs a specialised visual editor, create a custom control component instead of trying to force it through a generic number field.

Examples:

- point editor on a 10×10 grid
- gradient picker with live preview
- future region editor for pad masks

## How To Add A New Node End-To-End

1. Add the processor file in `src/lib/aerolux/nodes/`
2. Import it into [`src/lib/aerolux/nodeRegistry.js`](../src/lib/aerolux/nodeRegistry.js)
3. Add a descriptor object to `NODES`
4. Add any custom inspector control if needed
5. Make sure the node returns valid events
6. Verify the node appears in [`NodeMenu.svelte`](../src/components/studio/NodeMenu.svelte)
7. Add or update tests / manual checks if the node affects export or preview

If the node depends on graph connections, test both modes: with explicit wires and with no wires. The no-wire mode intentionally behaves like a simple linear chain.

## Launchpad Note Layout

The Launchpad grid mapping is defined in [`src/lib/aerolux/midi-layout.js`](../src/lib/aerolux/midi-layout.js) and rendered by [`src/components/shared/VirtualLP.svelte`](../src/components/shared/VirtualLP.svelte).

The important concept is that the app uses **two coordinate systems**:

- **MIDI note numbers** in the Ableton Launchpad layout
- **SysEx pad numbers** used when sending RGB data

### Current Note Map

For the 8×8 main grid:

- notes `36–67` map to the left 4 columns
- notes `68–99` map to the right 4 columns

Side buttons depend on the device profile:

- top row: `28–35`
- right side: `100–107`
- left side: `108–115`
- bottom row: `116–123`

SysEx pad numbering is built from a bottom-left-origin grid:

- main grid: `11–88`
- top row: `91–98`
- right side: `19,29,...,89`
- left side: `10,20,...,80`
- bottom row: `1–8`
- corner / special button: `99`

The Launchpad preview component expects SysEx pad IDs, not MIDI note numbers. When a processor emits MIDI notes, Kinetic converts them through `noteToSysex(note, device)` before drawing the preview.

### Device Profiles

The active device profile is defined in `DEVICE_PROFILES` in [`midi-layout.js`](../src/lib/aerolux/midi-layout.js):

- `LPX` supports top and right buttons
- `LPP2` supports top, right, left, and bottom buttons
- `LPP3` supports top, right, left, and bottom buttons

The same kind of profile also exists visually in [`VirtualLP.svelte`](../src/components/shared/VirtualLP.svelte).

## How To Change The Launchpad Layout

If you want to add new notes or new button coordinates, update the mapping utilities first, then the preview.

### 1) Update the note mapping

Edit [`src/lib/aerolux/midi-layout.js`](../src/lib/aerolux/midi-layout.js).

You will usually need to change:

- `noteToCell(...)`
- `cellToNote(...)`
- `noteToSysex(...)`
- `cellToSysex(...)`
- `buildNoteToSysexMap(...)`
- `DEVICE_PROFILES`

### 2) Update visual rendering

Edit [`src/components/shared/VirtualLP.svelte`](../src/components/shared/VirtualLP.svelte) so the preview knows which pads exist and where they appear.

This file controls:

- which pads are drawn
- the hit-testing layout
- the note label rendering
- interaction with pressed pads

Keep `VirtualLP.svelte` visually aligned with `midi-layout.js`. If a note maps to a SysEx pad but `VirtualLP` does not draw that SysEx pad, the event can export correctly while disappearing from the preview.

### 3) Update note usage in node logic

Some processors assume the old 8×8 grid-only behavior.

Check these files if your new coordinates affect grid math:

- [`src/lib/aerolux/nodes/spline.js`](../src/lib/aerolux/nodes/spline.js)
- [`src/lib/aerolux/nodes/rotate.js`](../src/lib/aerolux/nodes/rotate.js)
- [`src/lib/aerolux/nodes/layerMask.js`](../src/lib/aerolux/nodes/layerMask.js)

### 4) Update the Launchpad preview logic

If the new notes should light up in the UI, also check:

- [`src/components/pages/KineticPage.svelte`](../src/components/pages/KineticPage.svelte)
- `lpColors` construction inside that file

### 5) Update MIDI send / preview code

If you send raw pad data anywhere else, update that mapping too:

- [`src/lib/aerolux/midi-panel.js`](../src/lib/aerolux/midi-panel.js)

## Adding New Buttons And Coordinates

Suppose you want to add a new button zone, for example a custom top-left cluster.

The safest workflow is:

1. Decide whether the new buttons are part of the Launchpad note range or just an internal visualization
2. Extend `ZONE` in [`midi-layout.js`](../src/lib/aerolux/midi-layout.js) if this is a new semantic region
3. Extend `DEVICE_PROFILES` if the device actually supports it
4. Teach `noteToCell` how to recognise the new notes
5. Teach `cellToNote` and `cellToSysex` how to convert back
6. Update `buildNoteToSysexMap` so the bulk sender includes the new notes
7. Update `VirtualLP.svelte` so the new buttons render in the right place

If the new buttons are just an internal coordinate system and do not correspond to real Launchpad notes, you can still use them inside nodes, but you must keep them out of the actual MIDI export path unless you map them explicitly.

## Recommended Coordinate Strategy

To avoid future confusion, keep these rules consistent:

- main-grid coordinates are always `row 0..7`, `col 0..7`
- side-button coordinates should be clearly separated from main-grid coordinates
- note-to-cell conversions should return `null` for unsupported notes
- visual grids and MIDI grids should use the same orientation conventions where possible

That makes complex nodes much easier to reason about, especially rotation, masking, and custom pattern generators.

## Good Node Ideas By Complexity

### Basic

- velocity scaler
- note filter
- note delay
- repeat / echo

### Intermediate

- pad remapper
- probabilistic gate
- gradient-based transformer
- velocity quantizer

### Advanced

- multi-stream blend node
- region-aware compositor
- spline generator with custom handles
- time-synced pattern morph node

### Very Advanced

- node with its own canvas editor
- node that depends on imported assets
- node that combines multiple context sources
- node that emits structured events for downstream nodes

## Practical Advice

- Keep processors pure when possible.
- Prefer small parameter schemas that are easy to inspect.
- Add custom controls only when the generic inspector is not enough.
- If you change layout math, update both the mapping utilities and the visual preview.
- When adding a complex node, prototype the simplest version first and then layer on features.

## Files To Read First

- [`src/lib/aerolux/nodeRegistry.js`](../src/lib/aerolux/nodeRegistry.js)
- [`src/stores/kinetic.svelte.js`](../src/stores/kinetic.svelte.js)
- [`src/components/pages/KineticPage.svelte`](../src/components/pages/KineticPage.svelte)
- [`src/lib/aerolux/midi-layout.js`](../src/lib/aerolux/midi-layout.js)
- [`src/components/shared/VirtualLP.svelte`](../src/components/shared/VirtualLP.svelte)
- [`src/components/studio/NodeInspector.svelte`](../src/components/studio/NodeInspector.svelte)
- [`src/components/studio/NodeMenu.svelte`](../src/components/studio/NodeMenu.svelte)

If you want, the next step is usually to make a new node by copying one existing processor and one registry entry, then iterating from there.
