// src/lib/aerolux/audio/sfx/limiter.js
//
//  1. concurrency:         per-sound-id instance caps to prevent
//                          flooding/overfiring of sfx
//  2. priority ducking:    an important sound temporarily
//                          attenuates whatever lower-priority sounds 
//                          are already playing, via gain automation 
//                          on each instance's own node


const activeByDefId = new Map(); // defId -> Set<Instance>
const allActive = new Set();     // every live instance, for ducking sweeps

// a new sound only ducks instances at least this much lower in priority
const DUCK_PRIORITY_GAP = 25;
const DUCK_FACTOR = 0.5;
const DUCK_DURATION = 0.25; // seconds the attenuation holds before restoring

export function registerActive(instance) {
    allActive.add(instance);
    if (!activeByDefId.has(instance.defId)) activeByDefId.set(instance.defId, new Set());
    activeByDefId.get(instance.defId).add(instance);
}

export function unregisterActive(instance) {
    allActive.delete(instance);
    activeByDefId.get(instance.defId)?.delete(instance);
}

export function countActive(defId) {
    return activeByDefId.get(defId)?.size ?? 0;
}

function oldestActive(defId) {
    const set = activeByDefId.get(defId);
    if (!set?.size) return null;
    let oldest = null;
    for (const inst of set) {
        if (!oldest || inst.startedAt < oldest.startedAt) oldest = inst;
    }
    return oldest;
}

/**
@param {import('./definitions.js').SoundDef} def
@returns {{allow: boolean, evict?: object}}
*/
export function checkConcurrency(def) {
    if (countActive(def.id) < def.maxInstances) return { allow: true };

    switch (def.onLimitReached) {
        case 'replaceOldest':
            return { allow: true, evict: oldestActive(def.id) };
        case 'attenuate':
            // if allowed past the cap, it plays at a lower volume
            // but it is rare because it has to be specifically configured
            // to use this (default to normal behaviour unless essential)
            return { allow: true };
        case 'reject':
        default:
            return { allow: false };
    }
}

/**
    ducks every currently-active instance whose priority is meaningfully
    lower than 'priority'

@param {number} priority
*/
export function duckLowerPriority(priority) {
    for (const inst of allActive) {
        if (priority - inst.priority >= DUCK_PRIORITY_GAP) {
            inst.duck(DUCK_FACTOR, DUCK_DURATION);
        }
    }
}