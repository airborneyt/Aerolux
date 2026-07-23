// src/lib/aerolux/frameTicker.js
// ============================================================================
// shared frame ticker for VirtualLP instances.
// one requestAnimationFrame loop, shared by every subscriber, rather than
// each caller running its own independent rAF registration.
// ============================================================================

const listeners = new Set();
let rafId = null;

function tick(now) {
    rafId = requestAnimationFrame(tick);
    for (const fn of listeners) fn(now);
}

/**
 * registers a per-frame callback. starts the shared rAF loop if this is
 * the first subscriber; the loop is torn down automatically once the last
 * subscriber unsubscribes, so an idle page with no VirtualLP instances
 * mounted burns zero rAF callbacks.
 * @param {(now:number) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeFrame(fn) {
    listeners.add(fn);
    if (rafId === null) rafId = requestAnimationFrame(tick);
    return () => unsubscribeFrame(fn);
}

/** @param {(now:number) => void} fn */
export function unsubscribeFrame(fn) {
    listeners.delete(fn);
    if (!listeners.size && rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

/** exposed for tests only, not part of the public API. */
export function _subscriberCount() { return listeners.size; }