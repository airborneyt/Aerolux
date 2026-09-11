// src/lib/aerolux/audio/sfx/definitions.js
//
// this has the schema + registry mechanics for sound defintions
//
// usage:
//
//   import { defineSounds } from '$lib/aerolux/audio/sfx/definitions.js';
//   defineSounds([
//     { id: 'node_snap', source: '/sounds/node-snap.wav', priority: 40 },
//     { id: 'export_done', source: '/sounds/export-done.wav', priority: 80 },
//   ]);

import { createRegistry } from '../assets/registry.js';

const registry = createRegistry('sound');

/** @type {Required<Omit<SoundDef, 'id'|'source'>>} */
const DEFAULTS = {
    bus: 'sfx',
    baseVolume: 1,
    priority: 50,
    maxInstances: 4,
    onLimitReached: 'reject', // 'reject' | 'replaceOldest' | 'attenuate'
    spatial: false,
    loop: false,
    cooldown: 0,    // ms; 0 = no cooldown guard
    preload: true,
};

/**
@typedef {{
    id: string,
    source: string,
    bus?: 'sfx'|'ost'|'notifications'|'master',
    baseVolume?: number,
    priority?: number,
    maxInstances?: number,
    onLimitReached?: 'reject'|'replaceOldest'|'attenuate',
    spatial?: boolean,
    loop?: boolean,
    cooldown?: number,
    preload?: boolean,
}} SoundDef
*/

/**
@param {SoundDef} def
@returns {SoundDef|null} the merged defaulted definition 
*/
export function defineSound(def) {
    if (!def?.id || !def?.source) {
        console.error('[audio] defineSound requires at least { id, source }. Skipping', def);
        return null;
    }
    return registry.define(def.id, { ...DEFAULTS, ...def });
}

/** @param {SoundDef[]} defs */
export function defineSounds(defs) {
    return defs.map(defineSound);
}

export function getSoundDef(id) { return registry.get(id); }
export function listSoundDefs() { return registry.list(); }
export function hasSoundDef(id) { return registry.has(id); }