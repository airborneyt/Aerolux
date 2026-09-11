// src/lib/aerolux/audio/engine.svelte.js

// this has one AudioContext and the persistent bus tree for the entire app.
// everything else in the audio subsystem is built on top of this (such as
// sfx playback, ost scheduling)

import { getCurrentWindow } from '@tauri-apps/api/window';
import { settings, saveSetting } from '../../../stores/settings.svelte.js';
import { buildBusTree, teardownBusTree, DEFAULT_BUS_SPEC } from './buses.js';
import { fadeGain } from './fades.js';
import { normaliseSoundSettings, clampVolume, BUS_IDS } from './settings/volume.js';
import { AudioError, AudioErrorType } from './errors.js';
import {
    audioState, setReady, setContextState, setVolumeSnapshot,
    setEnabled as setEnabledState, setActivity,
} from './state.svelte.js';

// module-level singleton state –––––––––––––––––––––––––––––––––––––
// this is the app's AudioContext

/** @type {AudioContext|null} */
let ctx = null;
/** @type {Map<string, import('./buses.js').BusHandle>|null} */
let buses = null;
let initialized = false;
let initPromise = null;

// small local pub/sub 
const listeners = new Map(); // event -> Set<fn>
function emit(event, payload) {
    for (const fn of listeners.get(event) ?? []) {
        try { fn(payload); } catch (err) { console.error(`[audio] listener for "${event}" threw`, err); }
    }
}
export function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
}

function reportError(err) {
    console.error('[audio]', err);
    emit('error', err);
}

// hooks for modules
let sfxInitHook = null;
let ostInitHook = null;
//c alled once by sfx/manager.js before engine init completes
export function registerSfxModule(hooks) { sfxInitHook = hooks; }
// called once by ost/manager.js before engine init completes
export function registerOstModule(hooks) { ostInitHook = hooks; }

// cleanup registry for lifecycle listeners –––––––––––––––––––––––––
const teardownFns = [];

// initialisation –––––––––––––––––––––––––––––––––––––––––––––––––––

/**
@returns {Promise<void>}
*/
export function init() {
    if (initPromise) return initPromise;
    initPromise = doInit();
    return initPromise;
}

async function doInit() {
    try {
        // 1. AudioContext
        ctx = new (window.AudioContext || window.webkitAudioContext)();

        // 2. bus graph
        buses = buildBusTree(ctx, DEFAULT_BUS_SPEC);

        // 3 & 4. read persisted settings, apply as initial (instant, no
        // ramp) gain values
        applySoundSettings(normaliseSoundSettings(settings.sound), { instant: true });

        // 5. lifecycle listeners (focus/blur/minimise → activity state)
        registerLifecycleListeners();

        // 6. clock-change monitoring

        // 7. AudioContext suspend/recovery
        registerContextRecovery();
        registerGestureUnlock();

        // 8. preload SFX
        if (sfxInitHook?.preload) await sfxInitHook.preload();

        // 9-11. OST scheduler bring-up
        if (ostInitHook?.start) await ostInitHook.start();

        // 12. (OST enable/disable itself is handled inside the OST
        // module's own `start()` per current `settings.sound.enabled`.)

        initialized = true;
        setReady(true);
        setContextState(ctx.state);
        emit('stateChanged', getState());
    } catch (err) {
        reportError(new AudioError(
            AudioErrorType.AUDIO_CONTEXT_RECOVERY_FAILED,
            'Audio engine failed to initialise',
            { cause: err, userVisible: false },
        ));
        // if the audio engine cant start callers are told to ignore
        setReady(false);
    }
}

// settings application –––––––––––––––––––––––––––––––––––––––––––––

/**
    this applies a normalised 'settings.sound' shaped opject to the live bus graph.
    gets called on init and whenever 'settings.sound' changes

@param {{enabled:boolean, master:number, ost:number, sfx:number, notifications:number}} sound
@param {{instant?: boolean}} [opts]
*/
function applySoundSettings(sound, { instant = false } = {}) {
    if (!ctx || !buses) return;
    const RAMP = instant ? 0 : 0.05; // short ramp to avoid pops/clicks on slider drags

    for (const id of BUS_IDS) {
        const bus = buses.get(id);
        if (!bus) continue;
        const value = clampVolume(sound[id] ?? 1);
        fadeGain(bus.volumeGain, ctx, { to: value, duration: RAMP });
    }

    // "enabled" mutes the master bus' attenuation stage and not its volume
    const master = buses.get('master');
    if (master) {
        fadeGain(master.attenuationGain, ctx, { to: sound.enabled ? 1 : 0, duration: RAMP });
    }

    setVolumeSnapshot({ master: sound.master, ost: sound.ost, sfx: sound.sfx, notifications: sound.notifications });
    setEnabledState(sound.enabled);
}

