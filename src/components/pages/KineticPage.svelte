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
import { setDiscordContext } from '../../lib/aerolux/discord.js';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import {
    kinetic, getPrimaryDevice, currentInstances, currentWires, advancePlayhead, play, pause,
    availableGradients, initKineticLiveDisconnectListener, buildEngineContext
} from '../../stores/kinetic.svelte.js';
import { nodeDragGhost } from '../../stores/kineticUiSignals.svelte.js';
import { kineticPreview, tickPreview } from '../../stores/kineticPreview.svelte.js';
import { compileGraph } from '../../lib/aerolux/kinetic/compileGraph.js';
import { resolveField } from '../../lib/aerolux/kinetic/nodeRegistry.js';
import { exportDeviceToMidi } from '../../lib/aerolux/kinetic/midiExport.js';
import { getDeviceGrid } from '../../lib/aerolux/kinetic/sampleDevice.js';
import { startLivePushDriver, stopLivePushDriver } from '../../lib/aerolux/kinetic/livePush.js';
import { editor } from '../../stores/velocity.svelte.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { hapticSnap } from '../../lib/aerolux/haptics.js';
import NodeGraph from '../studio/NodeGraph.svelte';
import NodeMenu from '../studio/NodeMenu.svelte';
import NodeInspector from '../studio/NodeInspector.svelte';
import SplinePanel from '../studio/SplinePanel.svelte';
import TransportBar from '../studio/TransportBar.svelte';
import MultiDevicePreview from '../studio/MultiDevicePreview.svelte';
import StageModal from '../modals/StageModal.svelte';
import { setActiveEditor } from '../../stores/projects.svelte.js';

let stageOpen = $state(false);
let exporting = $state(false);
let baking = $state(false);
let multiSelectCount = $state(0);
let nodeGraphRef = $state(null);

let nodeMenuWidth = $state(220);
let inspectorWidth = $state(300);

let graphWidth = $state(50);
let contentHeight = $state(55);

let nodeMenuVisible = $state(true);

const RESIZE_SNAP_THRESHOLD = {
    px: 18,
    graph: 3,
    content: 2.5,
};

const DEFAULT_LAYOUT = {
    nodeMenuWidth: 220,
    inspectorWidth: 300,
    graphWidth: 50,
    contentHeight: 55,
};
 
let rafId = null;
let lastFrameTime = null;
 
function loop(now) {
    if (lastFrameTime == null) lastFrameTime = now;
    const dtSeconds = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    advancePlayhead(dtSeconds);
    tickPreview(kinetic.transport.playheadTick, kinetic.transport.playing ? dtSeconds : 0);
    rafId = requestAnimationFrame(loop);
}
 
onMount(() => { rafId = requestAnimationFrame(loop); });
onDestroy(() => { if (rafId) cancelAnimationFrame(rafId); });
 
// live-push driver: independent fixed-interval loop, samples/sends to any
// device with a real outputPort connected. context is re-read fresh every
// tick rather than captured once, so it always reflects the live store.
onMount(() => {
    initKineticLiveDisconnectListener();
    startLivePushDriver(() => buildEngineContext(kinetic.transport.playheadTick));
});
onDestroy(() => stopLivePushDriver());

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
    if (e.code === 'Backslash' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleNodeMenu();
        return;
    }
}
onMount(() => { 
    setDiscordContext('kinetic'); 
    window.addEventListener('keydown', onGlobalKeyDown); 
    setActiveEditor('kinetic'); 
});
onDestroy(() => window.removeEventListener('keydown', onGlobalKeyDown));
 
// header actions –––––––––––––––––––––––––––––––––––––––––––––––––––
async function handleBakeClick() {
    if (multiSelectCount < 1) {
        showToast('Select one or more nodes in the graph first (Shift/Cmd-click)', 'info', 3500);
        return;
    }
    if (!nodeGraphRef || baking) return;
    baking = true;
    // the "Baking..." label paints before bake.js's loop blocks the main thread 
    // so it always gives feedback that it's working in the background. otherwise
    // a slow bake gives zero visual feedback that anything happened at all.
    await new Promise(requestAnimationFrame);
    try {
        nodeGraphRef.bakeCurrentSelection();
    } finally {
        baking = false;
    }
}
 
