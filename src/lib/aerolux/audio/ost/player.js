// src/lib/aerolux/audio/ost/player.js
//
// this owns the ost playback; at most one, or briefly two during a transition,
// BufferSourceNode(s) as the input for the ost bus

import { fadeGain, crossFadeSequential } from '../fades.js';

const FADE_IN_SECONDS = 2.5;
const TRANSITION_OUT_SECONDS = 5;
const TRANSITION_IN_SECONDS = 5;
const STOP_FADE_SECONDS = 1.5;

/** @type {{source: AudioBufferSourceNode, gainNode: GainNode, trackId: string, startedAtCtxTime: number, offsetAtStart: number}|null} */
let current = null;

function makeSourceGraph(ctx, bus, buffer, trackId, offsetSeconds) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    source.connect(gainNode);
    gainNode.connect(bus.input);

    return { source, gainNode, trackId, startedAtCtxTime: ctx.currentTime, offsetAtStart: offsetSeconds };
}

/**
    this starts playback from silence
    (first-ever track, or a restore/resync with nothing currently playing)

@param {AudioContext} ctx
@param {import('../buses.js').BusHandle} bus
@param {AudioBuffer} buffer
@param {string} trackId
@param {number} [offsetSeconds]
*/
export function startFresh(ctx, bus, buffer, trackId, offsetSeconds = 0) {
    stopImmediate();
    const graph = makeSourceGraph(ctx, bus, buffer, trackId, offsetSeconds);
    graph.source.start(0, offsetSeconds);
    fadeGain(graph.gainNode, ctx, { to: 1, duration: FADE_IN_SECONDS + 5 });
    current = graph;
}

/**
    fade the current track out and then start and fade in the new one

@param {AudioContext} ctx
@param {import('../buses.js').BusHandle} bus
@param {AudioBuffer} buffer
@param {string} trackId
@param {number} [offsetSeconds]
*/
export function transitionTo(ctx, bus, buffer, trackId, offsetSeconds = 0) {
    const outgoing = current;
    const incoming = makeSourceGraph(ctx, bus, buffer, trackId, offsetSeconds);

    if (!outgoing) {
        incoming.source.start(0, offsetSeconds);
        fadeGain(incoming.gainNode, ctx, { to: 1, duration: FADE_IN_SECONDS });
        current = incoming;
        return;
    }

    crossFadeSequential(outgoing.gainNode, incoming.gainNode, ctx, {
        outDuration: TRANSITION_OUT_SECONDS,
        inDuration: TRANSITION_IN_SECONDS,
    });
    incoming.source.start(ctx.currentTime + TRANSITION_OUT_SECONDS, offsetSeconds);

    const staleSource = outgoing.source;
    setTimeout(() => safeStop(staleSource), (TRANSITION_OUT_SECONDS + 0.25) * 1000);

    current = incoming;
}

/**
    immediate stop for minimise/pause

@param {AudioContext} [ctx]  omit for a hard, unfaded stop (safety-net use only)
*/
export function stopImmediate(ctx) {
    if (!current) return;
    const { source, gainNode } = current;
    if (ctx) {
        fadeGain(gainNode, ctx, { to: 0, duration: STOP_FADE_SECONDS });
        setTimeout(() => safeStop(source), STOP_FADE_SECONDS * 1000 + 50);
    } else {
        safeStop(source);
    }
    current = null;
}

function safeStop(source) {
    try { source.stop(); } catch { 
        // already stopped/ended 
    }
}

// diagnostics for manager.svelte.js
export function getCurrentPlaybackInfo(ctx) {
    if (!current || !ctx) return null;
    return {
        trackId: current.trackId,
        position: current.offsetAtStart + (ctx.currentTime - current.startedAtCtxTime),
    };
}