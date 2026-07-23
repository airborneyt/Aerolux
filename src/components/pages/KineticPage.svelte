<!-- src/components/pages/KineticPage.svelte -->
<!--
    [Kinetic]                              [Stage] [Bake] [Export]        <- header
    [Node Menu]       [Virtual Launchpads (hero)]      [Inspector]        <- content row
    [Play/Pause/Wind Timeline options –––––––––––––––––––––––––––]        <- transport bar
    [Node Graph ––––––––––––––––] [Spline graphs ––––––––––––––––]        <- bottom row

    Node Menu / Inspector / hero preview all scroll internally and share
    the same row height. the bottom row is a separate full-width 50/50 split
    (Node Graph | Spline Panel) that isn't tied to the content row's column 
    widths above it.

    the preview tick loop advances the real transport (kinetic.transport)
    every frame regardless of play/pause state, so tickPreview always
    samples at the current playhead position. this is what makes
    scrubbing while paused (or a live param edit on an unbaked composite)
    show up immediately and not just while playing.

    uses @tauri-apps/plugin-dialog / plugin-fs for export.
-->
<script>
import { onMount, onDestroy } from 'svelte';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import {
    kinetic, getPrimaryDevice, currentInstances, currentWires, advancePlayhead, play, pause, deviceLabel,
} from '../../stores/kinetic.svelte.js';
import { nodeDragGhost } from '../../stores/kineticUiSignals.svelte.js';
import { kineticPreview, tickPreview } from '../../stores/kineticPreview.svelte.js';
import { compileGraph } from '../../lib/aerolux/kinetic/compileGraph.js';
import { resolveField } from '../../lib/aerolux/kinetic/nodeRegistry.js';
import { exportDeviceToMidi } from '../../lib/aerolux/kinetic/midiExport.js';
import { getDeviceGrid } from '../../lib/aerolux/kinetic/sampleDevice.js';
import { editor } from '../../stores/velocity.svelte.js';
import { showToast } from '../../lib/aerolux/toast.js';
import NodeGraph from '../studio/NodeGraph.svelte';
import NodeMenu from '../studio/NodeMenu.svelte';
import NodeInspector from '../studio/NodeInspector.svelte';
import SplinePanel from '../studio/SplinePanel.svelte';
import TransportBar from '../studio/TransportBar.svelte';
import MultiDevicePreview from '../studio/MultiDevicePreview.svelte';
import StageModal from '../modals/StageModal.svelte';

let stageOpen = $state(false);
let exporting = $state(false);
let baking = $state(false);
let multiSelectCount = $state(0);
let nodeGraphRef = $state(null);

let rafId = null;
let lastFrameTime = null;

function loop(now) {
    if (lastFrameTime == null) lastFrameTime = now;
    const dtSeconds = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    advancePlayhead(dtSeconds); // no-op while paused
    tickPreview(kinetic.transport.playheadTick);
    rafId = requestAnimationFrame(loop);
}

onMount(() => { rafId = requestAnimationFrame(loop); });
onDestroy(() => { if (rafId) cancelAnimationFrame(rafId); });

// global spacebar play/pause –––––––––––––––––––––––––––––––––––––––
function isTyping(e) {
    const tag = e.target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
}
function onGlobalKeyDown(e) {
    if (isTyping(e)) return;
    if (e.code === 'Space') {
        e.preventDefault();
        kinetic.transport.playing ? pause() : play();
    }
}
onMount(() => window.addEventListener('keydown', onGlobalKeyDown));
onDestroy(() => window.removeEventListener('keydown', onGlobalKeyDown));

// header actions –––––––––––––––––––––––––––––––––––––––––––––––––––
async function handleBakeClick() {
    if (multiSelectCount < 1) {
        showToast('Select one or more nodes in the graph first (Shift/Cmd-click)', 'info', 3500);
        return;
    }
    if (!nodeGraphRef || baking) return;
    baking = true;
    // let the "Baking…" label actually paint before the synchronous
    // precompute (bake.js's loop) blocks the main thread. otherwise a
    // slow bake gives zero visual feedback that anything happened at all.
    await new Promise(requestAnimationFrame);
    try {
        nodeGraphRef.bakeCurrentSelection();
    } finally {
        baking = false;
    }
}

