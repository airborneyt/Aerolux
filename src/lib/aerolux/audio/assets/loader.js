// src/lib/aerolux/audio/assets/loader.js
//
// this is where audio files become AudioBuffers
//
// decode failures are sent to errors.js and can get surfaced

import { AudioError, AudioErrorType } from '../errors.js';
import { getCachedBufferPromise, setCachedBufferPromise, getResolvedBuffer } from './cache.js';

/**
@param {AudioContext} ctx
@param {string} source  URL/path to the audio file
@returns {Promise<AudioBuffer>}
*/
export function loadAudioBuffer(ctx, source) {
    const resolved = getResolvedBuffer(source);
    if (resolved) return Promise.resolve(resolved);

    const inFlight = getCachedBufferPromise(source);
    if (inFlight) return inFlight;

    return setCachedBufferPromise(source, fetchAndDecode(ctx, source));
}

async function fetchAndDecode(ctx, source) {
    let arrayBuffer;
    try {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        arrayBuffer = await res.arrayBuffer();
    } catch (cause) {
        throw new AudioError(
            AudioErrorType.ASSET_LOAD_FAILED,
            `Failed to load audio asset: ${source}`,
            { cause },
        );
    }

    try {
        return await ctx.decodeAudioData(arrayBuffer);
    } catch (cause) {
        throw new AudioError(
            AudioErrorType.ASSET_DECODE_FAILED,
            `Failed to decode audio asset: ${source}`,
            { cause },
        );
    }
}