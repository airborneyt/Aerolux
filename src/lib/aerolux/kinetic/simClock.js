// src/lib/aerolux/kinetic/simClock.js
// ============================================================================
// KINETIC ENGINE: SIMULATION CLOCK
//
// stateful fields advance on their own fixed-rate clock, decoupled from the 
// project's bpm/timeDiv. locking sim steps to MIDI tick resolution means step 
// count scales with whatever tempo/timeDiv a project happens to use (unbounded 
// cost at fast tempos or fine timeDiv), and diffusion-style simulations need 
// a fixed step size to behave consistently run to run. a fixed-rate accumulator 
// also keeps live-preview cost bounded and predictable regardless of playback
// speed, and needs no interpolation at export. a stateful field's colour is
// constant between its own steps.
// ============================================================================

const DEFAULT_SIM_RATE_HZ = 60;

/**
    fixed-step accumulator: same pattern as a game-loop physics step. feed it
    real elapsed wall-clock seconds (e.g. a requestAnimationFrame delta)
    instead of MIDI ticks.

@param {number} [rateHz]
*/
export function createSimClock(rateHz = DEFAULT_SIM_RATE_HZ) {
    const dt = 1 / rateHz;
    let accumulator = 0;

    return {
        rateHz,
        dt,

        /**
         * advances every given stateful field by however many fixed steps
         * have accumulated since the last call.
         * @param {number} elapsedSeconds
         * @param {Field[]} statefulFields
         * @param {*} context
         * @returns {number} steps actually taken this call
         */
        tick(elapsedSeconds, statefulFields, context) {
            accumulator += elapsedSeconds;
            let steps = 0;
            while (accumulator >= dt) {
                for (const field of statefulFields) field.advance(dt, context);
                accumulator -= dt;
                steps++;
            }
            return steps;
        },

        reset() { accumulator = 0; },
    };
}