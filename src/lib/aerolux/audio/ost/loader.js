// src/lib/aerolux/audio/ost/loader.js
//
// loader for the osts
// keeps only the current and next tracks' decoded buffer and 
// removes anything that isnt needed

import { loadAudioBuffer } from '../assets/loader.js';
import { evictBuffer } from '../assets/cache.js';

const seenSources = new Set();

/**
@param {AudioContext} ctx
@param {import('./packs.js').OstTrackDef} track
@returns {Promise<AudioBuffer>}
*/
export function loadTrackBuffer(ctx, track) {
    seenSources.add(track.source);
    return loadAudioBuffer(ctx, track.source);
}

/**
    evicts a previously-loaded ost

@param {Set<string>} keep
*/
export function evictExcept(keep) {
    for (const source of seenSources) {
        if (!keep.has(source)) {
            evictBuffer(source);
            seenSources.delete(source);
        }
    }
}