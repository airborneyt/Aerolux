// src/stores/kinetic.svelte.js
// ============================================================================
// KINETIC 2.0 — STORE
// Phase 0 shape + Phase 5 additions (timeRange/automation), nested graph
// navigation for composite clips, grouping (Step 2) and bake caching
// (Step 3) of the UI Overhaul, plus the post-Step-4 UI/UX audit follow-ups:
// node/composite duplication, ungrouping, and transport looping.
// ============================================================================

import { resolveField } from '../lib/aerolux/kinetic/nodeRegistry.js';
import { bakeComposite as precomputeBakeCache } from '../lib/aerolux/kinetic/bake.js';

// ── ID helpers ───────────────────────────────────────────────────────────

let __idCounter = 0;
function makeId(prefix) {
    // crypto.randomUUID() may be unavailable in a headless compileModule
    // harness (no browser/node crypto global guaranteed at module-eval
    // time in every context) — fall back to a monotonic counter so ids
    // stay unique without depending on that global being present.
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${++__idCounter}`;
}

let __noCounter = 1;

/** Replaces an array's contents in place, so callers holding a reference to
 * it (e.g. from currentWires()) see the change -- a plain `arr = arr.filter(...)`
 * reassignment would only rebind the LOCAL variable and silently fail to
 * update anything beyond the root level, since nested subgraph arrays are
 * reached via object property access, not re-exported bindings. */
function replaceContents(arr, newContents) {
    arr.length = 0;
    arr.push(...newContents);
}

// ── Device factory ───────────────────────────────────────────────────────

function createDevice(overrides = {}) {
    return {
        id:         makeId('device'),
        instanceNo: 'LP ' + __noCounter,
        model:      'Launchpad',
        midiIn:     null,
        midiOut:    null,
        position:   { x: 0, y: 0 },
        rotation:   0,
        isPrimary:  false,
        enabled:    true,
        muted:      false,
        brightness: 1.0,
        ...overrides,
    };
}

// ── Store ────────────────────────────────────────────────────────────────

export const kinetic = $state({
    rootInstances: [],   // NodeInstance[]
    rootWires:     [],   // Wire[]
    graphPath: [],
    selectedInstanceId: null,
    selectedWireId:     null,
    devices: [createDevice({ isPrimary: true })],
    loadedClips: {},

    // Playback transport (UI Overhaul Step 4). `loop` added in the
    // post-Step-4 UI/UX audit pass -- advancePlayhead previously always
    // stopped dead at totalDuration ("simplest v1 behaviour... a
    // reasonable follow-up, not attempted", per that section's own
    // comment). Still stops-at-end by default; loop is strictly opt-in.
    //
    // NOTE, flagged rather than silently left inconsistent: nodeRegistry.js
    // still uses its own PLACEHOLDER_TICKS_PER_SECOND = 96 constant
    // internally (Pulse, Strobe -- anything converting ticks to real
    // seconds inside a node's own sample()). This transport's tick rate
    // (timeDiv * bpm / 60, the standard MIDI PPQ conversion) is used for
    // the PREVIEW LOOP's own real-time-to-tick advancement (see
    // KineticPage.svelte's loop()). Making individual nodes read a real
    // tick rate instead of their own hardcoded placeholder remains a
    // separate, open follow-up (see the master plan's Open Items list).
    transport: {
        playing:       false,
        playheadTick:  0,
        bpm:           120,
        timeDiv:       96,
        totalDuration: 960, // matches bake.js's/KineticTimeline's own prior default
        loop:          false,
    },
});

// ── Graph resolution ─────────────────────────────────────────────────────

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

// ── Bake cache invalidation (Step 3) ──────────────────────────────────────
// "The cache invalidates whenever that composite's internal subgraph is
// edited while open (destructive-in-effect at the composite boundary,
// non-destructive to anything outside it)." Walks graphPath root-first,
// clearing the bake of every ANCESTOR composite that's currently baked --
// not just the deepest one -- since an ancestor's own bake would have
// captured whatever the edited composite used to output, and is therefore
// equally stale now. Never touches siblings or anything outside the path.
// Called at the top of every mutator that changes something a Field
// actually depends on (params, wires, enabled state, time ranges,
// automation) -- deliberately NOT called from moveNode/renameNode, which
// are purely cosmetic and never change sampled output.
function invalidateBakesAlongPath() {
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

// ── Navigation ───────────────────────────────────────────────────────────

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

// ── Node instance mutators ───────────────────────────────────────────────

export function addNode(nodeId, params = {}, position) {
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
        // Bake caching (Step 3) -- only meaningful for composites, harmless
        // to carry (as false/null) on every node for a uniform shape.
        baked:      false,
        bakedCache: null,
    };
    instances.push(instance);
    kinetic.selectedInstanceId = instance.instanceId;
    // Svelte 5 wraps a plain object in a reactive proxy the moment it's
    // inserted into $state -- `instance` above is the PRE-proxy reference,
    // not object-identical to what actually lives in the reactive tree.
    // Re-fetch the live instance before returning, so every caller gets a
    // reference that actually participates in reactivity.
    return instances.find(n => n.instanceId === instance.instanceId);
}

export function removeNode(instanceId) {
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
    if (node) node.position = { x, y };
}

export function setParam(instanceId, paramKey, value) {
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (node) node.params[paramKey] = value;
}

export function toggleNode(instanceId) {
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (node) node.enabled = !node.enabled;
}

export function renameNode(instanceId, label) {
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (node) node.label = label || null;
}

export function selectNode(instanceId) {
    kinetic.selectedInstanceId = instanceId;
    kinetic.selectedWireId = null;
}

// ── Duplication (post-Step-4 UI/UX audit) ─────────────────────────────────
// Deep-clones a node instance -- and, for a composite, its entire nested
// subgraph, with freshly-generated ids at every level so the clone never
// shares an instanceId with the original anywhere in the tree -- and
// inserts it into the CURRENT graph level, offset slightly so it doesn't
// sit exactly on top of the original. A duplicate never carries over the
// original's wires; it starts disconnected, same as a freshly-added node.

function cloneSubgraphWithFreshIds(subgraph) {
    if (!subgraph) return null;
    const idMap = new Map();
    const nodeInstances = subgraph.nodeInstances.map(n => {
        const newId = makeId('node');
        idMap.set(n.instanceId, newId);
        return { ...n, instanceId: newId };
    });
    // Recurse into any nested composites, now that every id at THIS level
    // is known (nested subgraphs reference only their own children, never
    // sibling ids at this level, so order doesn't matter here).
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
 * Duplicates a node instance (or a composite and its whole nested subgraph)
 * into the currently-open graph level. Returns the new instance, or null if
 * the source instance doesn't exist at this level.
 * @param {string} instanceId
 * @returns {Object|null}
 */
export function duplicateNode(instanceId) {
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
        // A composite's bake cache is captured under its OWN instanceId's
        // subgraph reference -- never share it with the clone, even though
        // the cloned subgraph is structurally identical at the moment of
        // cloning. The clone starts unbaked, exactly like a freshly-grouped
        // composite would.
        baked: false,
        bakedCache: null,
    };
    instances.push(clone);
    kinetic.selectedInstanceId = clone.instanceId;
    return instances.find(n => n.instanceId === clone.instanceId);
}

// ── Grouping (UI Overhaul Step 2) ─────────────────────────────────────────
// Pure graph transformation over whichever level is CURRENTLY open
// (currentInstances()/currentWires()). Design + rationale: master plan's
// "Composite clip architecture" section. v1 scope, enforced by refusing
// rather than guessing: at most 2 distinct external entry points (matching
// every other node's input/inputB convention), exactly one distinct
// external exit point.

function externalKey(id, port) { return `${id}:${port}`; }

function averagePosition(nodes) {
    if (!nodes.length) return { x: 80, y: 80 };
    const x = nodes.reduce((sum, n) => sum + (n.position?.x ?? 0), 0) / nodes.length;
    const y = nodes.reduce((sum, n) => sum + (n.position?.y ?? 0), 0) / nodes.length;
    return { x, y };
}

/**
 * Groups the given instanceIds (must all live at the currently-open graph
 * level) into a single new composite instance. Returns
 * `{ ok: true, composite }` on success, or `{ ok: false, reason }` if the
 * selection doesn't fit v1's boundary-shape constraints -- callers should
 * surface `reason` to the user rather than silently doing nothing.
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

    // Distinct external sources feeding IN -- dedupe: one external source
    // wired to several selected nodes is still one composite input port.
    const entrySources = [...new Map(
        incomingExternal.map(w => [externalKey(w.fromId, w.fromPort), w])
    ).values()];
    if (entrySources.length > 2) {
        return {
            ok: false,
            reason: `Selection has ${entrySources.length} distinct external inputs; composites support at most 2 (input + inputB). Refusing rather than guessing which two matter.`,
        };
    }

    // Distinct internal sources feeding OUT -- more than one means two
    // independent internal signals would need to leave via a single output
    // port, which isn't representable.
    const exitSources = [...new Map(
        outgoingExternal.map(w => [externalKey(w.fromId, w.fromPort), w])
    ).values()];
    if (exitSources.length > 1) {
        return {
            ok: false,
            reason: `Selection has ${exitSources.length} distinct internal nodes feeding outside the selection; composites support exactly one exit point. Refusing rather than guessing which one wins.`,
        };
    }

    // ── Build the subgraph ──────────────────────────────────────────────
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

    // Reroute each incoming-external wire: (external -> selected) becomes
    // (boundary node -> selected), inside the subgraph.
    for (const w of incomingExternal) {
        const key = externalKey(w.fromId, w.fromPort);
        const boundary = boundaryNodes[entrySources.findIndex(e => externalKey(e.fromId, e.fromPort) === key)];
        subWires.push({ id: makeId('wire'), fromId: boundary.instanceId, fromPort: 'output', toId: w.toId, toPort: w.toPort });
    }

    // Internal Output node (target: 'group') -- the subgraph's own
    // designated result. Reuses compileGraph.js's already-generic
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

    // ── Build the composite instance ─────────────────────────────────────
    const composite = {
        instanceId: makeId('node'), nodeId: 'composite',
        enabled: true, params: {}, position: averagePosition(selectedInstances),
        timeRange: null, automation: {},
        label: label || 'Composite',
        subgraph: { nodeInstances: subInstances, wires: subWires },
        baked: false, bakedCache: null,
        // Per-instance port-count override -- composites don't have a fixed
        // hasInput/isMultiInput in NODE_DEFS the way every other node does,
        // since different composite instances expose different numbers of
        // ports depending on what was grouped. Consumers should read
        // `instance.hasInput ?? def.hasInput` (falls back to the registry
        // default for every other node type).
        hasInput: entrySources.length >= 1,
        isMultiInput: entrySources.length >= 2,
    };

    // ── Splice the outer graph ───────────────────────────────────────────
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

// ── Ungroup (post-Step-4 UI/UX audit) ─────────────────────────────────────
// The inverse of groupSelectionIntoComposite: splices a composite's own
// subgraph nodes/wires back into whichever level the composite currently
// lives at, rewires whatever was externally connected to the composite's
// input/inputB/output ports directly to the corresponding internal
// node(s), and removes the composite along with its groupInput/
// groupInputB/target:'group' Output boundary nodes -- those have no
// meaning outside a composite's own subgraph. A baked composite is
// ungrouped exactly the same way; its (now-orphaned) bake cache is simply
// discarded along with the composite instance itself.

export function ungroupComposite(instanceId) {
    invalidateBakesAlongPath();
    const instances = currentInstances();
    const wires = currentWires();

    const composite = instances.find(n => n.instanceId === instanceId);
    if (!composite || composite.nodeId !== 'composite' || !composite.subgraph) {
        return { ok: false, reason: 'Not a composite instance.' };
    }

    const sub = composite.subgraph;
    const boundaryIds = new Set(
        sub.nodeInstances.filter(n => n.nodeId === 'groupInput' || n.nodeId === 'groupInputB').map(n => n.instanceId)
    );
    const groupOutputNode = sub.nodeInstances.find(n => n.nodeId === 'output' && n.params?.target === 'group');

    // What did groupInput/groupInputB feed internally? An external wire
    // that fed the composite's `input`/`inputB` should, post-ungroup, feed
    // those same internal targets directly.
    const boundaryTargets = new Map(); // 'input'|'inputB' -> [{toId,toPort}]
    for (const n of sub.nodeInstances) {
        if (n.nodeId !== 'groupInput' && n.nodeId !== 'groupInputB') continue;
        const port = n.nodeId === 'groupInput' ? 'input' : 'inputB';
        const outs = sub.wires.filter(w => w.fromId === n.instanceId);
        boundaryTargets.set(port, outs.map(w => ({ toId: w.toId, toPort: w.toPort })));
    }
    // What fed the internal group Output? An external wire that consumed
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

    // Splice into the outer graph: drop the composite and its own wires,
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

// ── Time-range ───────────────────────────────────────────────────────────

export function setTimeRange(instanceId, start, end) {
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    if (!node) return;
    node.timeRange = (start == null && end == null) ? null : { start, end };
}

// ── Automation ───────────────────────────────────────────────────────────

export function addAutoPoint(instanceId, paramKey, tick, value) {
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
    invalidateBakesAlongPath();
    const node = currentInstances().find(n => n.instanceId === instanceId);
    const lane = node?.automation?.[paramKey];
    if (!lane) return;
    node.automation[paramKey] = lane.filter(p => p.tick !== tick);
}

// ── Wire mutators ────────────────────────────────────────────────────────

export function addWire(fromId, fromPort, toId, toPort) {
    invalidateBakesAlongPath();
    const wires = currentWires();
    replaceContents(wires, wires.filter(w => !(w.toId === toId && w.toPort === toPort)));
    const wire = { id: makeId('wire'), fromId, fromPort, toId, toPort };
    wires.push(wire);
    // Same fix as addNode -- return the live, proxied reference.
    return wires.find(w => w.id === wire.id);
}

export function removeWire(wireId) {
    invalidateBakesAlongPath();
    const wires = currentWires();
    replaceContents(wires, wires.filter(w => w.id !== wireId));
    if (kinetic.selectedWireId === wireId) kinetic.selectedWireId = null;
}

export function selectWire(wireId) {
    kinetic.selectedWireId = wireId;
    kinetic.selectedInstanceId = null;
}

// ── Device mutators (unaffected by graph nesting) ────────────────────────

export function addDevice(overrides = {}) {
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
    const wasPrimary = kinetic.devices.find(d => d.id === deviceId)?.isPrimary;
    kinetic.devices = kinetic.devices.filter(d => d.id !== deviceId);
    --__noCounter;
    if (wasPrimary && kinetic.devices.length && !kinetic.devices.some(d => d.isPrimary)) {
        kinetic.devices[0].isPrimary = true;
    }
}

export function setPrimaryDevice(deviceId) {
    for (const d of kinetic.devices) d.isPrimary = (d.id === deviceId);
}

export function updateDevice(deviceId, patch) {
    const device = kinetic.devices.find(d => d.id === deviceId);
    if (!device) return;
    Object.assign(device, patch);
}

// ── Transport (UI Overhaul Step 4, + loop from the post-Step-4 audit) ─────

/** Real ticks-per-second for the current bpm/timeDiv (standard MIDI PPQ conversion). */
export function transportTicksPerSecond() {
    return (kinetic.transport.timeDiv * kinetic.transport.bpm) / 60;
}

export function play()  { kinetic.transport.playing = true; }
export function pause() { kinetic.transport.playing = false; }

/** Stops playback and rewinds to tick 0. */
export function stopAndRewind() {
    kinetic.transport.playing = false;
    kinetic.transport.playheadTick = 0;
}

/** Scrubs directly to a tick, clamped to [0, totalDuration]. Works while playing or paused. */
export function seekTo(tick) {
    kinetic.transport.playheadTick = Math.max(0, Math.min(kinetic.transport.totalDuration, tick));
}

/** Nudges the playhead by a relative number of ticks (e.g. wind forward/back buttons). */
export function nudgePlayhead(deltaTicks) {
    seekTo(kinetic.transport.playheadTick + deltaTicks);
}

export function setTotalDuration(ticks) {
    kinetic.transport.totalDuration = Math.max(16, Math.round(ticks));
    if (kinetic.transport.playheadTick > kinetic.transport.totalDuration) {
        kinetic.transport.playheadTick = kinetic.transport.totalDuration;
    }
}

export function setBpm(bpm)         { kinetic.transport.bpm = Math.max(1, bpm); }
export function setTimeDiv(timeDiv) { kinetic.transport.timeDiv = Math.max(1, Math.round(timeDiv)); }
export function setLoop(enabled)    { kinetic.transport.loop = !!enabled; }

/**
 * Advances the playhead by a real-time delta (seconds), converted through
 * the current bpm/timeDiv. No-ops while paused. When `transport.loop` is
 * off (the default), stops at the end of the authoring window rather than
 * looping. When on, wraps back to the start, carrying over any overshoot
 * so looping stays smooth even at a high playback rate relative to a short
 * window, rather than snapping to exactly tick 0 every time.
 * @param {number} deltaSeconds
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

// ── Bake orchestration (UI Overhaul Step 3) ──────────────────────────────

/**
 * Searches the WHOLE nested tree (root plus every subgraph, arbitrary
 * depth) for an instance by id, regardless of what's currently open.
 * Baking/un-baking a composite should work even if you're not currently
 * navigated into it (e.g. baking from a top-level view of a composite
 * whose insides you've never opened).
 * @param {string} instanceId
 * @param {Array} [instances]
 * @returns {Object|null}
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
 * (Re)computes and stores the bake cache for an existing composite
 * instance -- e.g. one grouped earlier whose cache was since invalidated by
 * an edit (see invalidateBakesAlongPath), or one being baked for the first
 * time via bakeSelection below.
 * @param {string} instanceId
 * @param {Object} [engineContext]  passed through to the subgraph compile (palette, devices, etc.)
 * @param {Object} [bakeOpts]  totalDuration/tickStep/resolution/ticksPerSecond -- see bake.js
 * @returns {{ok:true, composite:Object} | {ok:false, reason:string}}
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

/** Clears a composite's bake cache without deleting the composite itself. */
export function unbakeComposite(instanceId) {
    const instance = findInstanceAnywhere(instanceId);
    if (!instance) return;
    instance.baked = false;
    instance.bakedCache = null;
}

/**
 * The "Bake" button's full action: group the given selection into a
 * composite (see groupSelectionIntoComposite for the v1 boundary-shape
 * constraints), then immediately precompute and cache its output. Grouping
 * failures surface identically to calling groupSelectionIntoComposite
 * directly -- nothing gets baked if grouping itself was refused.
 * @param {string[]} instanceIds
 * @param {string} [label]
 * @param {Object} [engineContext]
 * @param {Object} [bakeOpts]
 * @returns {{ok:true, composite:Object} | {ok:false, reason:string}}
 */
export function bakeSelection(instanceIds, label = 'Composite', engineContext = {}, bakeOpts = {}) {
    const grouped = groupSelectionIntoComposite(instanceIds, label);
    if (!grouped.ok) return grouped;
    return rebakeComposite(grouped.composite.instanceId, engineContext, bakeOpts);
}