// one .mid file per device
async function handleExport() {
    exporting = true;
    try {
        const context = { palette: editor.palette, devices: kinetic.devices };
        const compiled = compileGraph(currentInstances(), currentWires(), context, resolveField);
        const enabledDevices = kinetic.devices.filter(d => d.enabled);

        let exportedCount = 0;
        for (const device of enabledDevices) {
            const grid = getDeviceGrid();
            const bytes = exportDeviceToMidi(device, grid, compiled.outputs, {
                totalDuration: kinetic.transport.totalDuration, tickStep: 4, palette: editor.palette,
                timeDiv: kinetic.transport.timeDiv, bpm: kinetic.transport.bpm,
            });

            const path = await save({
                defaultPath: `${deviceLabel(device).toLowerCase().replace(/\s+/g, '_')}_${device.instanceNo}.mid`,
                filters: [{ name: 'MIDI', extensions: ['mid'] }],
            });
            if (!path) continue; // user cancelled this device's dialog = skip, don't abort the rest

            await writeFile(path, bytes);
            exportedCount++;
        }

        if (exportedCount > 0) showToast(`Exported ${exportedCount} device file(s)`, 'success');
        else showToast('Export cancelled', 'info');
    } catch (err) {
        showToast(`Export failed: ${err.message}`, 'error');
    } finally {
        exporting = false;
    }
}
</script>

<div class="kp-shell">

    <header class="kp-header">
        <span class="kp-title">Kinetic</span>
        <div class="kp-header-actions">
            <button class="al-btn al-btn-sm" onclick={() => stageOpen = true}>🖵 Stage</button>
            <button
                class="al-btn al-btn-sm al-btn-green"
                onclick={handleBakeClick}
                disabled={multiSelectCount < 1 || baking}
                title={multiSelectCount < 1 ? 'Select nodes in the graph first (Shift/Cmd-click)' : 'Group and bake the current selection'}
            >
                {baking ? 'Baking…' : '⬢ Bake'}
            </button>
            <button class="al-btn al-btn-sm al-btn-blue" onclick={handleExport} disabled={exporting}>
                {exporting ? 'Exporting…' : '⬇ Export'}
            </button>
        </div>
    </header>

    <div class="kp-content-row">
        <aside class="kp-nodemenu">
            <NodeMenu />
        </aside>

        <div class="kp-preview">
            {#if kinetic.devices.length > 1}
                <p class="al-hint-text" style="text-align:center;padding-top:6px">{kinetic.devices.length} devices on the Stage.</p>
            {/if}
            <MultiDevicePreview />
        </div>

        <aside class="kp-inspector">
            <NodeInspector />
        </aside>
    </div>

    <div class="kp-transport">
        <TransportBar />
    </div>

    <div class="kp-bottom-row">
        <div class="kp-graph">
            <NodeGraph bind:this={nodeGraphRef} bind:boundMultiSelectCount={multiSelectCount} />
        </div>
        <div class="kp-spline">
            <SplinePanel />
        </div>
    </div>

</div>

{#if nodeDragGhost.active}
    <div class="kp-drag-ghost" style="left:{nodeDragGhost.x}px; top:{nodeDragGhost.y}px">
        <span class="kp-drag-ghost-icon">{nodeDragGhost.icon}</span>
        <span>{nodeDragGhost.label}</span>
    </div>
{/if}

<StageModal bind:open={stageOpen} />

<style>
.kp-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
}

.kp-header {
    flex-shrink: 0;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-glass-header);
}
.kp-title { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.kp-header-actions { display: flex; gap: 8px; }

.kp-content-row {
    display: grid;
    grid-template-columns: 220px 1fr 300px;
    flex: 1 1 55vh;
    min-height: 0;
}

.kp-nodemenu {
    border-right: 1px solid var(--color-border);
    background: var(--color-surface-0);
    overflow: hidden;
    min-height: 0;
}

.kp-preview {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.kp-inspector {
    border-left: 1px solid var(--color-border);
    background: var(--color-surface-0);
    overflow-y: auto;
    padding: 14px;
    min-height: 0;
}

.kp-transport { flex-shrink: 0; }

.kp-bottom-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    flex: 1 1 35vh;
    min-height: 0;
}

.kp-graph {
    position: relative;
    overflow: hidden;
    border-right: 1px solid var(--color-border);
    border-top: 1px solid var(--color-border);
}
.kp-spline {
    overflow: hidden;
    border-top: 1px solid var(--color-border);
}

.kp-drag-ghost {
    position:        fixed;
    z-index:         9999;
    transform:       translate(-50%, -130%);
    display:         flex;
    align-items:     center;
    gap:             6px;
    padding:         5px 10px;
    border-radius:   var(--radius-md);
    background:      var(--color-glass-modal);
    border:          1px solid var(--color-border-bright);
    box-shadow:      var(--shadow-modal);
    backdrop-filter: blur(10px);
    font-size:       12px;
    font-weight:     500;
    color:           var(--color-text);
    pointer-events:  none;
    white-space:     nowrap;
}
.kp-drag-ghost-icon { opacity: 0.85; }
</style>