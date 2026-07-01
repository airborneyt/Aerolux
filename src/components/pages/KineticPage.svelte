<script>
import { onMount, onDestroy } from 'svelte';
import { save }      from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import {
    kinetic,
    selectedNode,
    addNode,
    removeNode,
    addWire,
    removeWire,
    setParam,
    toggleNode,
    moveNode,
    play,
    stop,
    seek,
    bakeToMidi,
    padPress,
    padRelease,
    availableGradients,
} from '../../stores/kinetic.svelte.js';
import { NODE_BY_ID, getMenuGroups, processGraph } from '../../lib/aerolux/nodeRegistry.js';
import { noteToSysex } from '../../lib/aerolux/midi-layout.js';
import { editor } from '../../stores/velocity.svelte.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { playSound } from '../../lib/aerolux/sound.js';

import VirtualLP     from '../shared/VirtualLP.svelte';
import NodeMenu      from '../studio/NodeMenu.svelte';
import NodeInspector from '../studio/NodeInspector.svelte';
import SplinePointsControl from '../studio/controls/SplinePointsControl.svelte';

// ── LP preview ────────────────────────────────────────────────────
// Derive a sysexColors Map from kinetic's current frame output.
// The kinetic store should expose a `currentFrame` — a Map<sysexPad, [r6,g6,b6]>
// produced by the generator/transform pipeline each tick.
const sysexColors = $derived(kinetic.currentFrame ?? new Map());

// Build a sysexColors map from pressedPads only for now.
// Real processed output connects here once processors are wired in.
const lpColors = $derived.by(() => {

    const events = processGraph(
        kinetic.nodeInstances,
        graphContext()
    );

    const map = new Map();

    // Show state at current playhead position
    const tick = kinetic.playheadTick;

    for (const ev of events) {

        // Ignore future events
        if (ev.absTime > tick)
            continue;

        // Ignore invalid notes
        if (ev.noteNum == null)
            continue;

        const sx = noteToSysex(ev.noteNum, kinetic.device);
        if (sx === null)
            continue;

        // Final pad state
        map.set(sx, colourForVelocity(ev.velocity));
    }

    return map;
});

function graphContext() {
    return {
        device: kinetic.device,
        palette: editor.palette,
        gradients: availableGradients.map,
        totalDuration: kinetic.totalDuration,
        timeDiv: kinetic.timeDiv,
        bpm: kinetic.bpm,
        wires: kinetic.wires,
        loadedClips: kinetic.loadedClips,
    };
}

function colourForVelocity(velocity) {
    const c = editor.palette?.[velocity] ?? editor.palette?.[0];
    return Array.isArray(c) ? c : [c?.r ?? 63, c?.g ?? 63, c?.b ?? 63];
}

// ── Playhead time display ─────────────────────────────────────────
const playheadDisplay = $derived.by(() => {
    const td   = kinetic.timeDiv || 96;
    const tpb  = td * 4;
    const bar  = Math.floor(kinetic.playheadTick / tpb) + 1;
    const beat = Math.floor((kinetic.playheadTick % tpb) / td) + 1;
    return `${bar}.${beat}`;
});

// ── Node graph: pan / zoom ────────────────────────────────────────
let graphPan  = $state({ x: 40, y: 40 });
let graphZoom = $state(1);
let isPanning = false;
let panStart  = { x: 0, y: 0 };
let panBase   = { x: 0, y: 0 };

// local clipboard for copy/paste of node instances
let _clipboard = null;

function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    const tag = t.tagName;
    if (!tag) return false;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (t.isContentEditable) return true;
    return false;
}

function handleKeyDown(e) {
    // ignore when typing in inputs
    if (isTyping(e)) return;

    const cmd = e.metaKey || e.ctrlKey;

    // Play / pause with Space
    if (e.code === 'Space') {
        e.preventDefault();
        if (kinetic.playing) stop();
        else if (e.shiftKey && kinetic.playheadTick !== 0 ) {
            stop;
            seek(0);
        }
        else play();
        return;
    }

    // Nudge playhead
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const step = (e.shiftKey && cmd ? (kinetic.timeDiv || 96) / 4 : e.shiftKey ? (kinetic.timeDiv || 96) * 4 : (kinetic.timeDiv || 96));
        const dir = e.code === 'ArrowLeft' ? -1 : 1;
        seek(kinetic.playheadTick + dir * step);
        return;
    }

    // Home / End
    if (e.code === 'Home') { e.preventDefault(); seek(0); return; }
    if (e.code === 'End')  { e.preventDefault(); seek(kinetic.totalDuration); return; }

    // Delete selected node
    if ((e.key === 'Delete' || e.key === 'Backspace') && kinetic.selectedInstanceId) {
        e.preventDefault(); removeNode(kinetic.selectedInstanceId); return;
    }

    // Copy / Paste nodes
    if (cmd && e.key.toLowerCase() === 'c' && kinetic.selectedInstanceId) {
        e.preventDefault();
        const inst = kinetic.nodeInstances.find(n => n.instanceId === kinetic.selectedInstanceId);
        if (inst) {
            _clipboard = JSON.parse(JSON.stringify(inst));
            showToast('Copied node', 'success');
        }
        return;
    }

    if (cmd && e.key.toLowerCase() === 'v' && _clipboard) {
        e.preventDefault();
        const desc = NODE_BY_ID[_clipboard.nodeId];
        if (!desc) { showToast('Cannot paste: node type missing', 'error'); return; }
        const pos = { x: (_clipboard.position?.x ?? 120) + 24, y: (_clipboard.position?.y ?? 120) + 24 };
        const inst = addNode(desc, pos);
        // copy params
        for (const k of Object.keys(_clipboard.params ?? {})) {
            setParam(inst.instanceId, k, JSON.parse(JSON.stringify(_clipboard.params[k])));
        }
        // copy clip data if present
        if (_clipboard.params?.clipData) {
            kinetic.loadedClips[inst.instanceId] = JSON.parse(JSON.stringify(_clipboard.params.clipData));
        }
        showToast('Pasted node', 'success');
        return;
    }

    // Toggle panels
    if (e.key.toLowerCase() === 'i') { inspectorOpen = !inspectorOpen; return; }
    if (e.key.toLowerCase() === 'm') { menuOpen = !menuOpen; return; }

    // Zoom graph
    if (e.key === '=') { graphZoom = Math.min(3, graphZoom * 1.1); return; }
    if (e.key === '-') { graphZoom = Math.max(0.25, graphZoom / 1.1); return; }
    if (e.key === '0') { graphZoom = 1; return; }
}

