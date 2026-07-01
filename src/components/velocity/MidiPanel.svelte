<!-- src/components/velocity/MidiPanel.svelte -->
<!-- to be rewritten entirely! use midi-layout calculation instead -->
<script>
import { onMount, onDestroy } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { editor, gradResult } from '../../stores/velocity.svelte.js';
import {
    parseMidiFile, detectGradient, injectGradient,
    buildAnimFrame, playLightshow, CONNECT_LIGHTSHOW,
    NOTE_TO_CELL, CELL_TO_NOTE, noteName,
} from '../../lib/aerolux/midi.js';
import { toHex } from '../../lib/aerolux/palette.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { playSound } from '../../lib/aerolux/sound.js';
import StatusPill from '../shared/StatusPill.svelte';

// state ─────────────────────────────────────────────────────────────
let midiStatus      = $state({ state: '', text: 'Not connected' });
let devices         = $state([]);
let selectedDevice  = $state('');
let connected       = $state(false);

let loadedMidiBytes   = null;
let parsedMidiData    = null;
let detectedGradVels  = $state([]);
let injectedMidiBytes = null;

let fileStatus = $state('No file loaded');
let showGradPreview = $state(false);
let showPadPreview  = $state(false);

// live animation
let animating    = $state(false);
let animFrame    = 0;
let animTimer    = null;
let animSpeed    = $state(200);

let lpSpeedMode  = $state('ms');
let lpBpm        = $state(120);
let lpSubdiv     = $state(1);
let lpTapTimes   = [];

// rust MIDI commands ────────────────────────────────────────────────

async function listDevices() {
    try {
        devices = await invoke('midi_list_devices');
        if (devices.length && !selectedDevice) selectedDevice = devices[0];
    } catch (e) {
        midiStatus = { state: 'error', text: 'MIDI unavailable: ' + e };
    }
}

async function connect() {
    if (!selectedDevice) return;
    try {
        midiStatus = { state: 'busy', text: 'Connecting…' };
        await invoke('midi_connect', { deviceId: selectedDevice });
        connected = true;
        midiStatus = { state: 'ok', text: selectedDevice };
        showToast('MIDI connected', 'success');
        playSound('midiSuccess');
        await sendGradient();
    } catch (e) {
        midiStatus = { state: 'error', text: 'Failed: ' + e };
        playSound('midiFail');
    }
}

async function sendGradient() {
    if (!connected) return;
    const gr = gradResult();
    const palette = editor.palette;
    // build pad state. rows 4 and 5 (notes 41–58)
    const padState = [];
    gr.forEach(({ step, velocity }) => {
        const c    = palette[velocity] ?? palette[0];
        const note = step < 8 ? 51 + step : step < 16 ? 41 + (step - 8) : -1;
        if (note >= 0) padState.push({ note, r: c.r, g: c.g, b: c.b });
    });
    try {
        await invoke('midi_send_pad_state', { pads: padState });
    } catch (e) {
        console.warn('MIDI send error:', e);
    }
}

async function clearPads() {
    if (!connected) return;
    try {
        await invoke('midi_clear_pads');
        showToast('Pads cleared', 'info', 1500);
    } catch (e) {
        showToast('Clear failed: ' + e, 'error');
    }
}

// re-send gradient whenever it changes
$effect(() => {
    const _dep = gradResult();
    if (connected) sendGradient();
});

// speed helpers ─────────────────────────────────────────────────────
const bpmToMs = $derived(Math.round((60000 / lpBpm) * lpSubdiv));

function tapTempo() {
    const now = performance.now();
    lpTapTimes.push(now);
    if (lpTapTimes.length > 1 && now - lpTapTimes[lpTapTimes.length - 2] > 3000)
        lpTapTimes = [now];
    if (lpTapTimes.length > 4) lpTapTimes.shift();
    if (lpTapTimes.length < 2) { showToast('Tap again…', 'info', 800); return; }
    let total = 0;
    for (let i = 1; i < lpTapTimes.length; i++) total += lpTapTimes[i] - lpTapTimes[i-1];
    lpBpm = Math.max(20, Math.min(300, Math.round(60000 / (total / (lpTapTimes.length - 1)))));
    showToast(`${lpBpm} BPM`, 'info', 1200);
}

// live animation ────────────────────────────────────────────────────

function startAnim() {
    if (animating) return;
    animating  = true;
    animFrame  = 0;
    const interval = lpSpeedMode === 'bpm' ? bpmToMs : animSpeed;
    const tick = async () => {
        if (!animating) return;
        const leds = buildAnimFrame(animFrame++, gradResult(), editor.palette);
        const pads = leds.map(({ note, r, g, b }) => ({ note, r, g, b }));
        try { await invoke('midi_send_pad_state', { pads }); } catch {}
        animTimer = setTimeout(tick, interval);
    };
    tick();
}

function stopAnim() {
    animating = false;
    clearTimeout(animTimer);
    animTimer = null;
    sendGradient();
}

// MIDI file ─────────────────────────────────────────────────────────

async function loadMidiFile() {
    const path = await open({ filters: [{ name: 'MIDI', extensions: ['mid','midi'] }] });
    if (!path) return;
    try {
        const bytes      = await readFile(path);
        loadedMidiBytes  = bytes;
        parsedMidiData   = parseMidiFile(bytes);
        detectedGradVels = detectGradient(parsedMidiData.noteOns);
        fileStatus       = `${detectedGradVels.length} gradient steps detected`;
        showGradPreview  = true;
        showPadPreview   = true;
        showToast(`MIDI loaded. ${detectedGradVels.length} gradient steps`, 'success');
    } catch (e) {
        showToast('MIDI parse error: ' + e.message, 'error');
    }
}

