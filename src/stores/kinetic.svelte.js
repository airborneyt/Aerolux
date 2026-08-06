// src/stores/kinetic.svelte.js
// ============================================================================
// KINETIC ENGINE: STORE
// timeRange/automation, nested graph navigation for composite clips, 
// grouping and bake caching, node/composite duplication, ungrouping, 
// and transport looping.
// ============================================================================

import { resolveField } from '../lib/aerolux/kinetic/nodeRegistry.js';
import { bakeComposite as precomputeBakeCache } from '../lib/aerolux/kinetic/bake.js';
import { createUndoEngine } from '../lib/aerolux/kinetic/kinetic-state.js';
import { emitter } from '../lib/aerolux/aerolux-init.svelte.js';

// id helpers –––––––––––––––––––––––––––––––––––––––––––––––––––––––

let __idCounter = 0;
function makeId(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${++__idCounter}`;
}

let __noCounter = 1;

// replaces an array's contents in place, so callers holding a reference to
// it (e.g. from currentWires()) see the change
function replaceContents(arr, newContents) {
    arr.length = 0;
    arr.push(...newContents);
}

// device factory –––––––––––––––––––––––––––––––––––––––––––––––––––

function createDevice(overrides = {}) {
    return {
        id:          makeId('device'),
        instanceNo: 'LP ' + __noCounter,
        midiIn:      null,
        midiOut:     null,
        position:    { x: 0, y: 0 },
        rotation:    0,
        isPrimary:   false,
        enabled:     true,
        muted:       false,
        brightness:  1.0,
        logoOrMode:  'logo',
        // Live MIDI push (Stage modal)
        // null port = not connected
        outputPort:   null,               // string | null (a real output port name)
        displayMode:  'palette',          // 'palette' (snap to editor.palette) | 'sysex' (full 262k-colour RGB)
        ...overrides,
    };
}

// store ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

export const kinetic = $state({
    rootInstances: [],   // NodeInstance[]
    rootWires:     [],   // Wire[]
    graphPath: [],
    selectedInstanceId: null,
    selectedWireId:     null,
    graphVersion: 0,
    devices: [createDevice({ isPrimary: true })],
    transport: {
        playing:       false,
        playheadTick:  0,
        bpm:           120,
        timeDiv:       96,
        totalDuration: 960,
        loop:          false,
    },
});

// gradient registry ––––––––––––––––––––––––––––––––––––––––––––––––
// the cross-workspace bridge between Velocity's live gradient editor and
// Kinetic's engine. VelocityPage.svelte calls registerGradient('current', gr)
// everytime its gradResult() changes, so Kinetic will always have a live view 
// of whatever is in Velocity without either workspace importing the other store.
// saved gradient presets are also stored.
export const availableGradients = $state({ map: new Map() });

/**
    registers (or updates) a named gradient result for Kinetic's engine to
    read via context.gradients.

@param {string} id
@param {Array<{step:number, velocity:number}>} gradResult
*/
export function registerGradient(id, gradResult) {
    if (!id || !Array.isArray(gradResult)) return;
    availableGradients.map.set(id, gradResult);
}

// removes a registered gradient (e.g. a preset that's since been deleted)
export function unregisterGradient(id) {
    availableGradients.map.delete(id);
}

// graph resolution –––––––––––––––––––––––––––––––––––––––––––––––––

function resolveGraphAtPath(path) {
    let instances = kinetic.rootInstances;
    let wires     = kinetic.rootWires;

    for (const instanceId of path) {
        const composite = instances.find(n => n.instanceId === instanceId);
        if (!composite || composite.nodeId !== 'composite' || !composite.subgraph) {
            return { nodeInstances: kinetic.rootInstances, wires: kinetic.rootWires, valid: false };
        }
        instances = composite.subgraph.nodeInstances;
        wires     = composite.subgraph.wires;
    }

    return { nodeInstances: instances, wires, valid: true };
}

const currentGraphRef = $derived.by(() => resolveGraphAtPath(kinetic.graphPath));

export function currentInstances() { return currentGraphRef.nodeInstances; }
export function currentWires()     { return currentGraphRef.wires; }
export function isGraphPathValid() { return currentGraphRef.valid; }

// undo / redo ––––––––––––––––––––––––––––––––––––––––––––––––––––––
// scope: rootInstances + rootWires and devices[]
//
// bake caches are stripped from every snapshot
//
// mutators call pushKineticUndo() themselves for anything that's a single
// discrete gesture (addNode, removeNode, addWire, removeWire, duplicateNode,
// groupSelectionIntoComposite, ungroupComposite, addAutoPoint,
// removeAutoPoint, setTimeRange, toggleNode, pasteClipboard, addDevice,
// removeDevice, setPrimaryDevice, etc etc). anything that can also fire continuously
// (moveNode during a drag, setParam during a knob drag, updateDevice during
// a Stage-modal drag) does not push internally; the calling UI
// pushes once at gesture-start instead

function stripBakes(instances) {
    return instances.map(n => ({
        ...n,
        params: { ...n.params },
        position: { ...n.position },
        automation: Object.fromEntries(
            Object.entries(n.automation ?? {}).map(([k, lane]) => [k, lane.map(p => ({ ...p }))])
        ),
        timeRange: n.timeRange ? { ...n.timeRange } : null,
        baked: false,
        bakedCache: null,
        subgraph: n.subgraph
            ? { nodeInstances: stripBakes(n.subgraph.nodeInstances), wires: n.subgraph.wires.map(w => ({ ...w })) }
            : null,
    }));
}

function snapKineticState() {
    return {
        rootInstances: stripBakes(kinetic.rootInstances),
        rootWires: kinetic.rootWires.map(w => ({ ...w })),
        devices: kinetic.devices.map(d => ({ ...d, position: { ...d.position } })),
    };
}

function applyKineticState(snap) {
    kinetic.rootInstances = stripBakes(snap.rootInstances);
    kinetic.rootWires = snap.rootWires.map(w => ({ ...w }));
    kinetic.devices = snap.devices.map(d => ({ ...d, position: { ...d.position } }));

    if (!kinetic.devices.some(d => d.isPrimary) && kinetic.devices.length) {
        kinetic.devices[0].isPrimary = true;
    }
    if (!resolveGraphAtPath(kinetic.graphPath).valid) {
        kinetic.graphPath = [];
    }
    kinetic.selectedInstanceId = null;
    kinetic.selectedWireId = null;
}

const kineticUndoEngine = createUndoEngine({
    getSnapshot: snapKineticState,
    applySnapshot: applyKineticState,
});

export const kineticUndoState = $state({ canUndo: false, canRedo: false });

function syncKineticUndoState() {
    kineticUndoState.canUndo = kineticUndoEngine.canUndo();
    kineticUndoState.canRedo = kineticUndoEngine.canRedo();
}

let batching = false;

export function pushKineticUndo() {
    markKineticDirty();
    if (batching) return;
    kineticUndoEngine.pushUndo();
    syncKineticUndoState();
}

/**
    runs `fn`, collapsing every pushKineticUndo() call made during it into a
    single undo step; for gestures that loop a normally-single-action
    mutator (multi-node delete, multi-node duplicate, disconnect-all-wires),
    which would otherwise push once per iteration.

@param {() => void} fn
*/
export function runKineticBatch(fn) {
    if (batching) { fn(); return; }
    pushKineticUndo();
    batching = true;
    try {
        fn();
    } finally {
        batching = false;
    }
}

export function undoKinetic() {
    const did = kineticUndoEngine.undo();
    if (did) syncKineticUndoState();
    return did;
}

export function redoKinetic() {
    const did = kineticUndoEngine.redo();
    if (did) syncKineticUndoState();
    return did;
}

// dirty tracking + project persistence entry points ––––––––––––––––

function markKineticDirty() {
    emitter.emit('kinetic:change');
}

/**
    resets Kinetic to a brand-new, empty project: single default device,
    default transport settings, cleared undo history
*/
export function resetKineticState() {
    kinetic.rootInstances = [];
    kinetic.rootWires = [];
    kinetic.devices = [createDevice({ isPrimary: true })];
    kinetic.graphPath = [];
    kinetic.selectedInstanceId = null;
    kinetic.selectedWireId = null;
    kinetic.transport.playing = false;
    kinetic.transport.playheadTick = 0;
    kinetic.transport.bpm = 120;
    kinetic.transport.timeDiv = 96;
    kinetic.transport.totalDuration = 960;
    kinetic.transport.loop = false;
    kineticUndoEngine.clear();
    syncKineticUndoState();
}

/**
    applies a deserialized project snapshot (project-kinetic.js's
    deserializeKineticState) into the live store upon project load.

@param {{rootInstances:Array, rootWires:Array, devices:Array|null, transport:object}} loaded
*/
export function applyKineticProjectState(loaded) {
    kinetic.rootInstances = loaded.rootInstances;
    kinetic.rootWires = loaded.rootWires;
    kinetic.devices = (loaded.devices && loaded.devices.length)
        ? loaded.devices
        : [createDevice({ isPrimary: true })];
    if (!kinetic.devices.some(d => d.isPrimary)) kinetic.devices[0].isPrimary = true;

    // loaded devices carry their own `seq` values (from whenever they were
    // originally created)
    for (const d of kinetic.devices) {
        if (typeof d.seq === 'number' && d.seq > __deviceSeqCounter) __deviceSeqCounter = d.seq;
    }

    kinetic.graphPath = [];
    kinetic.selectedInstanceId = null;
    kinetic.selectedWireId = null;
    kinetic.transport.playing = false;
    kinetic.transport.playheadTick = 0;
    kinetic.transport.bpm = loaded.transport.bpm;
    kinetic.transport.timeDiv = loaded.transport.timeDiv;
    kinetic.transport.totalDuration = loaded.transport.totalDuration;
    kinetic.transport.loop = loaded.transport.loop;

    kineticUndoEngine.clear();
    syncKineticUndoState();
}

// bake cache invalidation ––––––––––––––––––––––––––––––––––––––––––
// the cache invalidates whenever that composite's internal subgraph is
// edited while open (destructive-in-effect at the composite boundary,
// non-destructive to anything outside it).
// walks graphPath root-first, clearing the bake of every ancestor 
// composite that's currently baked (not just the deepest one) since an 
// ancestor's own bake would have captured whatever the edited composite 
// used to output, and is therefore equally stale now. never touches 
// siblings or anything outside the path. called at the top of every 
// mutator that changes something a field actually depends on (params, 
// wires, enabled state, time ranges, automation). not called from 
// moveNode/renameNode, which are cosmetic and never change sampled output.
function invalidateBakesAlongPath() {
    kinetic.graphVersion++;
    let instances = kinetic.rootInstances;
    for (const instanceId of kinetic.graphPath) {
        const composite = instances.find(n => n.instanceId === instanceId);
        if (!composite) break;
        if (composite.baked) {
            composite.baked = false;
            composite.bakedCache = null;
        }
        instances = composite.subgraph?.nodeInstances ?? [];
    }
}

// navigation –––––––––––––––––––––––––––––––––––––––––––––––––––––––

export function openComposite(instanceId) {
    const composite = currentInstances().find(n => n.instanceId === instanceId);
    if (!composite || composite.nodeId !== 'composite') return false;
    kinetic.graphPath = [...kinetic.graphPath, instanceId];
    kinetic.selectedInstanceId = null;
    kinetic.selectedWireId = null;
    return true;
}

export function closeComposite() {
    if (!kinetic.graphPath.length) return;
    kinetic.graphPath = kinetic.graphPath.slice(0, -1);
    kinetic.selectedInstanceId = null;
    kinetic.selectedWireId = null;
}

export function goToBreadcrumb(depth) {
    kinetic.graphPath = kinetic.graphPath.slice(0, Math.max(0, depth));
    kinetic.selectedInstanceId = null;
    kinetic.selectedWireId = null;
}

export function breadcrumbLabels() {
    const labels = ['Root'];
    let instances = kinetic.rootInstances;
    for (const instanceId of kinetic.graphPath) {
        const composite = instances.find(n => n.instanceId === instanceId);
        if (!composite) { labels.push('(missing)'); break; }
        labels.push(composite.label ?? 'Composite');
        instances = composite.subgraph?.nodeInstances ?? [];
    }
    return labels;
}

// node instance mutators –––––––––––––––––––––––––––––––––––––––––––

export function addNode(nodeId, params = {}, position) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const instances = currentInstances();
    const pos = position ?? { x: 80 + instances.length * 220, y: 80 };
    const instance = {
        instanceId: makeId('node'),
        nodeId,
        enabled:    true,
        params:     { ...params },
        position:   { ...pos },
        timeRange:  null,
        automation: {},
        label:      null,
        subgraph:   nodeId === 'composite' ? { nodeInstances: [], wires: [] } : null,
        baked:      false,
        bakedCache: null,
    };
    instances.push(instance);
    kinetic.selectedInstanceId = instance.instanceId;
    return instances.find(n => n.instanceId === instance.instanceId);
}

export function removeNode(instanceId) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const instances = currentInstances();
    const idx = instances.findIndex(n => n.instanceId === instanceId);
    if (idx !== -1) instances.splice(idx, 1);

    const wires = currentWires();
    replaceContents(wires, wires.filter(w => w.fromId !== instanceId && w.toId !== instanceId));

    if (kinetic.selectedInstanceId === instanceId) kinetic.selectedInstanceId = null;

    const pathIdx = kinetic.graphPath.indexOf(instanceId);
    if (pathIdx !== -1) kinetic.graphPath = kinetic.graphPath.slice(0, pathIdx);
}

export function moveNode(instanceId, x, y) {
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (node) { node.position = { x, y }; markKineticDirty(); }
}

export function setParam(instanceId, paramKey, value) {
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (node) { node.params[paramKey] = value; markKineticDirty(); }
}

export function toggleNode(instanceId) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (node) node.enabled = !node.enabled;
}

export function renameNode(instanceId, label) {
    pushKineticUndo();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (node) node.label = label || null;
}

export function selectNode(instanceId) {
    kinetic.selectedInstanceId = instanceId;
    kinetic.selectedWireId = null;
}

// duplication ––––––––––––––––––––––––––––––––––––––––––––––––––––––
// deep-clones a node instance; and for a composite, its entire nested
// subgraph, with freshly-generated ids at every level so the clone never
// shares an instanceId with the original anywhere in the tree; and
// inserts it into the current graph level, offset slightly so it doesn't
// sit exactly on top of the original. a duplicate never carries over the
// original's wires; it starts disconnected, same as a freshly-added node.

function cloneSubgraphWithFreshIds(subgraph) {
    if (!subgraph) return null;
    const idMap = new Map();
    const nodeInstances = subgraph.nodeInstances.map(n => {
        const newId = makeId('node');
        idMap.set(n.instanceId, newId);
        return { ...n, instanceId: newId };
    });
    // recurse into any nested composites, now that every id at this level
    // is known (nested subgraphs reference only their own children, never
    // sibling ids at this level, so order doesn't matter here)
    for (let i = 0; i < nodeInstances.length; i++) {
        if (nodeInstances[i].subgraph) {
            nodeInstances[i] = { ...nodeInstances[i], subgraph: cloneSubgraphWithFreshIds(nodeInstances[i].subgraph) };
        }
    }
    const wires = subgraph.wires.map(w => ({
        ...w,
        id: makeId('wire'),
        fromId: idMap.get(w.fromId) ?? w.fromId,
        toId: idMap.get(w.toId) ?? w.toId,
    }));
    return { nodeInstances, wires };
}

/**
    duplicates a node instance (or a composite and its whole nested subgraph)
    into the currently-open graph level. returns the new instance, or null if
    the source instance doesn't exist at this level.

@param {string} instanceId
@returns {Object|null}
*/
export function duplicateNode(instanceId) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const instances = currentInstances();
    const source = instances.find(n => n.instanceId === instanceId);
    if (!source) return null;

    const clone = {
        ...source,
        instanceId: makeId('node'),
        params: { ...source.params },
        position: { x: (source.position?.x ?? 0) + 32, y: (source.position?.y ?? 0) + 32 },
        automation: Object.fromEntries(
            Object.entries(source.automation ?? {}).map(([k, lane]) => [k, lane.map(p => ({ ...p }))])
        ),
        timeRange: source.timeRange ? { ...source.timeRange } : null,
        subgraph: cloneSubgraphWithFreshIds(source.subgraph),
        baked: false,
        bakedCache: null,
    };
    instances.push(clone);
    kinetic.selectedInstanceId = clone.instanceId;
    return instances.find(n => n.instanceId === clone.instanceId);
}

// copy / paste –––––––––––––––––––––––––––––––––––––––––––––––––––––
// reuses duplicateNode's fresh-id subgraph cloning 
// (cloneSubgraphWithFreshIds) so a paste never shares an instanceId with 
// its source. only wires strictly internal to the copied selection survive 
// the copy; any wire touching something outside the selection is dropped,
// the same "starts disconnected at the boundary" precedent duplicateNode
// already set for composites.
let clipboard = null; // { nodes: [...], wires: [...] } | null

export function copySelectionToClipboard(instanceIds) {
    const instances = currentInstances();
    const wires = currentWires();
    const selectedSet = new Set(instanceIds);
    const selectedInstances = instances.filter(n => selectedSet.has(n.instanceId));
    if (!selectedInstances.length) return false;

    clipboard = {
        nodes: selectedInstances.map(n => ({
            ...n,
            params: { ...n.params },
            position: { ...n.position },
            automation: Object.fromEntries(
                Object.entries(n.automation ?? {}).map(([k, lane]) => [k, lane.map(p => ({ ...p }))])
            ),
            timeRange: n.timeRange ? { ...n.timeRange } : null,
            subgraph: cloneSubgraphWithFreshIds(n.subgraph),
            baked: false,
            bakedCache: null,
        })),
        wires: wires
            .filter(w => selectedSet.has(w.fromId) && selectedSet.has(w.toId))
            .map(w => ({ ...w })),
    };
    return true;
}

export function hasClipboardContent() { return !!clipboard?.nodes?.length; }

/**
    pastes the clipboard into the currently-open graph level, with fresh ids
    at every level. positions offset by `offset` (default a small diagonal 
    nudge so a paste never lands exactly on top of its source. returns the 
    pasted instanceIds (empty array if the clipboard is empty).

@param {{x:number,y:number}} [offset]
@returns {string[]}
*/
export function pasteClipboard(offset = { x: 32, y: 32 }) {
    if (!clipboard?.nodes?.length) return [];
    pushKineticUndo();
    invalidateBakesAlongPath();
    const instances = currentInstances();
    const wires = currentWires();

    const idMap = new Map();
    const pasted = clipboard.nodes.map(n => {
        const newId = makeId('node');
        idMap.set(n.instanceId, newId);
        return {
            ...n,
            instanceId: newId,
            params: { ...n.params },
            position: { x: (n.position?.x ?? 0) + offset.x, y: (n.position?.y ?? 0) + offset.y },
            automation: Object.fromEntries(
                Object.entries(n.automation ?? {}).map(([k, lane]) => [k, lane.map(p => ({ ...p }))])
            ),
            timeRange: n.timeRange ? { ...n.timeRange } : null,
            subgraph: cloneSubgraphWithFreshIds(n.subgraph),
            baked: false,
            bakedCache: null,
        };
    });
    instances.push(...pasted);

    const pastedWires = clipboard.wires.map(w => ({
        id: makeId('wire'),
        fromId: idMap.get(w.fromId) ?? w.fromId,
        fromPort: w.fromPort,
        toId: idMap.get(w.toId) ?? w.toId,
        toPort: w.toPort,
    }));
    wires.push(...pastedWires);

    const pastedIds = pasted.map(n => n.instanceId);
    kinetic.selectedInstanceId = pastedIds[pastedIds.length - 1] ?? null;
    return pastedIds;
}

// grouping –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// pure graph transformation over whichever level is currently open
// (currentInstances()/currentWires()).

function externalKey(id, port) { return `${id}:${port}`; }

function averagePosition(nodes) {
    if (!nodes.length) return { x: 80, y: 80 };
    const x = nodes.reduce((sum, n) => sum + (n.position?.x ?? 0), 0) / nodes.length;
    const y = nodes.reduce((sum, n) => sum + (n.position?.y ?? 0), 0) / nodes.length;
    return { x, y };
}

/**
    groups the given instanceIds (must all live at the currently-open graph
    level) into a single new composite instance. returns
    `{ ok: true, composite }` on success, or `{ ok: false, reason }` if the
    selection doesn't fit v1's boundary-shape constraints. callers should
    surface `reason` to the user rather than silently doing nothing.
 *
 * @param {string[]} instanceIds
 * @param {string} [label]
 * @returns {{ok:true, composite:Object} | {ok:false, reason:string}}
 */
export function groupSelectionIntoComposite(instanceIds, label = 'Composite') {
    invalidateBakesAlongPath();
    const instances = currentInstances();
    const wires = currentWires();
    const selectedSet = new Set(instanceIds);

    const selectedInstances = instances.filter(n => selectedSet.has(n.instanceId));
    if (selectedInstances.length !== new Set(instanceIds).size) {
        return { ok: false, reason: 'One or more selected instances are not in the current graph.' };
    }
    if (!selectedInstances.length) {
        return { ok: false, reason: 'Nothing selected.' };
    }

    const incomingExternal = wires.filter(w => selectedSet.has(w.toId) && !selectedSet.has(w.fromId));
    const outgoingExternal = wires.filter(w => selectedSet.has(w.fromId) && !selectedSet.has(w.toId));
    const internalWires    = wires.filter(w => selectedSet.has(w.fromId) && selectedSet.has(w.toId));

    // distinct external sources feeding in; dedupe: one external source
    // wired to several selected nodes is still one composite input port.
    const entrySources = [...new Map(
        incomingExternal.map(w => [externalKey(w.fromId, w.fromPort), w])
    ).values()];
    if (entrySources.length > 2) {
        return {
            ok: false,
            reason: `Selection has ${entrySources.length} distinct external inputs; composites support at most 2 (input + inputB).`,
        };
    }

    // distinct internal sources feeding out; more than one means two
    // independent internal signals would need to leave via a single output
    // port, which isn't representable.
    const exitSources = [...new Map(
        outgoingExternal.map(w => [externalKey(w.fromId, w.fromPort), w])
    ).values()];
    if (exitSources.length > 1) {
        return {
            ok: false,
            reason: `Selection has ${exitSources.length} distinct internal nodes feeding outside the selection; composites support exactly one exit point.`,
        };
    }

    pushKineticUndo();

    // build the subgraph –––––––––––––––––––––––––––––––––
    const subInstances = selectedInstances.map(n => ({ ...n, params: { ...n.params }, position: { ...n.position } }));
    const subWires = internalWires.map(w => ({ ...w }));

    // groupInput / groupInputB boundary nodes, one per distinct entry
    // source, in first-encountered order.
    const boundaryNodes = entrySources.map((src, i) => ({
        instanceId: makeId('node'),
        nodeId: i === 0 ? 'groupInput' : 'groupInputB',
        enabled: true, params: {}, position: { x: -180, y: 40 + i * 120 },
        timeRange: null, automation: {}, label: null, subgraph: null,
    }));
    subInstances.push(...boundaryNodes);

    // reroute each incoming-external wire: (external -> selected) becomes
    // (boundary node -> selected), inside the subgraph.
    for (const w of incomingExternal) {
        const key = externalKey(w.fromId, w.fromPort);
        const boundary = boundaryNodes[entrySources.findIndex(e => externalKey(e.fromId, e.fromPort) === key)];
        subWires.push({ id: makeId('wire'), fromId: boundary.instanceId, fromPort: 'output', toId: w.toId, toPort: w.toPort });
    }

    // internal output node (target: 'group'); the subgraph's own
    // designated result. reuses compileGraph.js's already-generic
    // target-keyed outputs map; nothing there needs to change.
    if (exitSources.length === 1) {
        const groupOutput = {
            instanceId: makeId('node'), nodeId: 'output',
            enabled: true, params: { target: 'group' }, position: { x: 400, y: 80 },
            timeRange: null, automation: {}, label: null, subgraph: null,
        };
        subInstances.push(groupOutput);
        subWires.push({
            id: makeId('wire'),
            fromId: exitSources[0].fromId, fromPort: exitSources[0].fromPort,
            toId: groupOutput.instanceId, toPort: 'input',
        });
    }

    // build the composite instance –––––––––––––––––––––––
    const composite = {
        instanceId: makeId('node'), nodeId: 'composite',
        enabled: true, params: {}, position: averagePosition(selectedInstances),
        timeRange: null, automation: {},
        label: label || 'Composite',
        subgraph: { nodeInstances: subInstances, wires: subWires },
        baked: false, bakedCache: null,
        // per-instance port-count override; composites don't have a fixed
        // hasInput/isMultiInput in NODE_DEFS the way every other node does,
        // since different composite instances expose different numbers of
        // ports depending on what was grouped. consumers should read
        // `instance.hasInput ?? def.hasInput` (falls back to the registry
        // default for every other node type).
        hasInput: entrySources.length >= 1,
        isMultiInput: entrySources.length >= 2,
    };

    // splice the outer graph –––––––––––––––––––––––––––––
    replaceContents(instances, instances.filter(n => !selectedSet.has(n.instanceId)));
    replaceContents(wires, wires.filter(w => !selectedSet.has(w.fromId) && !selectedSet.has(w.toId)));
    instances.push(composite);

    entrySources.forEach((src, i) => {
        wires.push({
            id: makeId('wire'), fromId: src.fromId, fromPort: src.fromPort,
            toId: composite.instanceId, toPort: i === 0 ? 'input' : 'inputB',
        });
    });
    for (const w of outgoingExternal) {
        wires.push({ id: makeId('wire'), fromId: composite.instanceId, fromPort: 'output', toId: w.toId, toPort: w.toPort });
    }

    kinetic.selectedInstanceId = composite.instanceId;
    return { ok: true, composite: instances.find(n => n.instanceId === composite.instanceId) };
}

// ungroup ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// the inverse of groupSelectionIntoComposite: splices a composite's own
// subgraph nodes/wires back into whichever level the composite currently
// lives at, rewires whatever was externally connected to the composite's
// input/inputB/output ports directly to the corresponding internal
// node(s), and removes the composite along with its groupInput/
// groupInputB/target:'group' Output boundary nodes; those have no
// meaning outside a composite's own subgraph. a baked composite is
// ungrouped exactly the same way; its (now-orphaned) bake cache is
// discarded along with the composite instance itself.

export function ungroupComposite(instanceId) {
    invalidateBakesAlongPath();
    const instances = currentInstances();
    const wires = currentWires();

    const composite = instances.find(n => n.instanceId === instanceId);
    if (!composite || composite.nodeId !== 'composite' || !composite.subgraph) {
        return { ok: false, reason: 'Not a composite instance.' };
    }

    pushKineticUndo();

    const sub = composite.subgraph;
    const boundaryIds = new Set(
        sub.nodeInstances.filter(n => n.nodeId === 'groupInput' || n.nodeId === 'groupInputB').map(n => n.instanceId)
    );
    const groupOutputNode = sub.nodeInstances.find(n => n.nodeId === 'output' && n.params?.target === 'group');

    // what did groupInput/groupInputB feed internally? an external wire
    // that fed the composite's `input`/`inputB` should, post-ungroup, feed
    // those same internal targets directly.
    const boundaryTargets = new Map(); // 'input'|'inputB' -> [{toId,toPort}]
    for (const n of sub.nodeInstances) {
        if (n.nodeId !== 'groupInput' && n.nodeId !== 'groupInputB') continue;
        const port = n.nodeId === 'groupInput' ? 'input' : 'inputB';
        const outs = sub.wires.filter(w => w.fromId === n.instanceId);
        boundaryTargets.set(port, outs.map(w => ({ toId: w.toId, toPort: w.toPort })));
    }
    // what fed the internal group output? an external wire that consumed
    // the composite's `output` should, post-ungroup, be fed directly by
    // that same internal source.
    const groupOutputSource = groupOutputNode
        ? sub.wires.find(w => w.toId === groupOutputNode.instanceId)
        : null;

    const offsetX = composite.position?.x ?? 0;
    const offsetY = composite.position?.y ?? 0;

    const realNodes = sub.nodeInstances
        .filter(n => !boundaryIds.has(n.instanceId) && n !== groupOutputNode)
        .map(n => ({ ...n, position: { x: (n.position?.x ?? 0) + offsetX, y: (n.position?.y ?? 0) + offsetY } }));

    const realWires = sub.wires.filter(w =>
        !boundaryIds.has(w.fromId) && !boundaryIds.has(w.toId) &&
        (!groupOutputNode || (w.fromId !== groupOutputNode.instanceId && w.toId !== groupOutputNode.instanceId))
    );

    const externalIncoming = wires.filter(w => w.toId === instanceId);
    const externalOutgoing = wires.filter(w => w.fromId === instanceId);

    // splice into the outer graph: drop the composite and its own wires,
    // insert the real subgraph nodes/wires, then reconnect the boundary.
    replaceContents(instances, instances.filter(n => n.instanceId !== instanceId));
    instances.push(...realNodes);

    replaceContents(wires, wires.filter(w => w.fromId !== instanceId && w.toId !== instanceId));
    wires.push(...realWires);

    for (const ext of externalIncoming) {
        const targets = boundaryTargets.get(ext.toPort) ?? [];
        for (const t of targets) {
            wires.push({ id: makeId('wire'), fromId: ext.fromId, fromPort: ext.fromPort, toId: t.toId, toPort: t.toPort });
        }
    }
    if (groupOutputSource) {
        for (const ext of externalOutgoing) {
            wires.push({
                id: makeId('wire'),
                fromId: groupOutputSource.fromId, fromPort: groupOutputSource.fromPort,
                toId: ext.toId, toPort: ext.toPort,
            });
        }
    }

    kinetic.selectedInstanceId = null;
    return { ok: true };
}

// time-range –––––––––––––––––––––––––––––––––––––––––––––––––––––––

export function setTimeRange(instanceId, start, end) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (!node) return;
    node.timeRange = (start == null && end == null) ? null : { start, end };
}

// automation –––––––––––––––––––––––––––––––––––––––––––––––––––––––

export function addAutoPoint(instanceId, paramKey, tick, value) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (!node) return;
    if (!node.automation[paramKey]) node.automation[paramKey] = [];
    const lane = node.automation[paramKey].filter(p => p.tick !== tick);
    lane.push({ tick, value });
    lane.sort((a, b) => a.tick - b.tick);
    node.automation[paramKey] = lane;
}

export function removeAutoPoint(instanceId, paramKey, tick) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    const lane = node?.automation?.[paramKey];
    if (!lane) return;
    node.automation[paramKey] = lane.filter(p => p.tick !== tick);
}

// wire mutators ––––––––––––––––––––––––––––––––––––––––––––––––––––

export function addWire(fromId, fromPort, toId, toPort) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const wires = currentWires();
    replaceContents(wires, wires.filter(w => !(w.toId === toId && w.toPort === toPort)));
    const wire = { id: makeId('wire'), fromId, fromPort, toId, toPort };
    wires.push(wire);
    // Same fix as addNode -- return the live, proxied reference.
    return wires.find(w => w.id === wire.id);
}

export function removeWire(wireId) {
    pushKineticUndo();
    invalidateBakesAlongPath();
    const wires = currentWires();
    replaceContents(wires, wires.filter(w => w.id !== wireId));
    if (kinetic.selectedWireId === wireId) kinetic.selectedWireId = null;
}

export function selectWire(wireId) {
    kinetic.selectedWireId = wireId;
    kinetic.selectedInstanceId = null;
}

// device mutators (unaffected by graph nesting) ––––––––––––––––––––

export function addDevice(overrides = {}) {
    pushKineticUndo();
    ++__noCounter;
    const device = createDevice(overrides);
    kinetic.devices.push(device);
    // Same fix as addNode/addWire -- return the live, proxied reference.
    return kinetic.devices.find(d => d.id === device.id);
}

export function deviceLabel() {
    return;
}

export function removeDevice(deviceId) {
    pushKineticUndo();
    const wasPrimary = kinetic.devices.find(d => d.id === deviceId)?.isPrimary;
    disconnectDeviceOutput(deviceId).catch(() => {});
    kinetic.devices = kinetic.devices.filter(d => d.id !== deviceId);
    --__noCounter;
    if (wasPrimary && kinetic.devices.length && !kinetic.devices.some(d => d.isPrimary)) {
        kinetic.devices[0].isPrimary = true;
    }
}


export function setPrimaryDevice(deviceId) {
    pushKineticUndo();
    for (const d of kinetic.devices) d.isPrimary = (d.id === deviceId);
}

export function updateDevice(deviceId, patch) {
    const device = kinetic.devices.find(d => d.id === deviceId);
    if (!device) return;
    Object.assign(device, patch);
    markKineticDirty();
}

// live MIDI push connection lifecycle ––––––––––––––––––––––––––––––
// wrapper around the kinetic_midi_* Tauri commands (lib.rs), keyed by
// device.id. connection lifetime is tied to the stage modal's own
// port-select UI, not to addDevice/removeDevice (a device can exist with
// outputPort:null (no live push) indefinitely).

export async function connectDeviceOutput(deviceId, portName) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { pushClearFrame } = await import('../lib/aerolux/kinetic/livePush.js');
    await invoke('kinetic_live_connect', { key: deviceId, portName });
    updateDevice(deviceId, { outputPort: portName });

    // force the physical unit to a known-dark state before live push starts
    // driving it, otherwise it can inherit pads left stuck lit by a
    // previous session/tool
    const device = kinetic.devices.find(d => d.id === deviceId);
    await pushClearFrame(deviceId, device?.logoOrMode ?? 'logo');
}

export async function disconnectDeviceOutput(deviceId) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { pushClearFrame } = await import('../lib/aerolux/kinetic/livePush.js');
    const device = kinetic.devices.find(d => d.id === deviceId);

    // leave the physical unit dark rather than stuck on whatever it last
    // displayed, since nothing will be pushing to it anymore. push is
    // fire-and-forget on the Rust side (a mutex set + notify), so give its
    // dedicated thread a brief moment to actually wake and write it out
    // before tearing the connection down underneath it.
    await pushClearFrame(deviceId, device?.logoOrMode ?? 'logo');
    await new Promise(r => setTimeout(r, 50));

    await invoke('kinetic_live_disconnect', { key: deviceId });
    updateDevice(deviceId, { outputPort: null });
}

// transport ––––––––––––––––––––––––––––––––––––––––––––––––––––––––

// real ticks-per-second for the current bpm/timeDiv (standard MIDI PPQ conversion)
export function transportTicksPerSecond() {
    return (kinetic.transport.timeDiv * kinetic.transport.bpm) / 60;
}

export function play()  { kinetic.transport.playing = true; }
export function pause() { kinetic.transport.playing = false; }

// stops playback and rewinds to tick 0
export function stopAndRewind() {
    kinetic.transport.playing = false;
    kinetic.transport.playheadTick = 0;
}

// scrubs directly to a tick, clamped to [0, totalDuration]
export function seekTo(tick) {
    kinetic.transport.playheadTick = Math.max(0, Math.min(kinetic.transport.totalDuration, tick));
}

// nudges the playhead by a relative number of ticks (e.g. wind forward/back buttons)
export function nudgePlayhead(deltaTicks) {
    seekTo(kinetic.transport.playheadTick + deltaTicks);
}

export function setTotalDuration(ticks) {
    kinetic.transport.totalDuration = Math.max(16, Math.round(ticks));
    if (kinetic.transport.playheadTick > kinetic.transport.totalDuration) {
        kinetic.transport.playheadTick = kinetic.transport.totalDuration;
    }
    markKineticDirty();
}

export function setBpm(bpm)         { kinetic.transport.bpm = Math.max(1, bpm); markKineticDirty(); }
export function setTimeDiv(timeDiv) { kinetic.transport.timeDiv = Math.max(1, Math.round(timeDiv)); markKineticDirty(); }
export function setLoop(enabled)    { kinetic.transport.loop = !!enabled; markKineticDirty(); }

/**
    advances the playhead by a real-time delta (seconds), converted through
    the current bpm/timeDiv. no-ops while paused. when `transport.loop` is
    off (the default), stops at the end of the authoring window rather than
    looping. When on, wraps back to the start, carrying over any overshoot
    so looping stays smooth even at a high playback rate relative to a short
    window, rather than snapping to exactly tick 0 every time.

@param {number} deltaSeconds
*/
export function advancePlayhead(deltaSeconds) {
    if (!kinetic.transport.playing) return;
    const next = kinetic.transport.playheadTick + deltaSeconds * transportTicksPerSecond();
    if (next >= kinetic.transport.totalDuration) {
        if (kinetic.transport.loop && kinetic.transport.totalDuration > 0) {
            const overshoot = next - kinetic.transport.totalDuration;
            kinetic.transport.playheadTick = overshoot % kinetic.transport.totalDuration;
        } else {
            kinetic.transport.playheadTick = kinetic.transport.totalDuration;
            kinetic.transport.playing = false;
        }
    } else {
        kinetic.transport.playheadTick = next;
    }
}

const selNode = $derived(
    currentInstances().find(n => n.instanceId === kinetic.selectedInstanceId) ?? null
);
const selWire = $derived(
    currentWires().find(w => w.id === kinetic.selectedWireId) ?? null
);
const primaryDevice = $derived(
    kinetic.devices.find(d => d.isPrimary) ?? kinetic.devices[0] ?? null
);

export function selectedNode()     { return selNode; }
export function selectedWire()     { return selWire; }
export function getPrimaryDevice() { return primaryDevice; }

// bake orchestration –––––––––––––––––––––––––––––––––––––––––––––––

/**
    searches the whole nested tree (root plus every subgraph, arbitrary
    depth) for an instance by id, regardless of what's currently open.
    baking/un-baking a composite should work even if the user is not 
    currently navigated into it (e.g. baking from a top-level view of a 
    composite whose insides the user has never opened).

@param {string} instanceId
@param {Array} [instances]
@returns {Object|null}
*/
function findInstanceAnywhere(instanceId, instances = kinetic.rootInstances) {
    for (const n of instances) {
        if (n.instanceId === instanceId) return n;
        if (n.subgraph) {
            const found = findInstanceAnywhere(instanceId, n.subgraph.nodeInstances);
            if (found) return found;
        }
    }
    return null;
}

/**
    (re)computes and stores the bake cache for an existing composite
    instance; e.g. one grouped earlier whose cache was since invalidated by
    an edit (see invalidateBakesAlongPath), or one being baked for the first
    time via bakeSelection below.

@param {string} instanceId
@param {Object} [engineContext]  passed through to the subgraph compile (palette, devices, etc.)
@param {Object} [bakeOpts]  totalDuration/tickStep/resolution/ticksPerSecond
@returns {{ok:true, composite:Object} | {ok:false, reason:string}}
*/
export function rebakeComposite(instanceId, engineContext = {}, bakeOpts = {}) {
    const instance = findInstanceAnywhere(instanceId);
    if (!instance || instance.nodeId !== 'composite') {
        return { ok: false, reason: 'Not a composite instance.' };
    }
    instance.bakedCache = precomputeBakeCache(instance, resolveField, engineContext, bakeOpts);
    instance.baked = true;
    return { ok: true, composite: instance };
}

// clears a composite's bake cache without deleting the composite itself
export function unbakeComposite(instanceId) {
    const instance = findInstanceAnywhere(instanceId);
    if (!instance) return;
    instance.baked = false;
    instance.bakedCache = null;
}

/**
    the "Bake" button's full action: group the given selection into a
    composite then immediately precompute and cache its output. grouping
    failures surface identically to calling groupSelectionIntoComposite
    directly; nothing gets baked if grouping itself was refused.

@param {string[]} instanceIds
@param {string} [label]
@param {Object} [engineContext]
@param {Object} [bakeOpts]
@returns {{ok:true, composite:Object} | {ok:false, reason:string}}
*/
export function bakeSelection(instanceIds, label = 'Composite', engineContext = {}, bakeOpts = {}) {
    const grouped = groupSelectionIntoComposite(instanceIds, label);
    if (!grouped.ok) return grouped;
    return rebakeComposite(grouped.composite.instanceId, engineContext, bakeOpts);
}