// this reacts to settings changes made from anywhere in the app through
// the existing 'saveSetting('sound.master', v)' call.
const stopSettingsEffect = $effect.root(() => {
    $effect(() => {
        // Read every field so the effect re-runs on any of them changing,
        // not just reference identity of the `sound` object.
        const snapshot = normaliseSoundSettings(settings.sound);
        if (initialized) applySoundSettings(snapshot);
    });
});

// volume API –––––––––––––––––––––––––––––––––––––––––––––––––––––––

/**
    live preview for settings

@param {'master'|'ost'|'sfx'|'notifications'} bus
@param {number} value 0-1
*/
export function previewVolume(bus, value) {
    if (!ctx || !buses) return;
    const handle = buses.get(bus);
    if (!handle) return;
    fadeGain(handle.volumeGain, ctx, { to: clampVolume(value), duration: 0 });
}

/**
 * @param {'master'|'ost'|'sfx'|'notifications'} bus
 * @param {number} value 0-1
 */
export function setVolume(bus, value) {
    if (!BUS_IDS.includes(bus)) {
        console.warn(`[audio] setVolume: unknown bus "${bus}"`);
        return;
    }
    saveSetting(`sound.${bus}`, clampVolume(value));
}

export function setSoundEnabled(enabled) {
    saveSetting('sound.enabled', !!enabled);
}

// state API ––––––––––––––––––––––––––––––––––––––––––––––––––––––––

export function getState() {
    return JSON.parse(JSON.stringify(audioState));
}

// internal accessors for sibling modules (sfx/, ost/) ––––––––––––––

export function getAudioContext() { return ctx; }
export function getBus(id) { return buses?.get(id) ?? null; }
export function isInitialized() { return initialized; }

// lifecycle: focus / background / minimise –––––––––––––––––––––––––

function registerLifecycleListeners() {
    const win = getCurrentWindow();

    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
        setActivityState(focused ? 'active' : 'background');
    });

    const unlistenResize = win.onResized(async () => {
        try {
            const minimised = await win.isMinimized();
            setActivityState(minimised ? 'minimised' : (audioState.activity === 'background' ? 'background' : 'active'));
        } catch (err) {
            console.warn('[audio] isMinimized() check failed', err);
        }
    });

    Promise.resolve(unlistenFocus).then(fn => teardownFns.push(fn));
    Promise.resolve(unlistenResize).then(fn => teardownFns.push(fn));
}

// backgound OST attenuation multiplier that is applied to the OST bus'
// attenuated stage only and not to persisted volume
// minimised goes further and stops teh OST entirely
const BACKGROUND_OST_ATTENUATION = 0.4;

function setActivityState(next) {
    if (audioState.activity === next) return;
    setActivity(next);

    const ostBus = buses?.get('ost');
    if (ctx && ostBus) {
        const target = next === 'background' ? BACKGROUND_OST_ATTENUATION : 1;
        if (next !== 'minimised') {
            fadeGain(ostBus.attenuationGain, ctx, { to: target, duration: 0.3 });
        }
    }

    emit('stateChanged', getState());
}

// AudioContext suspend/recovery ––––––––––––––––––––––––––––––––––––

function registerContextRecovery() {
    if (!ctx) return;
    const onStateChange = () => {
        setContextState(ctx.state);
        if (ctx.state === 'suspended') {
            reportError(new AudioError(AudioErrorType.AUDIO_CONTEXT_SUSPENDED, 'AudioContext suspended', { userVisible: false }));
            ctx.resume().catch(err => {
                reportError(new AudioError(AudioErrorType.AUDIO_CONTEXT_RECOVERY_FAILED, 'Failed to resume AudioContext', { cause: err }));
            });
        }
        emit('stateChanged', getState());
    };
    ctx.addEventListener('statechange', onStateChange);
    teardownFns.push(() => ctx?.removeEventListener('statechange', onStateChange));
}

function registerGestureUnlock() {
    if (!ctx) return;
    const unlock = () => {
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
    teardownFns.push(() => {
        document.removeEventListener('pointerdown', unlock, { capture: true });
        document.removeEventListener('keydown', unlock, { capture: true });
    });
}

// teardown –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// not called anywhere but made for debug purposes

export function destroy() {
    for (const fn of teardownFns.splice(0)) {
        try { fn?.(); } catch { /* best-effort */ }
    }
    stopSettingsEffect();
    if (buses) teardownBusTree(buses);
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    ctx = null;
    buses = null;
    initialized = false;
    initPromise = null;
    setReady(false);
}