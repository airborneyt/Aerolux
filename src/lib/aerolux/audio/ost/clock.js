// src/lib/aerolux/audio/ost/clock.js
//
// wall-clock for the ost scheduler

export function getLocalTimeInfo(now = new Date()) {
    return {
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
        elapsedInHourSeconds: now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000,
    };
}

// milliseconds until the next local-time hour boundary
export function msUntilNextHour(now = new Date()) {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime() - now.getTime();
}

// true if the observed gap between two checks does not match what the
// interval timer should have produced by more than 'toleranceMs'
// there is a tolerance to factor in any system hangs
export function isClockJump(expectedElapsedMs, actualElapsedMs, toleranceMs = 5000) {
    return Math.abs(actualElapsedMs - expectedElapsedMs) > toleranceMs;
}

/**
    administrative poller that only calls 'onJump' if there is a gap
    if the gap is larger than expected it is treated as a resync

@param {number} intervalMs
@param {(gapMs: number) => void} onJump
@returns {() => void} stop function
*/
export function createClockWatcher(intervalMs, onJump) {
    let last = Date.now();
    const id = setInterval(() => {
        const now = Date.now();
        const actualElapsed = now - last;
        if (isClockJump(intervalMs, actualElapsed)) onJump(actualElapsed);
        last = now;
    }, intervalMs);
    return () => clearInterval(id);
}