async function handleExport() {
    exporting = true;
    try {
        const context = { palette: editor.palette, devices: kinetic.devices, gradients: availableGradients.map };
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
                defaultPath: `${device.instanceNo.toLowerCase().replace(/\s+/g, '_')}_${device.id.slice(-6)}.mid`,
                filters: [{ name: 'MIDI', extensions: ['mid'] }],
            });
            if (!path) continue; // user cancelled this device's dialog = skip
 
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

// resizing –––––––––––––––––––––––––––––––––––––––––––––––––––––––––

function snapValue(value, target, threshold) {
    const snapped = Math.abs(value - target) <= threshold;
    return {
        value: snapped ? target : value,
        snapped,
    };
}

function startResize(event, type) {
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;

    const startNodeMenuWidth = nodeMenuWidth;
    const startInspectorWidth = inspectorWidth;
    const startGraphWidth = graphWidth;
    const startContentHeight = contentHeight;

    let wasSnapped = false;

    function applySnap(value, target, threshold, e) {
        if (e.shiftKey) {
            wasSnapped = false;
            return value;
        }
        const result = snapValue(value, target, threshold);
        if (result.snapped && !wasSnapped) { hapticSnap(); }
        wasSnapped = result.snapped;
        return result.value;
    }

    function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (type === 'node-menu') {
            let width = clamp(startNodeMenuWidth + dx, 160, 420);
            width = applySnap(
                width,
                DEFAULT_LAYOUT.nodeMenuWidth,
                RESIZE_SNAP_THRESHOLD.px,
                e
            );
            nodeMenuWidth = width;
        }

        if (type === 'inspector') {
            let width = clamp(startInspectorWidth - dx, 220, 500);
            width = applySnap(
                width,
                DEFAULT_LAYOUT.inspectorWidth,
                RESIZE_SNAP_THRESHOLD.px,
                e
            );
            inspectorWidth = width;
        }

        if (type === 'graph') {
            const bottomRow = document.querySelector('.kp-bottom-row');
            if (!bottomRow) return;
            const width = bottomRow.getBoundingClientRect().width;
            let value = startGraphWidth + (dx / width) * 100;
            value = clamp(value, 25, 75);
            value = applySnap(
                value,
                DEFAULT_LAYOUT.graphWidth,
                RESIZE_SNAP_THRESHOLD.graph,
                e
            );
            graphWidth = value;
        }

        if (type === 'content-height') {
            const shell = document.querySelector('.kp-shell');
            if (!shell) return;
            const height = shell.getBoundingClientRect().height;
            let value = startContentHeight + (dy / height) * 100;
            value = clamp(value, 35, 75);
            value = applySnap(
                value,
                DEFAULT_LAYOUT.contentHeight,
                RESIZE_SNAP_THRESHOLD.content,
                e
            );
            contentHeight = value;
        }
    }

    function stopResize() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', stopResize);
        document.body.classList.remove('is-resizing');
    }
    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stopResize);
}

