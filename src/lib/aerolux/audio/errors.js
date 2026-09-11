// src/lib/aerolux/audio/errors.js
//
// in this file are standardised error types for which the engine can throw
// engine.svelte.js decides what to do with the error it receives
// (dev debug, user toast, attempt recovery)

export const AudioErrorType = Object.freeze({
    ASSET_LOAD_FAILED:             'ASSET_LOAD_FAILED',
    ASSET_DECODE_FAILED:           'ASSET_DECODE_FAILED',
    AUDIO_CONTEXT_SUSPENDED:       'AUDIO_CONTEXT_SUSPENDED',
    AUDIO_CONTEXT_RECOVERY_FAILED: 'AUDIO_CONTEXT_RECOVERY_FAILED',
    OST_TRACK_UNAVAILABLE:         'OST_TRACK_UNAVAILABLE',
    OST_FALLBACK_USED:             'OST_FALLBACK_USED',
    CLOCK_RESYNC:                  'CLOCK_RESYNC',
});

// determines whether an error of this type is worth showing the user 
// directly via a toast vs something that should only reach the 
// console (or a diagnostic panel if implemented in the future)
const USER_VISIBLE = new Set([
    AudioErrorType.AUDIO_CONTEXT_RECOVERY_FAILED,
]);

export class AudioError extends Error {
    /**
     * @param {string} type    one of AudioErrorType
     * @param {string} message
     * @param {{cause?: unknown, userVisible?: boolean}} [opts]
     */
    constructor(type, message, opts = {}) {
        super(message);
        this.name = 'AudioError';
        this.type = type;
        this.cause = opts.cause;
        this.userVisible = opts.userVisible ?? USER_VISIBLE.has(type);
    }
}

// convenience constructor so call sites read like 'throwAudio(...)'
export function makeAudioError(type, message, opts) {
    return new AudioError(type, message, opts);
}