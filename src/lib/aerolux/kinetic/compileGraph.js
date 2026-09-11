// src/lib/aerolux/kinetic/compileGraph.js
// ============================================================================
// KINETIC ENGINE: GRAPH COMPILER
//
// walks nodeInstances[] + wires[] and builds fields. intentionally decoupled
// from any node registry; the caller supplies `resolveField`, so this module
// has zero knowledge of what nodes exist. 
//
// multi-device output: a graph can contain multiple 'output' nodes, 
// each carrying a `target` param:
//   - 'canvas'   — sampled later via each device's position/rotation on the
//                  Stage (resolved outside this module, at sample time)
//   - <deviceId> — bypasses canvas placement, that device samples this field
//                  directly in its own local coordinates
// compileGraph returns one field per target actually present in the graph,
// plus the full set of stateful fields reachable from *some* output, so the
// caller's tick loop knows exactly what to advance() each frame. nothing
// unreachable gets simulated for free.
// ============================================================================

import { nullField, gateField } from './field.js';
import { ensureChannelGroups } from './channelSimulation.js';

const OUTPUT_NODE_ID = 'output';

/**
@param {Array<{instanceId, nodeId, enabled, params}>} nodeInstances
@param {Array<{id, fromId, fromPort, toId, toPort}>} wires
@param {*} context
@param {(instance:Object, fieldA:Field|null, fieldB:Field|null, context:*) => Field|null} resolveField
@returns {{ outputs: Record<string, Field>, statefulFields: Field[] }}
*/
export function compileGraph(nodeInstances, wires, context, resolveField) {
    ensureChannelGroups(context);
    const instances = new Map(nodeInstances.map(n => [n.instanceId, n]));

    const incoming = new Map(); // toId -> Wire[]
    for (const wire of wires) {
        if (!instances.has(wire.fromId) || !instances.has(wire.toId)) continue;
        if (!incoming.has(wire.toId)) incoming.set(wire.toId, []);
        incoming.get(wire.toId).push(wire);
    }

    const cache = new Map();     // instanceId -> Field | null, memoises shared upstream nodes
    const visiting = new Set();  // cycle guard
    const statefulFields = new Set();

    function build(instanceId) {
        if (cache.has(instanceId)) return cache.get(instanceId);

        const instance = instances.get(instanceId);
        if (!instance || instance.enabled === false) {
            cache.set(instanceId, null);
            return null;
        }

        if (visiting.has(instanceId)) {
            // cycle; treat as unlit rather than recursing forever. flagging
            // the offending wire to the user is a graph-editor UI concern,
            // not this engine's; the engine just refuses to hang.
            return null;
        }
        visiting.add(instanceId);

        const inWires = incoming.get(instanceId) ?? [];
        const wireA = inWires.find(w => w.toPort !== 'inputB');
        const wireB = inWires.find(w => w.toPort === 'inputB');
        const fieldA = wireA ? build(wireA.fromId) : null;
        const fieldB = wireB ? build(wireB.fromId) : null;

        visiting.delete(instanceId);

        const field = resolveField(instance, fieldA, fieldB, context) ?? null;
        // a node is only active within its own timeRange, if it has
        // one (null/omitted on either end = open on that side; no timeRange
        // at all = always active, gateField no-ops in that case).
        const gated = gateField(field, instance.timeRange?.start ?? null, instance.timeRange?.end ?? null);
        if (gated && gated.kind === 'stateful') statefulFields.add(gated);

        cache.set(instanceId, gated);
        return gated;
    }

    const outputs = {};
    for (const instance of nodeInstances) {
        if (instance.nodeId !== OUTPUT_NODE_ID || instance.enabled === false) continue;

        const target = instance.params?.target ?? 'canvas';
        const inWires = incoming.get(instance.instanceId) ?? [];
        const upstream = inWires.find(w => w.toPort !== 'inputB');
        let field = upstream ? build(upstream.fromId) : null;

        // the output node itself bypasses build() entirely (see above), so
        // its own timeRange would otherwise never get applied; gate it
        // here explicitly. any stateful field this wraps is already tracked
        // in `statefulFields` from when build() produced it above; this
        // outer gate only narrows *sampling*, not advancement, so nothing
        // further needs registering here.
        field = gateField(field, instance.timeRange?.start ?? null, instance.timeRange?.end ?? null);

        outputs[target] = field ?? nullField;
    }

    return { outputs, statefulFields: [...statefulFields] };
}

/**
    returns the set of instanceIds actually reachable from an output node that
    targets the given device; either directly (`target === deviceId`) or via
    a canvas-wide output (`target === 'canvas'`, which reaches every device on
    the stage). powers the graph editor's non-destructive device-filter view: 
    dims/hides subtrees that don't affect the selected device, 
    without forking the underlying graph data at all.

@param {Array} nodeInstances
@param {Array} wires
@param {string} deviceId
@returns {Set<string>} instanceIds reachable for this device
*/
export function reachableInstanceIds(nodeInstances, wires, deviceId) {
    const instances = new Map(nodeInstances.map(n => [n.instanceId, n]));

    const incoming = new Map();
    for (const wire of wires) {
        if (!instances.has(wire.fromId) || !instances.has(wire.toId)) continue;
        if (!incoming.has(wire.toId)) incoming.set(wire.toId, []);
        incoming.get(wire.toId).push(wire);
    }

    const reachable = new Set();
    function walkBack(instanceId) {
        if (reachable.has(instanceId)) return;
        reachable.add(instanceId);
        for (const wire of incoming.get(instanceId) ?? []) walkBack(wire.fromId);
    }

    for (const instance of nodeInstances) {
        if (instance.nodeId !== OUTPUT_NODE_ID) continue;
        const target = instance.params?.target ?? 'canvas';
        if (target === 'canvas' || target === deviceId) walkBack(instance.instanceId);
    }

    return reachable;
}