onMount(() => window.addEventListener('keydown', handleKeyDown));
onDestroy(() => window.removeEventListener('keydown', handleKeyDown));

// ── Node graph: dragging ──────────────────────────────────────────
let nodeDrag = null;
// { instanceId, startX, startY, origX, origY }

// ── Node graph: wires ─────────────────────────────────────────────
// While user drags from an output port:
let pendingWire = $state(null);
// { fromId, fromPort, sx, sy, cx, cy }  (sx/sy = screen start, cx/cy = screen current)

// ── Node graph: search ────────────────────────────────────────────
let searchOpen   = $state(false);
let searchQuery  = $state('');
let searchGX     = $state(0);  // graph coords where dblclick happened
let searchGY     = $state(0);

const allGroups = getMenuGroups();
const searchResults = $derived(
    searchQuery.trim() === ''
        ? allGroups.flatMap(g => g.nodes)
        : allGroups.flatMap(g => g.nodes).filter(n =>
            n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            n.category.toLowerCase().includes(searchQuery.toLowerCase())
          )
);

// ── Graph SVG ref ─────────────────────────────────────────────────
let svgEl = $state(null);

function svgToGraph(sx, sy) {
    return {
        x: (sx - graphPan.x) / graphZoom,
        y: (sy - graphPan.y) / graphZoom,
    };
}

function graphToSvg(gx, gy) {
    return {
        x: gx * graphZoom + graphPan.x,
        y: gy * graphZoom + graphPan.y,
    };
}

// ── Node card dimensions ──────────────────────────────────────────
const NODE_W      = 192;
const NODE_H_BASE = 64;
const PARAM_H     = 14;

function nodeH(desc) {
    if (!desc) return NODE_H_BASE;
    return NODE_H_BASE + Math.min(3, Object.keys(desc.params ?? {}).length) * PARAM_H;
}

// Compute port positions in graph coords
function portPos(instance, port) {
    const desc = NODE_BY_ID[instance.nodeId];
    const gx   = instance.position?.x ?? 0;
    const gy   = instance.position?.y ?? 0;
    const h    = nodeH(desc);
    if (port === 'output') return { x: gx + NODE_W, y: gy + h * 0.5 };
    if (port === 'input')  return { x: gx,          y: gy + h * 0.35 };
    if (port === 'inputB') return { x: gx,          y: gy + h * 0.65 };
    return { x: gx, y: gy };
}

// ── SVG event handlers ────────────────────────────────────────────
function onSvgPointerDown(e) {
    const target = e.target;
    // Only pan when clicking the background or the bg rect
    if (target === svgEl || target.classList.contains('kg-bg')) {
        if (e.button === 0) {
            isPanning = true;
            panStart  = { x: e.clientX, y: e.clientY };
            panBase   = { ...graphPan };
            svgEl.style.cursor = 'grabbing';
        }
        if (searchOpen) searchOpen = false;
    }
}

function onSvgPointerMove(e) {
    if (isPanning) {
        graphPan = {
            x: panBase.x + (e.clientX - panStart.x),
            y: panBase.y + (e.clientY - panStart.y),
        };
    }
    if (pendingWire) {
        const rect  = svgEl.getBoundingClientRect();
        pendingWire = {
            ...pendingWire,
            cx: e.clientX - rect.left,
            cy: e.clientY - rect.top,
        };
    }
}

function onSvgPointerUp(e) {
    isPanning = false;
    if (svgEl) svgEl.style.cursor = '';
    if (pendingWire) pendingWire = null;
}

function onSvgWheel(e) {
    e.preventDefault();
    const rect    = svgEl.getBoundingClientRect();
    const mx      = e.clientX - rect.left;
    const my      = e.clientY - rect.top;
    const factor  = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.25, Math.min(3, graphZoom * factor));
    graphPan  = {
        x: mx - (mx - graphPan.x) * (newZoom / graphZoom),
        y: my - (my - graphPan.y) * (newZoom / graphZoom),
    };
    graphZoom = newZoom;
}

