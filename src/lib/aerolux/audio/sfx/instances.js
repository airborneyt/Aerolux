// src/lib/aerolux/audio/sfx/instances.js
//
// this creates playback instances
// one playback instance = one BufferSource -> Gain -> [optional Panner] -> bus.input graph
// + a small public handle
//
// instances unregister themselves after playing

import { fadeGain } from '../fades.js';
import { clampVolume } from '../settings/volume.js';
import { computePan } from './spatial.js';
import { registerActive, unregisterActive } from './limiter.js';

let nextInstanceId = 1;
const DEFAULT_STOP_FADE = 0.03; // seconds (avoids popping/clicks)

/**
 * @param {{
 *   ctx: AudioContext,
 *   bus: import('../buses.js').BusHandle,
 *   def: import('./definitions.js').SoundDef,
 *   buffer: AudioBuffer,
 *   x?: number, y?: number,
 *   volumeOverride?: number,
 * }} args
 */
export function createInstance({ ctx, bus, def, buffer, x, volumeOverride }) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = !!def.loop;

    const gainNode = ctx.createGain();
    const baseVolume = clampVolume(volumeOverride ?? def.baseVolume);
    gainNode.gain.value = baseVolume;

    let pannerNode = null;
    source.connect(gainNode);

    if (def.spatial && typeof x === 'number') {
        pannerNode = ctx.createStereoPanner();
        pannerNode.pan.value = computePan(x);
        gainNode.connect(pannerNode);
        pannerNode.connect(bus.input);
    } else {
        gainNode.connect(bus.input);
    }

    const instance = {
        id: nextInstanceId++,
        defId: def.id,
        priority: def.priority,
        startedAt: ctx.currentTime,
        stopped: false,

        stop(fadeSeconds = DEFAULT_STOP_FADE) {
            if (instance.stopped) return;
            instance.stopped = true;
            if (fadeSeconds > 0) {
                fadeGain(gainNode, ctx, { to: 0, duration: fadeSeconds });
                setTimeout(() => safeStop(source), fadeSeconds * 1000 + 20);
            } else {
                safeStop(source);
            }
        },

        setVolume(value) {
            fadeGain(gainNode, ctx, { to: clampVolume(value), duration: 0.03 });
        },

        setPitch(playbackRate) {
            source.playbackRate.value = playbackRate;
        },

        setPan(panValue) {
            if (pannerNode) pannerNode.pan.value = Math.max(-1, Math.min(1, panValue));
        },

        // internally called only by limiter.js' duckLowerPriority()
        duck(factor, durationSeconds) {
            fadeGain(gainNode, ctx, { to: baseVolume * factor, duration: 0.05 });
            setTimeout(() => {
                if (!instance.stopped) fadeGain(gainNode, ctx, { to: baseVolume, duration: durationSeconds });
            }, durationSeconds * 1000);
        },
    };

    source.onended = () => unregisterActive(instance);
    registerActive(instance);
    source.start(0);

    return instance;
}

function safeStop(sourceNode) {
    try { sourceNode.stop(); } catch { 
        // already stopped/ended 
    }
}