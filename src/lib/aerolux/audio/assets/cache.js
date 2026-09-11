// src/lib/aerolux/audio/assets/cache.js
//
// decoded audio buffer cache used by anything that loads the audio assets
//
//   bufferPromises:    source -> Promise<AudioBuffer>, so callers asking
//                      for the same not-yet-loaded source in the same tick
//                      share one fetch+decode instead of multiple.
//
//   resolvedBuffers:   source -> AudioBuffer, populated once a promise
//                      settles, so a caller that already knows an asset is
//                      warm can skip the microtask hop entirely and get a 
//                      buffer back synchronously.

const bufferPromises = new Map();
const resolvedBuffers = new Map();

export function getCachedBufferPromise(source) {
    return bufferPromises.get(source) ?? null;
}

/**
    this registers a decode-in-progress promise for 'source' and also
    arranges for the resolved value to land in 'resolvedBuffers' once it 
    settles and for a failed promise to be removed from the cache

@param {string} source
@param {Promise<AudioBuffer>} promise
@returns {Promise<AudioBuffer>}
*/
export function setCachedBufferPromise(source, promise) {
    bufferPromises.set(source, promise);
    promise.then(
        (buffer) => resolvedBuffers.set(source, buffer),
        () => bufferPromises.delete(source),
    );
    return promise;
}

export function getResolvedBuffer(source) {
    return resolvedBuffers.get(source) ?? null;
}

/**
    this evicts a single source from the cache. it is used by the
    ost's loader to keep only the current and next ost track's 
    decoded buffer so the app remains lightweight in both performance
    and memory

@param {string} source
*/
export function evictBuffer(source) {
    bufferPromises.delete(source);
    resolvedBuffers.delete(source);
}

export function clearAssetCache() {
    bufferPromises.clear();
    resolvedBuffers.clear();
}