function injectGradientIntoMidi() {
    if (!parsedMidiData || !detectedGradVels.length) return;
    injectedMidiBytes = injectGradient(
        loadedMidiBytes, parsedMidiData.noteOns, detectedGradVels, gradResult()
    );
    showToast('Gradient injected', 'success');
    sendGradient();
}

async function exportMidi() {
    if (!injectedMidiBytes) return;
    const defaultName = `Aerolux ${gradResult().map(g => g.velocity).join(' ')}.mid`;
    const path = await save({ defaultPath: defaultName, filters: [{ name: 'MIDI', extensions: ['mid'] }] });
    if (!path) return;
    await writeFile(path, injectedMidiBytes);
    showToast('MIDI exported', 'success');
    playSound('exportSuccess');
}

function clearMidi() {
    loadedMidiBytes = null; parsedMidiData = null;
    detectedGradVels = []; injectedMidiBytes = null;
    fileStatus = 'No file loaded';
    showGradPreview = false; showPadPreview = false;
    showToast('File cleared', 'info', 1500);
}

onMount(listDevices);
onDestroy(() => { if (animating) stopAnim(); });
</script>

<div class="al-card" id="midi-panel">
    <div class="al-card-header">
        <h3 class="al-card-title">Launchpad Preview</h3>
        <StatusPill state={midiStatus.state} text={midiStatus.text} />
    </div>

    <div class="al-midi-controls">
        <button class="al-btn" onclick={listDevices}>Refresh</button>
        <select class="al-select" style="flex:1"
            bind:value={selectedDevice} disabled={!devices.length}>
            {#if !devices.length}
                <option value="">No MIDI devices found</option>
            {:else}
                {#each devices as d}
                    <option value={d}>{d}</option>
                {/each}
            {/if}
        </select>
        <button class="al-btn al-btn-blue" onclick={connect}
            disabled={!devices.length}>
            {connected ? 'Reconnect' : 'Connect'}
        </button>
        <button class="al-btn" onclick={sendGradient} disabled={!connected}>Send</button>
        <button class="al-btn" onclick={clearPads}    disabled={!connected}>Clear</button>
    </div>

    <!-- lightshow injection -->
    <div style="margin-top:12px;border-top:1px solid var(--color-border);padding-top:12px">
        <p class="al-label" style="margin-bottom:8px">Ableton lightshow injection</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
            <button class="al-btn" onclick={loadMidiFile}>⬆ Load .mid</button>
            <button class="al-btn al-btn-blue" onclick={injectGradientIntoMidi}
                disabled={!parsedMidiData}>Inject gradient</button>
            <button class="al-btn al-btn-green" onclick={exportMidi}
                disabled={!injectedMidiBytes}>⬇ Export .mid</button>
            {#if parsedMidiData}
                <button class="al-btn" onclick={clearMidi}>✕ Clear</button>
            {/if}
        </div>
        <p class="al-hint-text">{fileStatus}</p>

        {#if showGradPreview && detectedGradVels.length}
            <p class="al-label" style="margin-top:8px;margin-bottom:4px">Detected gradient</p>
            <div style="height:20px;border-radius:var(--radius-sm);overflow:hidden;display:flex;border:1px solid var(--color-border)">
                {#each detectedGradVels as vel}
                    {@const c = editor.palette[vel] ?? editor.palette[0]}
                    <div style="flex:1;background:{toHex(c.r,c.g,c.b)}"
                         title="Palette #{vel}"></div>
                {/each}
            </div>
        {/if}
    </div>

    <!-- live animation -->
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px">
        {#if !animating}
            <button class="al-btn al-btn-blue" onclick={startAnim}
                disabled={!connected}>▶ Play on Launchpad</button>
        {:else}
            <button class="al-btn" onclick={stopAnim}>■ Stop</button>
        {/if}

        <!-- speed mode tabs -->
        <div class="al-sort-tabs">
            {#each [{v:'ms',l:'Manual'},{v:'bpm',l:'BPM'}] as m}
                <button class="al-stab {lpSpeedMode===m.v?'active':''}"
                    onclick={() => { lpSpeedMode=m.v; if(animating){stopAnim();startAnim();} }}
                >{m.l}</button>
            {/each}
        </div>

        {#if lpSpeedMode === 'ms'}
            <span class="al-label" style="margin:0">Speed</span>
            <input type="range" min="50" max="800" step="50" bind:value={animSpeed}
                style="width:80px"
                oninput={() => { if(animating){stopAnim();startAnim();} }} />
            <span class="al-val">{animSpeed}ms</span>
        {:else}
            <input type="number" class="al-num-input al-input--w-xs"
                min="20" max="300" bind:value={lpBpm}
                oninput={() => { if(animating){stopAnim();startAnim();} }} />
            <span class="al-dim">BPM</span>
            <select class="al-select" style="width:90px" bind:value={lpSubdiv}
                onchange={() => { if(animating){stopAnim();startAnim();} }}>
                <option value={4}>1 bar</option>
                <option value={2}>½ note</option>
                <option value={1}>¼ note</option>
                <option value={0.5}>⅛ note</option>
            </select>
            <button class="al-btn al-btn-sm" onclick={tapTempo}>Tap</button>
            <span class="al-val">{bpmToMs}ms</span>
        {/if}
    </div>
</div>