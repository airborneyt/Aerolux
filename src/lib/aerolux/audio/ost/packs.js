// src/lib/aerolux/audio/ost/packs.js
//
// track and pack schema and registries
// there are both individual track/audio file registries and pack
// registries
//
//   import { defineTracks, definePack } from '$lib/aerolux/audio/ost/packs.js';
//
//   defineTracks([
//     { id: 'track_00', source: '/ost/00.mp3' },
//     { id: 'track_01', source: '/ost/01.mp3' },
//     // ... 24 total
//   ]);
//
//   definePack({
//     id: 'default',
//     name: 'Aerolux Default',
//     schedule: ['track_00', 'track_01', /* ...24 entries, index = hour */],
//   });

import { createRegistry } from '../assets/registry.js';

const trackRegistry = createRegistry('ost-track');
const packRegistry = createRegistry('ost-pack');

/** @typedef {{ id: string, source: string }} OstTrackDef */

/** @param {OstTrackDef} def */
export function defineTrack(def) {
    if (!def?.id || !def?.source) {
        console.error('[audio] defineTrack requires { id, source }. Skipping...', def);
        return null;
    }
    return trackRegistry.define(def.id, { ...def });
}

/** @param {OstTrackDef[]} defs */
export function defineTracks(defs) {
    return defs.map(defineTrack);
}

export function getTrack(id) { return trackRegistry.get(id); }

/** @typedef {{ id: string, name?: string, schedule: string[] }} OstPack */

/**
@param {OstPack} pack  `schedule` must have exactly 24 entries, index = hour
*/
export function definePack(pack) {
    if (!pack?.id || !Array.isArray(pack.schedule) || pack.schedule.length !== 24) {
        console.error('[audio] definePack requires { id, schedule: [24 track ids] }. Skipping...', pack);
        return null;
    }
    return packRegistry.define(pack.id, { name: pack.id, ...pack });
}

export function getPack(id) { return packRegistry.get(id); }
export function listPacks() { return packRegistry.list(); }