// src/lib/aerolux/audio/buses.js
//
// this is a persistent GainNode tree
// every bus is two cascaded GainNodes:
//
// [things playing on this bus] -> volumeGain -> attenuationGain -> parent
//
// volumeGain is where the user's volume setting lives
// attenuationGain is a temporary multiplier

/**
@typedef {{ id: string, gain?: number, children?: BusSpec[] }} BusSpec
*/

// default bus tree: master -> {OST, SFX, notifications}
export const DEFAULT_BUS_SPEC = Object.freeze({
    id: 'master',
    children: [
        { id: 'ost' },
        { id: 'sfx' },
        { id: 'notifications' },
    ],
});

/**
@typedef {{
    id: string,
    volumeGain: GainNode,
    attenuationGain: GainNode,
    input: GainNode,   // alias for volumeGain (connect sources here)
    parentId: string|null,
}} BusHandle
*/

/**
    this is the bus tree that is built against a live AudioContext
    it returns a Map<busId, BusHandle' for O(1) lookup by id

@param {AudioContext} ctx
@param {BusSpec} [spec]
@returns {Map<string, BusHandle>}
*/
export function buildBusTree(ctx, spec = DEFAULT_BUS_SPEC) {
    const registry = new Map();
    build(ctx, spec, null, registry);
    return registry;
}

function build(ctx, spec, parentHandle, registry) {
    const volumeGain = ctx.createGain();
    const attenuationGain = ctx.createGain();
    volumeGain.gain.value = spec.gain ?? 1;
    attenuationGain.gain.value = 1; // no attenuation by default

    volumeGain.connect(attenuationGain);
    attenuationGain.connect(parentHandle ? parentHandle.volumeGain : ctx.destination);

    /** @type {BusHandle} */
    const handle = {
        id: spec.id,
        volumeGain,
        attenuationGain,
        input: volumeGain,
        parentId: parentHandle?.id ?? null,
    };
    registry.set(spec.id, handle);

    for (const child of spec.children ?? []) {
        build(ctx, child, handle, registry);
    }
}

/**
    this disconnects every node in a bus registry and is used when the 
    AudioContext has to be recreated

@param {Map<string, BusHandle>} registry
*/
export function teardownBusTree(registry) {
    for (const handle of registry.values()) {
        try {
            handle.volumeGain.disconnect();
            handle.attenuationGain.disconnect();
        } catch {
            // already disconnected
        }
    }
    registry.clear();
}