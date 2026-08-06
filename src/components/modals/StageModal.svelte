<!-- src/components/modals/StageModal.svelte -->
<!--
    opened on demand instead of being a persistent panel. the ONLY place
    kinetic.devices gets mutated. everywhere else in Kinetic only 
    reads devices[].

    tiled per-device previews here are a lightweight CSS colour-grid, not a
    full VirtualLP/WebGL instance. WebGL quality is unnecessary at the 
    thumbnail scale a device-arrangement overview needs, and 
    MultiDevicePreview.svelte already covers the full-fidelity always-visible 
    hero view. it is noted that at large device counts, the stage can become
    sluggish during live-playback, but that will be an intentional compromise.

    the mode light is not shown in the mini grid. it is positioned outside
    the clean 0..9 x/y range this thumbnail renders. adding it here would mean
    the mini grid will have to take an awkward rectangular shape in a space
    created to hold squares. MultiDevicePreview.svelte's full-quality VirtualLP
    instances already show both logo and mode distinctively, and that will be 
    the place to look at both of them.
-->
<script>
import {
    kinetic, addDevice, removeDevice, setPrimaryDevice, updateDevice, deviceLabel, pushKineticUndo,
    connectDeviceOutput, disconnectDeviceOutput,
} from '../../stores/kinetic.svelte.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { invoke } from '@tauri-apps/api/core';
import { kineticPreview } from '../../stores/kineticPreview.svelte.js';
import { computeAutoPosition, DEVICE_FOOTPRINT } from '../../lib/aerolux/kinetic/devicePlacement.js';
import { getDeviceGrid } from '../../lib/aerolux/kinetic/sampleDevice.js';
import { LIVE_PUSH_RATE_PRESETS, getLivePushRateHz, setLivePushRateHz } from '../../lib/aerolux/kinetic/livePush.js';

let pushRateHz = $state(getLivePushRateHz());
function onPushRateChange(hz) {
    pushRateHz = hz;
    setLivePushRateHz(hz);
}
function rateLabel(hz) { return hz === 0 ? 'Unlimited' : `${hz} fps`; }

let { open = $bindable(false) } = $props();

const SCALE = 16; // px per canvas unit, for the stage's own mini-map
const ROTATE_CYCLE = { 0: 90, 90: 180, 180: 270, 270: 0 };
const MINI_GRID_SIZE = 10; // matches the shared grid's x/y range (0..9 on each axis)

function footprintFor(device) {
    return (device.rotation === 90 || device.rotation === 270)
        ? { width: DEVICE_FOOTPRINT.height, height: DEVICE_FOOTPRINT.width }
        : { width: DEVICE_FOOTPRINT.width, height: DEVICE_FOOTPRINT.height };
}

// single shared grid, indexed by "x,y" for O(1) lookup while rendering the
// mini grid below.
const gridIndex = (() => {
    const byCoord = new Map();
    for (const cell of getDeviceGrid()) byCoord.set(`${cell.x},${cell.y}`, cell);
    return byCoord;
})();

// drag to reposition –––––––––––––––––––––––––––––––––––––––––––––––
let dragging = null;