function onSvgDblClick(e) {
    if (e.target === svgEl || e.target.classList.contains('kg-bg')) {
        const rect  = svgEl.getBoundingClientRect();
        const gp    = svgToGraph(e.clientX - rect.left, e.clientY - rect.top);
        searchGX    = gp.x;
        searchGY    = gp.y;
        searchOpen  = true;
        searchQuery = '';
    }
}

// ── Node drag ─────────────────────────────────────────────────────
function onNodePointerDown(e, instanceId) {
    e.stopPropagation();
    if (e.button !== 0) return;
    kinetic.selectedInstanceId = instanceId;
    const inst = kinetic.nodeInstances.find(n => n.instanceId === instanceId);
    if (!inst) return;
    nodeDrag = {
        instanceId,
        startX: e.clientX,
        startY: e.clientY,
        origX:  inst.position?.x ?? 0,
        origY:  inst.position?.y ?? 0,
    };
    window.addEventListener('pointermove', onNodeDragMove);
    window.addEventListener('pointerup',   onNodeDragUp);
}

function onNodeDragMove(e) {
    if (!nodeDrag) return;
    const dx = (e.clientX - nodeDrag.startX) / graphZoom;
    const dy = (e.clientY - nodeDrag.startY) / graphZoom;
    moveNode(nodeDrag.instanceId, nodeDrag.origX + dx, nodeDrag.origY + dy);
}

function onNodeDragUp() {
    nodeDrag = null;
    window.removeEventListener('pointermove', onNodeDragMove);
    window.removeEventListener('pointerup',   onNodeDragUp);
}

// ── Port interactions ─────────────────────────────────────────────
function onOutputPortDown(e, instanceId) {
    e.stopPropagation();
    const rect = svgEl.getBoundingClientRect();
    const inst = kinetic.nodeInstances.find(n => n.instanceId === instanceId);
    if (!inst) return;
    const pos  = portPos(inst, 'output');
    const sp   = graphToSvg(pos.x, pos.y);
    pendingWire = {
        fromId:   instanceId,
        fromPort: 'output',
        sx: sp.x, sy: sp.y,
        cx: e.clientX - rect.left,
        cy: e.clientY - rect.top,
    };
}

function onInputPortUp(e, instanceId, port) {
    e.stopPropagation();
    if (!pendingWire || pendingWire.fromId === instanceId) {
        pendingWire = null;
        return;
    }
    addWire(pendingWire.fromId, pendingWire.fromPort, instanceId, port);
    pendingWire = null;
}

// ── Wire path helper ──────────────────────────────────────────────
function wirePath(x1, y1, x2, y2) {
    const cx = Math.abs(x2 - x1) * 0.55;
    return `M ${x1} ${y1} C ${x1+cx} ${y1}, ${x2-cx} ${y2}, ${x2} ${y2}`;
}

// ── Context menu ──────────────────────────────────────────────────
let ctxMenu = $state(null);  // { x, y, instanceId }

function onNodeRightClick(e, instanceId) {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = { x: e.clientX, y: e.clientY, instanceId };
}

// ── Graph drop (from NodeMenu) ────────────────────────────────────
function onGraphDrop(e) {
    e.preventDefault();
    const nodeId = e.dataTransfer?.getData('aerolux/nodeId');
    if (!nodeId) return;
    const desc = NODE_BY_ID[nodeId];
    if (!desc) return;
    const rect = svgEl.getBoundingClientRect();
    const gp   = svgToGraph(e.clientX - rect.left, e.clientY - rect.top);
    addNode(desc, gp);
}

// ── Search add ────────────────────────────────────────────────────
function addFromSearch(desc) {
    addNode(desc, { x: searchGX, y: searchGY });
    searchOpen  = false;
    searchQuery = '';
}

// ── Timeline ──────────────────────────────────────────────────────
let timelineH  = $state(180);  // px
let splitDrag  = false;
let splitY0    = 0;
let splitH0    = 0;

function onSplitDown(e) {
    splitDrag = true;
    splitY0   = e.clientY;
    splitH0   = timelineH;
    window.addEventListener('pointermove', onSplitMove);
    window.addEventListener('pointerup',   onSplitUp);
}
function onSplitMove(e) {
    if (!splitDrag) return;
    timelineH = Math.max(60, Math.min(480, splitH0 - (e.clientY - splitY0)));
}
function onSplitUp() {
    splitDrag = false;
    window.removeEventListener('pointermove', onSplitMove);
    window.removeEventListener('pointerup',   onSplitUp);
}

// ── Timeline zoom ─────────────────────────────────────────────────
let tlZoom   = $state(1);
let tlScroll = $state(0);

const LABEL_W   = 130;
const ROW_H     = 30;
const RULER_H   = 22;
const PX_PER_TK = 0.08;

function tickToPx(t)  { return t * PX_PER_TK * tlZoom; }
function pxToTick(px) { return px / (PX_PER_TK * tlZoom); }
const totalTlW = $derived(tickToPx(kinetic.totalDuration) + 100);

// Ruler beat marks
const rulerMarks = $derived.by(() => {
    const td   = kinetic.timeDiv || 96;
    const tpb  = td * 4;
    const step = tlZoom < 0.5 ? tpb * 4 : tlZoom < 1.2 ? tpb : td;
    const marks = [];
    for (let t = 0; t <= kinetic.totalDuration; t += step) {
        const bar  = Math.floor(t / tpb) + 1;
        const beat = Math.floor((t % tpb) / td) + 1;
        marks.push({ t, label: beat === 1 ? `${bar}` : `·${beat}`, major: beat === 1 });
    }
    return marks;
});

