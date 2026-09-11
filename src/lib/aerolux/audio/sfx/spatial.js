// src/lib/aerolux/audio/sfx/spatial.js
//
// spatial audio for sfx because it is very cool so why not
// uses 2d stereo positioning only instead of 3d hrtf because aerolux
// is a 2d app

/**
    maps a screen x-coordinate to a stereo pan value

@param {number} x   typically event.clientX
@param {number} [viewportWidth] defaults to the current window width
@returns {number}   -1 (left) .. +1 (right)
*/
export function computePan(x, viewportWidth = window.innerWidth) {
    if (typeof x !== 'number' || !viewportWidth) return 0;
    const normalised = (x / viewportWidth) * 2 - 1;
    return Math.max(-1, Math.min(1, normalised));
}