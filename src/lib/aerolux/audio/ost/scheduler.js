// src/lib/aerolux/audio/ost/scheduler.js
//
// given a pack and the current wall-clock time, which track
// should be playing and roughly where in it

import { getLocalTimeInfo } from './clock.js';

/**
@param {{ schedule: string[] }} pack  24-entry array, index = hour
@param {Date} [now]
@returns {{ hour: number, trackId: string, elapsedInHourSeconds: number }}
*/
export function resolveScheduledTrack(pack, now = new Date()) {
    const { hour, elapsedInHourSeconds } = getLocalTimeInfo(now);
    const trackId = pack.schedule[hour % pack.schedule.length] ?? pack.schedule[0];
    return { hour, trackId, elapsedInHourSeconds };
}

/**
    approximate playback position within a track
    elapsed time within the current hour, modulo the track's duration

@param {number} elapsedInHourSeconds
@param {number|null|undefined} durationSeconds
@returns {number|null}
*/
export function approximatePosition(elapsedInHourSeconds, durationSeconds) {
    if (!durationSeconds || durationSeconds <= 0) return null;
    return elapsedInHourSeconds % durationSeconds;
}