function onDevicePointerDown(e, device) {
    e.stopPropagation();
    if (e.button !== 0) return;
    pushKineticUndo();
    dragging = {
        deviceId: device.id,
        startX: e.clientX, startY: e.clientY,
        origX: device.position.x, origY: device.position.y,
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
}
function onDragMove(e) {
    if (!dragging) return;
    const dx = (e.clientX - dragging.startX) / SCALE;
    const dy = (e.clientY - dragging.startY) / SCALE;
    updateDevice(dragging.deviceId, {
        position: { x: dragging.origX + dx, y: dragging.origY + dy },
    });
}
function onDragUp() {
    dragging = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
}

// actions ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
function cycleRotation(device) {
    pushKineticUndo();
    updateDevice(device.id, { rotation: ROTATE_CYCLE[device.rotation] ?? 0 });
}

function handleAddDevice() {
    const position = computeAutoPosition(kinetic.devices, { newRotation: 0 });
    addDevice({ position, rotation: 0 });
}

// output port selection (live push) ––––––––––––––––––––––––––––––––
let availablePorts = $state([]);

async function refreshPorts() {
    try {
        availablePorts = await invoke('midi_list_outputs');
    } catch {
        availablePorts = [];
    }
}

async function handlePortChange(device, portName) {
    if (!portName) {
        await disconnectDeviceOutput(device.id);
        return;
    }
    try {
        await connectDeviceOutput(device.id, portName);
    } catch (err) {
        showToast?.(`Could not connect: ${err.message ?? err}`, 'error');
    }
}

function handleRemove(deviceId) {
    if (kinetic.devices.length <= 1) return; // always keep at least one device
    removeDevice(deviceId);
}

// mini preview grid ––––––––––––––––––––––––––––––––––––––––––––––––
// display row 0 = canvas y=9 (top), display row 9 = canvas y=0 (bottom)
function frameFor(deviceId) {
    return kineticPreview.framesByDevice.get(deviceId) ?? new Map();
}
function cellAt(row, col) {
    // display row 0 (top of the tile) -> local y=9 (physical top edge).
    return gridIndex.get(`${col},${9 - row}`) ?? null;
}
function padColour(frame, sysexPad) {
    const rgb = frame.get(sysexPad);
    if (!rgb) return 'rgba(255,255,255,0.05)'; // addressable but currently unlit
    const to8 = v => Math.round((v / 63) * 255);
    return `rgb(${to8(rgb[0])},${to8(rgb[1])},${to8(rgb[2])})`;
}
</script>

{#if open}
{refreshPorts()}
<div class="stg-overlay" onclick={() => open = false}>
    <div class="stg-modal" onclick={e => e.stopPropagation()}>
        <div class="stg-header">
            <h2 class="stg-title">Stage</h2>
            <button class="al-icon-btn" onclick={() => open = false}>✕</button>
        </div>
        <p class="al-hint-text" style="margin-bottom:14px">
            Drag devices to arrange them the way they physically sit on your desk.
            New devices are placed automatically, dragging overrides that for just
            that device.
        </p>

        <div class="stg-canvas-wrap">
            <div class="stg-canvas">
                {#each kinetic.devices as device (device.id)}
                    {@const fp = footprintFor(device)}
                    {@const frame = frameFor(device.id)}
                    <div
                        class="stg-device {device.isPrimary ? 'primary' : ''} {device.enabled ? '' : 'disabled'}"
                        style="left:{device.position.x * SCALE}px; top:{device.position.y * SCALE}px;
                               width:{fp.width * SCALE}px; height:{fp.height * SCALE}px;"
                        onpointerdown={e => onDevicePointerDown(e, device)}
                    >
                        <div class="stg-rotator" style="transform:rotate({device.rotation}deg)">
                            <div class="stg-mini-grid" style="grid-template-columns:repeat({MINI_GRID_SIZE},1fr); grid-template-rows:repeat({MINI_GRID_SIZE},1fr)">
                                {#each Array(MINI_GRID_SIZE) as _, row}
                                    {#each Array(MINI_GRID_SIZE) as _, col}
                                        {@const cell = cellAt(row, col)}
                                        {@const hasLight = cell && cell.sysexPad != null}
                                        <div class="stg-mini-pad"
                                            style="background:{hasLight ? padColour(frame, cell.sysexPad) : 'transparent'}"
                                            title={hasLight ? `sysex ${cell.sysexPad}` : ''}></div>
                                    {/each}
                                {/each}
                            </div>
                        </div>
                        <div class="stg-device-label">
                            {device.instanceNo}
                            {#if device.isPrimary}<span class="stg-primary-badge">★</span>{/if}
                        </div>
                    </div>
                {/each}
            </div>
        </div>

        <div class="stg-device-list">
            {#each kinetic.devices as device (device.id)}
                <div class="stg-device-row">
                    <span class="stg-device-id">{device.instanceNo}</span>
                    <div class="stg-device-controls">
                        <button class="al-btn al-btn-sm" onclick={() => cycleRotation(device)}>
                            ↻ {device.rotation}°
                        </button>
                        <button
                            class="al-btn al-btn-sm {device.isPrimary ? 'al-btn-blue' : ''}"
                            onclick={() => setPrimaryDevice(device.id)}
                        >{device.isPrimary ? '★ Primary' : 'Set primary'}</button>
                        <label class="al-toggle-wrap" style="margin:0 6px">
                            <input type="checkbox" checked={device.enabled}
                                onchange={e => { pushKineticUndo(); updateDevice(device.id, { enabled: e.target.checked }); }} />
                            <span class="al-dim">Enabled</span>
                        </label>
                        <label class="stg-logomode" title="Logo and mode both render live in preview; this picks which one gets exported.">
                            <span class="al-dim" style="font-size:10px">Export:</span>
                            <select class="al-select stg-logomode-select" value={device.logoOrMode}
                                onchange={e => { pushKineticUndo(); updateDevice(device.id, { logoOrMode: e.target.value }); }}>
                                <option value="logo">Logo</option>
                                <option value="mode">Mode</option>
                            </select>
                        </label>
                        <label class="stg-logomode" title="Palette snaps colours to the app's 128-colour palette for visual consistency. Sysex sends full 262,144-colour RGB directly to hardware.">
                            <span class="al-dim" style="font-size:10px">Display:</span>
                            <select class="al-select stg-logomode-select" value={device.displayMode}
                                onchange={e => { pushKineticUndo(); updateDevice(device.id, { displayMode: e.target.value }); }}>
                                <option value="palette">Palette</option>
                                <option value="sysex">Sysex (full colour)</option>
                            </select>
                        </label>
                        <label class="stg-logomode" title="Live output port">
                            <span class="al-dim" style="font-size:10px">Output:</span>
                            <select class="al-select stg-logomode-select" style="width:120px" value={device.outputPort ?? ''}
                                onchange={e => handlePortChange(device, e.target.value)}>
                                <option value="">None</option>
                                {#each availablePorts as port}
                                    <option value={port}>{port}</option>
                                {/each}
                            </select>
                        </label>
                        <button
                            class="al-btn al-btn-sm al-btn-danger"
                            disabled={kinetic.devices.length <= 1}
                            onclick={() => handleRemove(device.id)}
                        >Remove</button>
                    </div>
                </div>
            {/each}
        </div>

        <div class="stg-footer">
            <span class="al-dim" style="font-size:11px;margin-right:auto">
                {kinetic.devices.length} device{kinetic.devices.length === 1 ? '' : 's'}
            </span>
            <label class="stg-logomode" title="How often live-connected devices are pushed to real hardware. Independent of preview/render rate.">
                <span class="al-dim" style="font-size:10px">Push rate:</span>
                <select class="al-select stg-logomode-select" value={pushRateHz}
                    onchange={e => onPushRateChange(parseInt(e.target.value))}>
                    {#each LIVE_PUSH_RATE_PRESETS as hz}
                        <option value={hz}>{rateLabel(hz)}</option>
                    {/each}
                </select>
            </label>
            <button class="al-btn al-btn-blue" onclick={handleAddDevice}>+ Add device</button>
        </div>
    </div>
</div>
{/if}

<style>
.stg-overlay {
    position: fixed; inset: 0; z-index: 2200;
    display: flex; align-items: center; justify-content: center;
    background: var(--color-glass-overlay);
    backdrop-filter: blur(10px) saturate(1.2);
    -webkit-backdrop-filter: blur(10px) saturate(1.2);
    animation: al-overlay-in var(--duration-enter) var(--ease-out) both;
}
.stg-modal {
    background: var(--color-glass-modal);
    border: 1px solid var(--color-border-bright);
    border-radius: var(--radius-xl);
    padding: var(--space-6);
    width: min(92vw, 880px);
    max-height: 88vh;
    overflow-y: auto;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow: var(--shadow-modal);
    animation: al-modal-in var(--duration-enter) var(--ease-spring) both;
}
.stg-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2); }
.stg-title  { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); }

.stg-canvas-wrap {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: rgba(6,8,18,0.6);
    overflow: auto;
    margin-bottom: var(--space-4);
    padding: 16px;
}
.stg-canvas { position: relative; width: 100%; min-height: 240px; }

.stg-device {
    position: absolute;
    border: 1.5px solid rgba(255,255,255,0.18);
    border-radius: var(--radius-sm);
    cursor: grab;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: rgba(18,22,40,0.9);
    user-select: none;
}
.stg-device:active { cursor: grabbing; }
.stg-device.primary { border-color: var(--color-accent); box-shadow: var(--glow-accent); }
.stg-device.disabled { opacity: 0.4; }

.stg-rotator {
    display: flex;
    width: 100%;
    aspect-ratio: 1;
    flex-shrink: 0;
    transition: transform var(--duration-base, 200ms) var(--ease-smooth, ease);
}
.stg-mini-grid {
    display: grid;
    gap: 1px;
    flex: 1;
    padding: 3px;
}
.stg-mini-pad { border-radius: 1px; aspect-ratio: 1; }

.stg-device-label {
    font-size: 9px;
    font-family: 'Geist Mono', monospace;
    color: rgba(255,255,255,0.6);
    padding: 2px 4px;
    background: rgba(0,0,0,0.2);
    display: flex; align-items: center; gap: 3px;
}
.stg-primary-badge { color: var(--color-accent); }

.stg-device-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: var(--space-4); }
.stg-device-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.stg-device-id { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
.stg-logomode { display: flex; align-items: center; gap: 5px; margin: 0 4px; }
.stg-logomode-select { width: 68px; height: 26px; font-size: 11px; }
.stg-device-controls { display: flex; align-items: center; gap: 6px; }

.stg-footer { display: flex; align-items: center; gap: 8px; padding-top: var(--space-3); border-top: 1px solid var(--color-border); }
</style>