let tlEl = $state(null);

function onRulerClick(e) {
    if (!tlEl) return;
    const rect = tlEl.getBoundingClientRect();
    const x    = e.clientX - rect.left - LABEL_W + tlScroll;
    seek(Math.max(0, pxToTick(x)));
}

// ── Export ────────────────────────────────────────────────────────
async function handleExport() {

    const events = processGraph(
        kinetic.nodeInstances,
        graphContext()
    );

    const bytes = bakeToMidi(
        events,
        kinetic.timeDiv,
        kinetic.bpm
    );

    const path = await save({
        defaultPath: `kinetic_${Date.now()}.mid`,
        filters: [{ name: 'MIDI', extensions: ['mid'] }],
    });
    if (path) {
        await writeFile(path, bytes);
        showToast('Exported!', 'success');
    } else {
        showToast('Export failed', 'error');
    }
}

onDestroy(stop);
</script>

<!-- ═══════════════════════════════════════════════════════════════ -->
<div class="kp-shell">

    <!-- Header -->
    <header class="al-header kp-header">
        <div class="al-header-brand">
            <span class="al-logo-text">Kine<span class="al-logo-accent">tic</span></span>
            <span class="al-logo-sub" style="font-size:8px">MIDI effect studio</span>
        </div>

        <!-- Transport -->
        <div class="kp-transport">
            <button
                class="al-btn kp-tbtn"
                onclick={() => { play(); playSound('aiGenerating'); }}
                disabled={kinetic.playing}
                title="Play"
            >▶</button>
            <button
                class="al-btn kp-tbtn"
                onclick={stop}
                disabled={!kinetic.playing}
                title="Stop"
            >■</button>
            <span class="kp-timecode">{playheadDisplay}</span>
            <input
                class="kp-scrubber"
                type="range"
                min="0"
                max={kinetic.totalDuration}
                value={kinetic.playheadTick}
                oninput={e => seek(Number(e.currentTarget.value))}
            />
            <span class="al-dim" style="font-size:11px">BPM</span>
            <input
                class="al-num-input"
                type="number"
                min="20"
                max="300"
                bind:value={kinetic.bpm}
                style="width:52px"
            />
        </div>

        <!-- Right actions -->
        <div class="al-header-actions">
            <select
                class="al-select"
                style="width:72px"
                bind:value={kinetic.device}
            >
                <option value="LPX">LPX</option>
                <option value="LPP2">LPP2</option>
                <option value="LPP3">LPP3</option>
            </select>
            <button class="al-btn al-btn-green" onclick={handleExport}>
                ⬇ Export .mid
            </button>
        </div>
    </header>


    <!-- warning -->
    <div style="display:flex;gap:8px;padding:8px;background:rgba(255,0,0,0.1);align-items:center;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:bolder;">
            Kinetic is currently an extremely early prototype. Expect features to be heavily reworked in the coming alpha versions.
        </span>
    </div>    
    <!-- Body -->
    <div class="kp-body">

        <!-- Node menu (left) -->
        <aside class="kp-node-menu">
            <NodeMenu />
        </aside>

        <!-- Centre: graph + timeline -->
        <div class="kp-centre">

            <!-- Node graph -->
            <div class="kp-graph-wrap">
                <svg
                    bind:this={svgEl}
                    class="kp-graph-svg"
                    onpointerdown={onSvgPointerDown}
                    onpointermove={onSvgPointerMove}
                    onpointerup={onSvgPointerUp}
                    onwheel={onSvgWheel}
                    ondblclick={onSvgDblClick}
                    ondragover={e => e.preventDefault()}
                    ondrop={onGraphDrop}
                    oncontextmenu={e => e.preventDefault()}
                >
                    <!-- Dot grid background -->
                    <defs>
                        <pattern
                            id="kg-dot"
                            width={20 * graphZoom}
                            height={20 * graphZoom}
                            x={graphPan.x % (20 * graphZoom)}
                            y={graphPan.y % (20 * graphZoom)}
                            patternUnits="userSpaceOnUse"
                        >
                            <circle cx="0.8" cy="0.8" r="0.8" fill="rgba(255,255,255,0.07)" />
                        </pattern>
                    </defs>
                    <rect class="kg-bg" width="100%" height="100%" fill="url(#kg-dot)" />

                    <!-- Pan/zoom group -->
                    <g transform="translate({graphPan.x},{graphPan.y}) scale({graphZoom})">

                        <!-- Wires -->
                        {#each kinetic.wires as wire (wire.id)}
                            {@const fromInst = kinetic.nodeInstances.find(n => n.instanceId === wire.fromId)}
                            {@const toInst   = kinetic.nodeInstances.find(n => n.instanceId === wire.toId)}
                            {#if fromInst && toInst}
                                {@const fp = portPos(fromInst, wire.fromPort)}
                                {@const tp = portPos(toInst,   wire.toPort)}
                                <path
                                    class="kg-wire {kinetic.selectedWireId === wire.id ? 'sel' : ''}"
                                    d={wirePath(fp.x, fp.y, tp.x, tp.y)}
                                    onclick={() => kinetic.selectedWireId = wire.id}
                                    ondblclick={() => { removeWire(wire.id); kinetic.selectedWireId = null; }}
                                />
                            {/if}
                        {/each}

                        <!-- Pending wire -->
                        {#if pendingWire}
                            {@const fromInst = kinetic.nodeInstances.find(n => n.instanceId === pendingWire.fromId)}
                            {#if fromInst}
                                {@const fp  = portPos(fromInst, pendingWire.fromPort)}
                                {@const tgx = (pendingWire.cx - graphPan.x) / graphZoom}
                                {@const tgy = (pendingWire.cy - graphPan.y) / graphZoom}
                                <path
                                    class="kg-wire-pending"
                                    d={wirePath(fp.x, fp.y, tgx, tgy)}
                                />
                            {/if}
                        {/if}

                        <!-- Node cards -->
                        {#each kinetic.nodeInstances as inst (inst.instanceId)}
                            {@const desc = NODE_BY_ID[inst.nodeId] ?? { icon:'?', label: inst.nodeId, color:'hsl(220,15%,55%)', params:{}, hint:'' }}
                            {@const gx   = inst.position?.x ?? 0}
                            {@const gy   = inst.position?.y ?? 0}
                            {@const nh   = nodeH(desc)}
                            {@const sel  = inst.instanceId === kinetic.selectedInstanceId}

                            <g
                                class="kg-node {sel ? 'sel' : ''} {inst.enabled ? '' : 'bypassed'}"
                                transform="translate({gx},{gy})"
                                onpointerdown={e => onNodePointerDown(e, inst.instanceId)}
                                oncontextmenu={e => onNodeRightClick(e, inst.instanceId)}
                            >
                                <!-- Body -->
                                <rect
                                    x="0" y="0"
                                    width={NODE_W} height={nh}
                                    rx="8"
                                    fill="rgba(14,18,36,0.92)"
                                    stroke={sel ? desc.color : 'rgba(255,255,255,0.09)'}
                                    stroke-width={sel ? 1.5 : 1}
                                />
                                <!-- Category bar -->
                                <rect x="0" y="0" width={NODE_W} height="3.5" rx="4"
                                      fill={desc.color} />
                                <rect x="0" y="2" width={NODE_W} height="1.5"
                                      fill={desc.color} />

                                <!-- Icon + label -->
                                <text x="11" y="24" class="kg-node-icon">{desc.icon}</text>
                                <text x="28" y="24" class="kg-node-label">{desc.label}</text>

                                <!-- Bypassed badge -->
                                {#if !inst.enabled}
                                    <text x={NODE_W - 10} y="24" class="kg-node-bypass">⏸</text>
                                {/if}

                                <!-- Param summary (first 2 knob/float/int) -->
                                {#each Object.entries(desc.params).filter(([,p]) => ['knob','float','int'].includes(p.type)).slice(0,2) as [key, pd], pi}
                                    <text x="11" y={40 + pi * PARAM_H} class="kg-param-text">
                                        {pd.label}: {typeof inst.params[key] === 'number' ? inst.params[key].toFixed(pd.decimals ?? 0) : inst.params[key]}{pd.unit ?? ''}
                                    </text>
                                {/each}

                                <!-- Input port A -->
                                <circle
                                    class="kg-port kg-port-in"
                                    cx="0" cy={nh * 0.35} r="5"
                                    onpointerdown={e => e.stopPropagation()}
                                    onpointerup={e => onInputPortUp(e, inst.instanceId, 'input')}
                                />

                                <!-- Input port B (multi-input nodes) -->
                                {#if desc.isMultiInput}
                                    <circle
                                        class="kg-port kg-port-b"
                                        cx="0" cy={nh * 0.65} r="5"
                                        onpointerdown={e => e.stopPropagation()}
                                        onpointerup={e => onInputPortUp(e, inst.instanceId, 'inputB')}
                                    />
                                {/if}

                                <!-- Output port -->
                                <circle
                                    class="kg-port kg-port-out"
                                    cx={NODE_W} cy={nh * 0.5} r="5"
                                    onpointerdown={e => onOutputPortDown(e, inst.instanceId)}
                                />
                            </g>
                        {/each}

                    </g><!-- end pan/zoom group -->

                    <!-- Empty state -->
                    {#if kinetic.nodeInstances.length === 0}
                        <text x="50%" y="44%" class="kg-empty-h" text-anchor="middle">No nodes</text>
                        <text x="50%" y="51%" class="kg-empty-s" text-anchor="middle">
                            Double-click to search · Drag a node from the menu
                        </text>
                    {/if}
                </svg>

                <!-- Node search (screen-space overlay) -->
                {#if searchOpen}
                    {@const sp = graphToSvg(searchGX, searchGY)}
                    <div
                        class="kg-search"
                        style="left:{sp.x}px;top:{sp.y}px"
                    >
                        <input
                            class="al-text-input"
                            type="text"
                            placeholder="Search nodes…"
                            bind:value={searchQuery}
                            autofocus
                            onkeydown={e => {
                                if (e.key === 'Escape') searchOpen = false;
                                if (e.key === 'Enter' && searchResults.length) addFromSearch(searchResults[0]);
                            }}
                        />
                        <div class="kg-search-list">
                            {#each searchResults.slice(0, 10) as desc}
                                <button
                                    class="kg-search-item"
                                    onclick={() => addFromSearch(desc)}
                                >
                                    <span>{desc.icon}</span>
                                    <span class="kg-search-label">{desc.label}</span>
                                    <span class="kg-search-cat">{desc.category}</span>
                                </button>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Context menu -->
                {#if ctxMenu}
                    <div
                        class="kg-ctx"
                        style="left:{ctxMenu.x}px;top:{ctxMenu.y}px"
                        onmouseleave={() => ctxMenu = null}
                    >
                        <button
                            class="kg-ctx-item"
                            onclick={() => { toggleNode(ctxMenu.instanceId); ctxMenu = null; }}
                        >Toggle bypass</button>
                        <button
                            class="kg-ctx-item danger"
                            onclick={() => { removeNode(ctxMenu.instanceId); ctxMenu = null; }}
                        >Delete node</button>
                    </div>
                {/if}
            </div><!-- kp-graph-wrap -->

            <!-- Split handle -->
            <div
                class="kp-split"
                onpointerdown={onSplitDown}
                title="Drag to resize timeline"
            >
                <div class="kp-split-grip"></div>
            </div>

            <!-- Timeline -->
            <div
                class="kp-timeline"
                style="height:{timelineH}px"
                bind:this={tlEl}
            >
                <!-- Zoom bar -->
                <div class="tl-zoombar">
                    <span class="al-dim" style="font-size:10px">Zoom</span>
                    <input type="range" min="0.2" max="6" step="0.05"
                        bind:value={tlZoom} style="width:70px" />
                    <span class="al-val">{tlZoom.toFixed(1)}×</span>
                </div>

                <!-- Scroll area -->
                <div
                    class="tl-scroll"
                    onscroll={e => tlScroll = e.currentTarget.scrollLeft}
                >
                    <div class="tl-inner" style="width:{LABEL_W + totalTlW}px">

                        <!-- Ruler -->
                        <div class="tl-ruler" onclick={onRulerClick}>
                            <div class="tl-label-stub" style="width:{LABEL_W}px">
                                <span class="al-dim" style="font-size:9px;padding:0 8px">TRACK</span>
                            </div>
                            <div class="tl-ruler-marks" style="width:{totalTlW}px;position:relative">
                                {#each rulerMarks as m}
                                    <div
                                        class="tl-tick {m.major ? 'major' : ''}"
                                        style="left:{tickToPx(m.t)}px"
                                    >
                                        {#if m.major}
                                            <span class="tl-tick-label">{m.label}</span>
                                        {/if}
                                    </div>
                                {/each}
                                <!-- Playhead on ruler -->
                                <div
                                    class="tl-ph-head"
                                    style="left:{tickToPx(kinetic.playheadTick)}px"
                                >▼</div>
                            </div>
                        </div>

                        <!-- Node rows -->
                        {#each kinetic.nodeInstances as inst (inst.instanceId)}
                            {@const desc = NODE_BY_ID[inst.nodeId] ?? { icon:'?', label: inst.nodeId, color:'hsl(220,15%,55%)', params:{} }}
                            <div class="tl-track">
                                <!-- Track label -->
                                <div
                                    class="tl-track-label {inst.instanceId === kinetic.selectedInstanceId ? 'sel' : ''}"
                                    style="width:{LABEL_W}px;--nc:{desc.color}"
                                    onclick={() => kinetic.selectedInstanceId = inst.instanceId}
                                >
                                    <span class="tl-node-dot" style="background:{desc.color}"></span>
                                    <span class="tl-track-name">{desc.icon} {desc.label}</span>
                                </div>
                                <!-- Track content -->
                                <div class="tl-track-content" style="width:{totalTlW}px;position:relative;height:{ROW_H}px">
                                    <div
                                        class="tl-block {inst.enabled ? '' : 'bypassed'}"
                                        style="left:0;width:{totalTlW}px;--nc:{desc.color};height:{ROW_H - 4}px;top:2px"
                                        onclick={() => kinetic.selectedInstanceId = inst.instanceId}
                                    >
                                        <span class="tl-block-label">{desc.label}</span>
                                    </div>
                                    <!-- Playhead line -->
                                    <div
                                        class="tl-ph-line"
                                        style="left:{tickToPx(kinetic.playheadTick)}px;height:{ROW_H}px"
                                    ></div>
                                </div>
                            </div>
                        {/each}

                        {#if kinetic.nodeInstances.length === 0}
                            <div class="tl-empty">No nodes. Add one from the graph above</div>
                        {/if}

                    </div><!-- tl-inner -->
                </div><!-- tl-scroll -->
            </div><!-- kp-timeline -->

        </div><!-- kp-centre -->

        <!-- Inspector + LP preview (right) -->
        <aside class="kp-inspector">

            <!-- LP preview -->
            <div class="kp-lp-panel">
                <div class="kp-lp-header">
                    <span class="al-label" style="margin:0">Launchpad</span>
                    <span class="al-dim" style="font-size:10px">{kinetic.device}</span>
                </div>
                <VirtualLP
                    device={kinetic.device ?? 'LPP2'}
                    sysexColors={lpColors}
                    size={240}
                    logoOrMode={kinetic.logoOrMode ?? 'logo'}
                    interactive={false}
                />
            </div>

            <!-- Inspector scroll area -->
            <div class="kp-inspector-body">
                <p class="al-label" style="margin-bottom:12px">Inspector</p>

                {#if selectedNode()}
                    <NodeInspector instance={selectedNode()} />
                {:else}
                    <p class="al-hint-text">Click a node to inspect it.</p>
                {/if}
            </div>

        </aside>

    </div><!-- kp-body -->

</div><!-- kp-shell -->

<style>
/* ── Shell ────────────────────────────────────────────────────── */
.kp-shell {
    display:        flex;
    flex-direction: column;
    height:         100vh;
    overflow:       hidden;
}

/* ── Header ───────────────────────────────────────────────────── */
.kp-header  { gap: 10px; }
.kp-transport {
    display:    flex;
    align-items:center;
    gap:        7px;
    flex:       1;
    min-width:  0;
}
.kp-tbtn      { width: 30px; height: 30px; padding: 0; font-size: 12px; flex-shrink: 0; }
.kp-timecode  { font-family:'Geist Mono',monospace; font-size:11px; color:var(--color-text-dim); min-width:44px; flex-shrink:0; }
.kp-scrubber  { flex:1; height:3px; min-width:60px; }

/* ── Body ─────────────────────────────────────────────────────── */
.kp-body {
    display:               grid;
    grid-template-columns: 170px 1fr 268px;
    flex:                  1;
    min-height:            0;
    overflow:              hidden;
}

/* ── Node menu ────────────────────────────────────────────────── */
.kp-node-menu {
    border-right: 1px solid var(--color-border);
    overflow-y:   auto;
    padding:      10px 8px;
    background:   var(--color-surface-0);
}

/* ── Centre ───────────────────────────────────────────────────── */
.kp-centre {
    display:        flex;
    flex-direction: column;
    min-height:     0;
    overflow:       hidden;
}

.kp-graph-wrap {
    flex:     1;
    min-height: 0;
    position: relative;
    overflow: hidden;
}

.kp-graph-svg {
    width:    100%;
    height:   100%;
    display:  block;
    outline:  none;
    background: rgba(7,9,20,0.65);
    user-select: none;
}

/* ── Graph elements ───────────────────────────────────────────── */
.kg-bg { cursor: default; }

.kg-wire {
    fill:         none;
    stroke:       rgba(255,255,255,0.22);
    stroke-width: 1.5;
    cursor:       pointer;
    transition:   stroke 0.1s;
}
.kg-wire:hover  { stroke: rgba(255,255,255,0.5); stroke-width: 2; }
.kg-wire.sel    { stroke: var(--color-accent); stroke-width: 2; }
.kg-wire-pending{
    fill:              none;
    stroke:            var(--color-accent);
    stroke-width:      1.5;
    stroke-dasharray:  5 3;
    pointer-events:    none;
}

.kg-node { cursor: grab; }
.kg-node:active { cursor: grabbing; }
.kg-node.bypassed { opacity: 0.4; }

.kg-node-icon  { font-size:13px; fill:rgba(255,255,255,0.7); dominant-baseline:middle; }
.kg-node-label { font-size:12px; fill:#e8e4da; font-weight:600; dominant-baseline:middle; font-family:inherit; }
.kg-node-bypass{ font-size:11px; fill:rgba(248,113,113,0.85); text-anchor:end; dominant-baseline:middle; }
.kg-param-text { font-size:10px; fill:rgba(255,255,255,0.32); font-family:'Geist Mono',monospace; dominant-baseline:middle; }

.kg-port { cursor:crosshair; transition: r 0.1s; }
.kg-port:hover { r:7; }
.kg-port-in  { fill:rgba(43,127,255,0.65); stroke:#2b7fff; stroke-width:1.5; }
.kg-port-out { fill:rgba(34,197,94,0.65);  stroke:#22c55e; stroke-width:1.5; }
.kg-port-b   { fill:rgba(248,113,113,0.65);stroke:#f87171; stroke-width:1.5; }

.kg-empty-h { font-size:17px; fill:rgba(255,255,255,0.18); font-weight:600; font-family:inherit; }
.kg-empty-s { font-size:12px; fill:rgba(255,255,255,0.10); font-family:inherit; }

/* Node search */
.kg-search {
    position:       absolute;
    z-index:        50;
    width:          220px;
    background:     var(--color-glass-modal);
    border:         1px solid var(--color-border-bright);
    border-radius:  var(--radius-lg);
    box-shadow:     var(--shadow-modal);
    backdrop-filter:blur(16px);
    overflow:       hidden;
}
.kg-search .al-text-input {
    border:        none;
    border-bottom: 1px solid var(--color-border);
    border-radius: 0;
    background:    transparent;
}
.kg-search-list { max-height: 220px; overflow-y: auto; }
.kg-search-item {
    display:     flex;
    align-items: center;
    gap:         7px;
    width:       100%;
    padding:     7px 12px;
    background:  transparent;
    border:      none;
    color:       var(--color-text-secondary);
    font-size:   12px;
    font-family: inherit;
    text-align:  left;
    cursor:      pointer;
}
.kg-search-item:hover { background: var(--color-surface-2); color: var(--color-text); }
.kg-search-label { flex: 1; font-weight: 500; }
.kg-search-cat   { font-size: 10px; color: var(--color-text-dim); }

/* Context menu */
.kg-ctx {
    position:      fixed;
    z-index:       200;
    min-width:     140px;
    background:    var(--color-glass-modal);
    border:        1px solid var(--color-border-bright);
    border-radius: var(--radius-md);
    box-shadow:    var(--shadow-modal);
    backdrop-filter:blur(12px);
    overflow:      hidden;
}
.kg-ctx-item {
    display:    block;
    width:      100%;
    padding:    8px 14px;
    background: transparent;
    border:     none;
    color:      var(--color-text-secondary);
    font-size:  12px;
    font-family:inherit;
    text-align: left;
    cursor:     pointer;
}
.kg-ctx-item:hover        { background: var(--color-surface-2); }
.kg-ctx-item.danger:hover { background: var(--color-danger-subtle); color: var(--color-danger); }

/* ── Split handle ─────────────────────────────────────────────── */
.kp-split {
    flex-shrink:     0;
    height:          7px;
    cursor:          ns-resize;
    display:         flex;
    align-items:     center;
    justify-content: center;
    border-top:      1px solid var(--color-border);
    border-bottom:   1px solid var(--color-border);
    background:      transparent;
    z-index:         10;
}
.kp-split:hover  { background: var(--color-surface-1); }
.kp-split-grip {
    width:         28px;
    height:        3px;
    border-radius: 99px;
    background:    var(--color-border-bright);
}

/* ── Timeline ─────────────────────────────────────────────────── */
.kp-timeline {
    flex-shrink: 0;
    overflow:    hidden;
    display:     flex;
    flex-direction: column;
    background:  var(--color-surface-0);
}

.tl-zoombar {
    display:       flex;
    align-items:   center;
    gap:           6px;
    padding:       3px 10px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink:   0;
    height:        26px;
}

.tl-scroll { overflow-x:auto; overflow-y:auto; flex:1; }
.tl-inner  { position:relative; }

/* Ruler */
.tl-ruler {
    display:       flex;
    position:      sticky;
    top:           0;
    z-index:       10;
    height:        22px;
    background:    rgba(8,10,22,0.97);
    border-bottom: 1px solid var(--color-border);
    cursor:        crosshair;
}
.tl-label-stub {
    display:      flex;
    align-items:  center;
    flex-shrink:  0;
    border-right: 1px solid var(--color-border);
    background:   rgba(8,10,22,0.97);
    position:     sticky;
    left:         0;
    z-index:      11;
}
.tl-ruler-marks { position:relative; overflow:hidden; }
.tl-tick {
    position:   absolute;
    top:        0; bottom:0;
    width:      1px;
    background: rgba(255,255,255,0.07);
}
.tl-tick.major  { background: rgba(255,255,255,0.14); }
.tl-tick-label  { position:absolute; left:3px; top:4px; font-size:9px; color:rgba(255,255,255,0.32); font-family:'Geist Mono',monospace; white-space:nowrap; }
.tl-ph-head     { position:absolute; top:3px; font-size:10px; color:var(--color-accent); transform:translateX(-50%); cursor:ew-resize; user-select:none; z-index:5; }

/* Track */
.tl-track { display:flex; height:30px; border-bottom:1px solid rgba(255,255,255,0.03); }
.tl-track-label {
    display:      flex;
    align-items:  center;
    gap:          6px;
    padding:      0 8px;
    flex-shrink:  0;
    border-right: 1px solid var(--color-border);
    background:   rgba(8,10,22,0.92);
    cursor:       pointer;
    user-select:  none;
    height:       30px;
    position:     sticky;
    left:         0;
    z-index:      5;
    border-left:  2px solid transparent;
    transition:   border-color 0.1s;
}
.tl-track-label.sel { border-left-color: var(--nc); background: color-mix(in srgb, var(--nc) 10%, rgba(8,10,22,0.92)); }
.tl-node-dot  { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.tl-track-name{ font-size:11px; font-weight:500; color:var(--color-text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85px; }
.tl-track-content { background:rgba(255,255,255,0.01); }
.tl-block {
    position:      absolute;
    border-radius: 3px;
    background:    color-mix(in srgb, var(--nc) 18%, transparent);
    border:        1px solid color-mix(in srgb, var(--nc) 45%, transparent);
    display:       flex;
    align-items:   center;
    padding:       0 7px;
    overflow:      hidden;
    cursor:        pointer;
}
.tl-block.bypassed { opacity: 0.35; }
.tl-block-label { font-size:10px; font-weight:600; color:rgba(255,255,255,0.55); white-space:nowrap; }
.tl-ph-line {
    position:       absolute;
    top:            0;
    width:          1px;
    background:     var(--color-accent);
    opacity:        0.7;
    pointer-events: none;
    z-index:        4;
}
.tl-empty {
    display:         flex;
    align-items:     center;
    justify-content: center;
    height:          50px;
    font-size:       11px;
    color:           var(--color-text-dim);
}

/* ── Inspector ────────────────────────────────────────────────── */
.kp-inspector {
    border-left:    1px solid var(--color-border);
    display:        flex;
    flex-direction: column;
    overflow:       hidden;
    background:     var(--color-surface-0);
}

.kp-lp-panel {
    flex-shrink:   0;
    padding:       12px;
    border-bottom: 1px solid var(--color-border);
    display:       flex;
    flex-direction:column;
    gap:           7px;
}
.kp-lp-header {
    display:     flex;
    align-items: baseline;
    gap:         8px;
}
.kp-inspector-body {
    flex:       1;
    overflow-y: auto;
    padding:    14px;
}
</style>
