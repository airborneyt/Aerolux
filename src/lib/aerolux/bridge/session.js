// src/lib/aerolux/bridge/session.js
//
// aerolux-sde link registry
// maps aerolux-side effects (instanceId) to bridge-side clips (clipId)

const instanceToClip = new Map();
const clipToInstance = new Map();

export function registerInstance(instanceId, clipId) {
    // unlink an instance/clip thats already linked elsewhere
    unregisterInstance(instanceId);
    unregisterClip(clipId);
    instanceToClip.set(instanceId, clipId);
    clipToInstance.set(clipId, instanceId);
}

export function unregisterInstance(instanceId) {
    const clipId = instanceToClip.get(instanceId);
    if (clipId !== undefined) clipToInstance.delete(clipId);
    instanceToClip.delete(instanceId);
}

export function unregisterClip(clipId) {
    const instanceId = clipToInstance.get(clipId);
    if (instanceId !== undefined) instanceToClip.delete(instanceId);
    clipToInstance.delete(clipId);
}

/** @returns {string|null} the linked clipId, or null if this instance isnt linked. */
export function getClipForInstance(instanceId) {
    return instanceToClip.get(instanceId) ?? null;
}

/** @returns {string|null} the linked instanceId or null if this clip isnt linked. */
export function getInstanceForClip(clipId) {
    return clipToInstance.get(clipId) ?? null;
}

export function isLinked(instanceId) {
    return instanceToClip.has(instanceId);
}

// future BridgePanel.svelte compatibility
export function listLinks() {
    return [...instanceToClip.entries()].map(([instanceId, clipId]) => ({ instanceId, clipId }));
}

// wipe all links
export function clearAll() {
    instanceToClip.clear();
    clipToInstance.clear();
}