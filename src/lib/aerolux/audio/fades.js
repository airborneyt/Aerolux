// src/lib/aerolux/audio/fades.js
//
// gain-automation helpers
// this does not use a linear amplitude scale but rather has an 'equalPower'
// scale so that fades sound properly linear. because to the human ear,
// every 3db difference in actual loudness is double/half the perceived loudness
//
// but still a linear curve is here for anything that doesnt need all
// that attention to detail

const MIN_GAIN = 0.0001; // exponentialRamp can't target exactly 0

/**
    this ramps 'param' from its current value to 'to' over 'duration' seconds

@param {AudioParam} param
@param {AudioContext} ctx
@param {{ to: number, duration: number, curve?: 'linear'|'equalPower', from?: number }} opts
*/
export function rampParam(param, ctx, { to, duration, curve = 'equalPower', from } = {}) {
    const now = ctx.currentTime;
    const start = from ?? param.value;
 
    param.cancelScheduledValues(now);

    if (duration <= 0) {
        param.value = to;
        return;
    }
 
    if (curve === 'linear') {
        param.setValueAtTime(start, now);
        param.linearRampToValueAtTime(to, now + duration);
        return;
    }

    // 'equalPower' approximation. i know earlier i mentioned this uses a 
    // specific equal-power (sin/cos) curve but to keep performance for this
    // sound system cheap (so other app functions dont have to take a hit) an
    // exponential ramp is used instead. this allows the sound system to do
    // without setValueCurveAtTime + a precomputer Float32Array everytime.
    // snapped to the true target value because exponential ramps cant go to 
    // perfect 0
    const rampStart = Math.max(start, MIN_GAIN);
    const rampTarget = Math.max(to, MIN_GAIN);
    param.setValueAtTime(rampStart, now);
    param.exponentialRampToValueAtTime(rampTarget, now + duration);
    if (to <= 0) {
        param.setValueAtTime(0, now + duration + 0.001);
    }
}

/**
    fades a GainNode's `.gain` param

@param {GainNode} gainNode
@param {AudioContext} ctx
@param {{ to: number, duration: number, curve?: 'linear'|'equalPower', from?: number }} opts
*/
export function fadeGain(gainNode, ctx, opts) {
    rampParam(gainNode.gain, ctx, opts);
}

/**
    fade-out then fade-in across a transition point
    caller supplies the two gain nodes (old track's bus-facing gain, 
    new track's) and is responsible for actually starting the new 
    source at/after `outDuration`

@param {GainNode} outgoing
@param {GainNode} incoming
@param {AudioContext} ctx
@param {{ outDuration: number, inDuration: number, curve?: 'linear'|'equalPower' }} opts
*/
export function crossFadeSequential(outgoing, incoming, ctx, { outDuration, inDuration, curve = 'equalPower' }) {
    fadeGain(outgoing, ctx, { to: 0, duration: outDuration, curve });
    rampParam(incoming.gain, ctx, { to: 1, duration: inDuration, curve, from: 0 });
}