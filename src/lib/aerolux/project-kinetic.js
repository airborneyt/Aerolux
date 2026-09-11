// src/lib/aerolux/project-kinetic.js
// ============================================================================
// KINETIC ENGINE: PROJECT SERIALISATION
//
// scope: rootInstances, rootWires, devices, and the settings half of
// transport (bpm/timeDiv/totalDuration/loop)
// doesnt capture playing/playheadTick and undo/redo history
//
// bake caches are stripped before serialising
// a loaded project always starts unbaked; rebaking does not have a huge impact
// on performance
// ============================================================================

function stripBakesForSave(instances) {
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
            ? { nodeInstances: stripBakesForSave(n.subgraph.nodeInstances), wires: n.subgraph.wires.map(w => ({ ...w })) }
            : null,
    }));
}

/**
@param {object} kinetic  the live $state store object
@returns {object}  plain, JSON-safe snapshot ready to embed in a .alx file
*/
export function serializeKineticState(kinetic) {
    return {
        rootInstances: stripBakesForSave(kinetic.rootInstances),
        rootWires: kinetic.rootWires.map(w => ({ ...w })),
        devices: kinetic.devices.map(d => ({
            ...d,
            position: { ...d.position },
            // live-push connection is session state, not document content. so its not saved
            outputPort: null,
        })),
        transport: {
            bpm: kinetic.transport.bpm,
            timeDiv: kinetic.transport.timeDiv,
            totalDuration: kinetic.transport.totalDuration,
            loop: kinetic.transport.loop,
        },
    };
}

/**
@param {object} state  as produced by serializeKineticState (or loaded from disk)
@returns {{rootInstances:Array, rootWires:Array, devices:Array|null, transport:object}}
devices is null when the file had no valid devices at all
*/
export function deserializeKineticState(state) {
    return {
        rootInstances: Array.isArray(state.rootInstances) ? state.rootInstances : [],
        rootWires: Array.isArray(state.rootWires) ? state.rootWires : [],
        devices: Array.isArray(state.devices) && state.devices.length
            ? state.devices.map(d => ({ ...d, position: { ...(d.position ?? { x: 0, y: 0 }) }, outputPort: null }))
            : null,
        transport: {
            bpm: typeof state.transport?.bpm === 'number' ? state.transport.bpm : 120,
            timeDiv: typeof state.transport?.timeDiv === 'number' ? state.transport.timeDiv : 96,
            totalDuration: typeof state.transport?.totalDuration === 'number' ? state.transport.totalDuration : 768,
            loop: !!state.transport?.loop,
        },
    };
}

/**
    shape check. pre-flight guard before deserialisation

@param {object} state
@returns {boolean}
*/
export function isValidKineticState(state) {
    return !!state
        && Array.isArray(state.rootInstances)
        && Array.isArray(state.rootWires)
        && Array.isArray(state.devices);
}