function resetResize(type) {
    switch (type) {
        case 'node-menu':
            nodeMenuWidth = DEFAULT_LAYOUT.nodeMenuWidth;
            break;

        case 'inspector':
            inspectorWidth = DEFAULT_LAYOUT.inspectorWidth;
            break;

        case 'graph':
            graphWidth = DEFAULT_LAYOUT.graphWidth;
            break;

        case 'content-height':
            contentHeight = DEFAULT_LAYOUT.contentHeight;
            break;
    }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function toggleNodeMenu() {
    nodeMenuVisible = !nodeMenuVisible;
}

</script>
 
<div class="kp-shell" style="--content-height: {contentHeight}vh;">
 
    <header class="al-header">
        <div class="al-header-brand">
            <span class="al-logo-text">Kine<span class="al-logo-accent">tic</span></span>
            <span class="al-logo-sub" style="font-size:8px">Lights studio</span>
        </div>
        <div class="al-header-actions">
            <button class="al-btn" onclick={() => stageOpen = true}>🖵 Stage</button>
            <button
                class="al-btn al-btn-green"
                onclick={handleBakeClick}
                disabled={multiSelectCount < 1 || baking}
                title={multiSelectCount < 1 ? 'Select nodes in the graph first (Shift/Cmd-click)' : 'Group and bake the current selection'}
            >
                {baking ? 'Baking…' : '⬢ Bake'}
            </button>
            <button class="al-btn al-btn-blue" onclick={handleExport} disabled={exporting}>
                {exporting ? 'Exporting…' : '⬇ Export'}
            </button>
        </div>
    </header>
 
    <div 
    class="kp-content-row" 
    class:node-menu-hidden={!nodeMenuVisible} 
    style="--node-menu-width: {nodeMenuWidth}px; --inspector-width: {inspectorWidth}px;"
    >
        <aside class="kp-nodemenu">
            <NodeMenu />
        </aside>

        <div
            class="kp-resize-handle kp-resize-handle-vertical kp-resize-node-menu"
            role="separator" aria-label="Resize node menu"
            onpointerdown={(e) => startResize(e, 'node-menu')}
            ondblclick={() => resetResize('node-menu')}
        ></div>

        <div class="kp-preview">
            {#if kinetic.devices.length > 1}
                <p class="al-hint-text" style="text-align:center;padding-top:6px">
                    {kinetic.devices.length} devices on the Stage.
                </p>
            {/if}

            <MultiDevicePreview />
        </div>

        <div
            class="kp-resize-handle kp-resize-handle-vertical kp-resize-inspector"
            role="separator" aria-label="Resize inspector"
            onpointerdown={(e) => startResize(e, 'inspector')}
            ondblclick={() => resetResize('inspector')}
        ></div>

        <aside class="kp-inspector">
            <NodeInspector />
        </aside>
    </div>
 
    <div
        class="kp-resize-handle kp-resize-handle-horizontal"
        role="separator" aria-label="Resize upper panels"
        onpointerdown={(e) => startResize(e, 'content-height')}
        ondblclick={() => resetResize('content-height')}
    ></div>

    <div class="kp-transport">
        <TransportBar />
    </div>
 
    <div class="kp-bottom-row" style="--graph-width: {graphWidth}%;">
        <div class="kp-graph">
            <NodeGraph
                bind:this={nodeGraphRef}
                bind:boundMultiSelectCount={multiSelectCount}
            />
        </div>

        <div
            class="kp-resize-handle kp-resize-handle-vertical kp-resize-graph"
            role="separator" aria-label="Resize node graph"
            onpointerdown={(e) => startResize(e, 'graph')}
            ondblclick={() => resetResize('graph')}
        ></div>

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
    display: grid;
    grid-template-rows:
        56px
        minmax(260px, var(--content-height))
        6px
        auto
        minmax(220px, 1fr);
    height: 100vh;
    overflow: hidden;
}
 
.kp-content-row {
    position: relative;
    display: grid;
    grid-template-columns:
        var(--node-menu-width)
        6px
        minmax(0, 1fr)
        6px
        var(--inspector-width);
    min-height: 0;
}

.kp-content-row.node-menu-hidden {
    grid-template-columns:
        minmax(0, 1fr)
        6px
        var(--inspector-width);
}
 
.kp-nodemenu {
    border-right: 1px solid var(--color-border);
    background: var(--color-surface-0);
    overflow: hidden;
    min-height: 0;
    min-width: 0;
}
 
.kp-content-row.node-menu-hidden .kp-nodemenu,
.kp-content-row.node-menu-hidden .kp-resize-node-menu {
    display: none;
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
    position: relative;
    display: grid;
    grid-template-columns:
        var(--graph-width)
        6px
        minmax(0, 1fr);
    min-height: 0;
}

.kp-resize-handle {
    position: relative;
    z-index: 20;
    background: transparent;
    touch-action: none;
    user-select: none;
}

.kp-resize-handle::after {
    content: '';
    position: absolute;
    opacity: 0;
    background: var(--color-border-bright);
    transition:
        opacity 120ms ease,
        transform 120ms ease;
}

.kp-resize-handle:hover::after,
.kp-resize-handle:active::after {
    opacity: 1;
}

.kp-resize-handle-vertical {
    cursor: col-resize;
}
.kp-resize-handle-vertical::after {
    top: 0;
    bottom: 0;
    left: 2px;
    width: 2px;
}

.kp-resize-handle-horizontal {
    height: 6px;
    cursor: row-resize;
}
.kp-resize-handle-horizontal::after {
    left: 0;
    right: 0;
    top: 2px;
    height: 2px;
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