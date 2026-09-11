// src/lib/aerolux/audio/settings/volume.js
//
// in this file are small helpers for controlling the volume of the
// sound system. since there are different categories of sounds with 
// their own unique & individual volume levels, it is better to 
// have them all be in one place (this file)

// user-facing bus ids
export const BUS_IDS = Object.freeze(['master', 'ost', 'sfx', 'notifications']);

/**
    clamps a volume to the valid [0, 1] float range

@param {number} value
@returns {number}
*/
export function clampVolume(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 1;
    return Math.min(1, Math.max(0, value));
}

/**
    this is an "effective gain" formula
    master * bus * internal sound base volume * temporary attenuation
    every factor defaults to 1

@param {{ master?: number, bus?: number, base?: number, attenuation?: number }} factors
@returns {number}
*/
export function effectiveGain({ master = 1, bus = 1, base = 1, attenuation = 1 } = {}) {
    return clampVolume(master) * clampVolume(bus) * clampVolume(base) * clampVolume(attenuation);
}

/**
    this normalises a full 'settings.sound' shaped object and sets
    defaults for anything that is missing or out of range

@param {object} raw
@returns {{ enabled: boolean, master: number, ost: number, sfx: number, notifications: number }}
*/
export function normaliseSoundSettings(raw = {}) {
    return {
        enabled: raw.enabled ?? true,
        master: clampVolume(raw.master ?? 1),
        ost: clampVolume(raw.ost ?? 1),
        sfx: clampVolume(raw.sfx ?? 1),
        notifications: clampVolume(raw.notifications ?? 1),
    };
}