// src/lib/aerolux/audio/ost/manager.svelte.js
//
// this is where the time-based ost scheduler (clock.js), track and
// position (scheduler.js), schedule data (packs.js), playback (player.js)
// and asset residency (loader.js) tie in together

import { getAudioContext, getBus, registerOstModule } from '../engine.svelte.js';
import { audioState, setOstSnapshot } from '../state.svelte.js';
import { settings, saveSetting } from '../../../../stores/settings.svelte.js';
import { getPack, getTrack } from './packs.js';
import { resolveScheduledTrack, approximatePosition } from './scheduler.js';
import { msUntilNextHour, createClockWatcher } from './clock.js';
import { loadTrackBuffer as loadOstBuffer, evictExcept } from './loader.js';
import * as player from './player.js';
import { AudioError, AudioErrorType } from '../errors.js';

const ADMIN_CHECK_INTERVAL_MS = 15_000; // administrative poll

let stopWatcher = null;
let stopHourTimer = null;

function currentPack() {
    return getPack(settings.ost?.pack ?? 'default');
}

// resolves a track id to its def and decoded buffer if possible, else throws an error
async function fetchTrackBuffer(ctx, trackId) {
    const track = getTrack(trackId);
    if (!track) {
        throw new AudioError(AudioErrorType.OST_TRACK_UNAVAILABLE, `OST track "${trackId}" is not registered`);
    }
    return { track, buffer: await loadOstBuffer(ctx, track) };
}

// pack fallback if an ost does not load (definePack requires 24 entries | pack's hour 0 slot)
async function resolveFallback(ctx, pack) {
    const fallbackId = pack.schedule[0];
    try {
        const { track, buffer } = await fetchTrackBuffer(ctx, fallbackId);
        return { trackId: fallbackId, track, buffer };
    } catch {
        return null;
    }
}

// time synchronisation
async function syncToSchedule({ crossfade }) {
    const ctx = getAudioContext();
    const bus = getBus('ost');
    const pack = currentPack();
    if (!ctx || !bus || !pack) return;
    if (!settings.ost?.enabled || !settings.sound?.enabled) return;
    if (audioState.activity === 'minimised') return;

    const { hour, trackId, elapsedInHourSeconds } = resolveScheduledTrack(pack, new Date());

    let resolvedTrackId = trackId;
    let track, buffer;
    try {
        ({ track, buffer } = await fetchTrackBuffer(ctx, trackId));
    } catch (err) {
        console.error(`[audio] OST track "${trackId}" failed to load. Playing a fallback track...`, err);
        const fallback = await resolveFallback(ctx, pack);
        if (!fallback) {
            console.error('[audio] OST: no playable track available. Staying silent this hour.');
            setOstSnapshot({ state: 'idle', track: null });
            return;
        }
        ({ track, buffer, trackId: resolvedTrackId } = { ...fallback });
    }

    const position = approximatePosition(elapsedInHourSeconds, buffer.duration) ?? 0;

    if (crossfade) {
        player.transitionTo(ctx, bus, buffer, resolvedTrackId, position);
    } else {
        player.startFresh(ctx, bus, buffer, resolvedTrackId, position);
    }

    setOstSnapshot({
        enabled: true,
        pack: pack.id,
        track: resolvedTrackId,
        position,
        duration: buffer.duration,
        hour,
        transitionAt: new Date(Date.now() + msUntilNextHour()).toISOString(),
        state: 'playing',
    });

    // warms the next hour's track and evict anything outside {current, next}
    const nextHour = (hour + 1) % pack.schedule.length;
    const nextTrack = getTrack(pack.schedule[nextHour]);
    if (nextTrack) {
        loadOstBuffer(ctx, nextTrack).catch(err => {
            console.warn(`[audio] OST: preloading next track "${nextTrack.id}" failed (will retry/fallback at transition time)`, err);
        });
        evictExcept(new Set([track.source, nextTrack.source]));
    }
}

// administrative timer –––––––––––––––––––––––––––––––––––––––––––––

function scheduleHourBoundary() {
    stopHourTimer?.();
    const id = setTimeout(() => {
        syncToSchedule({ crossfade: true });
        scheduleHourBoundary(); // re-arm for the following hour
    }, msUntilNextHour());
    stopHourTimer = () => clearTimeout(id);
}

// public enable/disable ––––––––––––––––––––––––––––––––––––––––––––

export function enable() { saveSetting('ost.enabled', true); }
export function disable() { saveSetting('ost.enabled', false); }

// react to the enabled flag/active pack changing from wherever it was changed
const stopSettingsEffect = $effect.root(() => {
    $effect(() => {
        const enabled = settings.ost?.enabled;
        void settings.ost?.pack;
        if (!getAudioContext()) return;
        if (enabled) {
            syncToSchedule({ crossfade: true });
        } else {
            player.stopImmediate(getAudioContext());
            setOstSnapshot({ state: 'idle' });
        }
    });
});

// react to activity changes (minimise)
// - background is handled by engine.svelte.js
let lastActivity = audioState.activity;
const stopActivityEffect = $effect.root(() => {
    $effect(() => {
        const next = audioState.activity;
        if (next === lastActivity) return;
        const prev = lastActivity;
        lastActivity = next;

        if (next === 'minimised') {
            player.stopImmediate(getAudioContext());
            setOstSnapshot({ state: 'idle' });
        } else if (prev === 'minimised') {
            syncToSchedule({ crossfade: false });
        }
    });
});

// startup ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

async function start() {
    const ctx = getAudioContext();
    if (!ctx) return;

    // force a resync if a jump in time is found
    stopWatcher = createClockWatcher(ADMIN_CHECK_INTERVAL_MS, () => {
        console.info('[audio] OST: wall-clock jump detected. Resyncing...');
        syncToSchedule({ crossfade: true });
    });

    scheduleHourBoundary();

    if (settings.ost?.enabled && settings.sound?.enabled) {
        await syncToSchedule({ crossfade: false });
    } else {
        setOstSnapshot({ state: 'idle' });
    }
}

registerOstModule({ start });