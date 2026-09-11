// src/lib/aerolux/audio/sfx/manager.js
//
// self explanatory (manages sfx)
// this calles 'registerSfxModule({preload}) on the engine so it preloads
// every sfx before finishing startup

import { getAudioContext, getBus, registerSfxModule } from '../engine.svelte.js';
import { loadAudioBuffer } from '../assets/loader.js';
import { getResolvedBuffer } from '../assets/cache.js';
import { getSoundDef, listSoundDefs } from './definitions.js';
import { checkConcurrency, duckLowerPriority } from './limiter.js';
import { createInstance } from './instances.js';

const lastPlayedAt = new Map();  // defId -> ctx.currentTime of last trigger (cooldown guard)
const instancesById = new Map(); // public instance id -> live instance

// priority at/above which a newly-played sound ducks lower-priority ones
// already playing
const DUCK_THRESHOLD_PRIORITY = 75;

// preloads every registered sound
async function preload() {
    const ctx = getAudioContext();
    if (!ctx) return;
    await Promise.all(
        listSoundDefs()
            .filter(def => def.preload)
            .map(async def => {
                try {
                    await loadAudioBuffer(ctx, def.source);
                } catch (err) {
                    console.error(`[audio] SFX preload failed for "${def.id}"`, err);
                }
            }),
    );
}

registerSfxModule({ preload });

/**
@param {string} id
@param {{x?: number, y?: number, volume?: number, pitch?: number}} [opts]
@returns {{id: number|null, stop: Function, setVolume: Function, setPitch: Function, setPan: Function}|null}
    null if the sound couldn't be started at all (engine not ready, unknown
    id, concurrency rejected it, cooldown active)
*/
export function play(id, opts = {}) {
    const ctx = getAudioContext();
    if (!ctx) return null;

    const def = getSoundDef(id);
    if (!def) {
        console.warn(`[audio] sfx.play: unknown sound "${id}"`);
        return null;
    }

    if (def.cooldown > 0) {
        const last = lastPlayedAt.get(id) ?? -Infinity;
        if (ctx.currentTime - last < def.cooldown / 1000) return null;
    }

    const { allow, evict } = checkConcurrency(def);
    if (!allow) return null;
    if (evict) evict.stop(0.02);

    const bus = getBus(def.bus);
    if (!bus) {
        console.warn(`[audio] sfx.play: unknown bus "${def.bus}" for sound "${id}"`);
        return null;
    }

    lastPlayedAt.set(id, ctx.currentTime);
    if (def.priority >= DUCK_THRESHOLD_PRIORITY) duckLowerPriority(def.priority);

    const handle = { id: null, _instance: null,
        stop: (fade) => handle._instance?.stop(fade),
        setVolume: (v) => handle._instance?.setVolume(v),
        setPitch: (p) => handle._instance?.setPitch(p),
        setPan: (p) => handle._instance?.setPan(p),
    };

    const startWith = (buffer) => {
        const instance = createInstance({ ctx, bus, def, buffer, x: opts.x, y: opts.y, volumeOverride: opts.volume });
        if (opts.pitch) instance.setPitch(opts.pitch);
        instancesById.set(instance.id, instance);
        handle.id = instance.id;
        handle._instance = instance;
    };

    // if already decoded then use that, else cache it
    const cached = getResolvedBuffer(def.source);
    if (cached) {
        startWith(cached);
    } else {
        loadAudioBuffer(ctx, def.source).then(startWith).catch(err => {
            console.error(`[audio] sfx.play: failed to load "${id}"`, err);
        });
    }

    return handle;
}

export function stop(instanceId, fade) {
    instancesById.get(instanceId)?.stop(fade);
}

export function update(instanceId, params = {}) {
    const inst = instancesById.get(instanceId);
    if (!inst) return;
    if (params.volume != null) inst.setVolume(params.volume);
    if (params.pitch != null) inst.setPitch(params.pitch);
    if (params.pan != null) inst.setPan(params.pan);
}