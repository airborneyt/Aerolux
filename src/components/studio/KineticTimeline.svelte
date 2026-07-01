<!-- src/components/studio/KineticTimeline.svelte -->
<!--
    Scrollable, zoomable timeline.
    One row per node instance.
    Each node row can expand to show automation lane sub-rows.
    Playhead is a draggable vertical line.
-->
<script>
import { kinetic, seek, addAutoPoint, removeAutoPoint, sampleAuto }
    from '../../stores/kinetic.svelte.js';
import { NODE_BY_ID } from '../../lib/aerolux/nodeRegistry.js';

// Layout constants
const LABEL_W    = 140;   // px — track label column width
const ROW_H      = 32;    // px per node row
const LANE_H     = 24;    // px per automation lane
const HEADER_H   = 24;    // px for ruler
const PX_PER_TICK= 0.08;  // default zoom (px per tick)

let zoom   = $state(1);
let scrollX = $state(0);

function tickToPx(tick)  { return tick * PX_PER_TICK * zoom; }
function pxToTick(px)    { return px / (PX_PER_TICK * zoom); }

const totalW = $derived(tickToPx(kinetic.totalDuration) + 200);

// Track which node rows are expanded (showing automation lanes)
let expanded = $state(new Set());   // Set<instanceId>
// Track which param lanes are visible per node
let visibleLanes = $state({});      // { [instanceId]: Set<paramKey> }

function toggleExpand(instanceId) {
    if (expanded.has(instanceId)) expanded.delete(instanceId);
    else expanded.add(instanceId);
    expanded = new Set(expanded);
}

function toggleLane(instanceId, paramKey) {
    if (!visibleLanes[instanceId]) visibleLanes[instanceId] = new Set();
    const s = visibleLanes[instanceId];
    if (s.has(paramKey)) s.delete(paramKey);
    else s.add(paramKey);
    visibleLanes = { ...visibleLanes };
}

// ── Playhead drag ─────────────────────────────────────────────────
let phDragging = false;
let tlEl;

function onPlayheadPointerDown(e) {
    phDragging = true;
    e.stopPropagation();
    window.addEventListener('pointermove', onPlayheadMove);
    window.addEventListener('pointerup',   onPlayheadUp);
}

function onRulerClick(e) {
    const rect  = tlEl.getBoundingClientRect();
    const x     = e.clientX - rect.left - LABEL_W + scrollX;
    const tick  = Math.max(0, pxToTick(x));
    seek(tick);
}

function onPlayheadMove(e) {
    if (!phDragging) return;
    const rect = tlEl.getBoundingClientRect();
    const x    = e.clientX - rect.left - LABEL_W + scrollX;
    seek(Math.max(0, pxToTick(x)));
}

function onPlayheadUp() {
    phDragging = false;
    window.removeEventListener('pointermove', onPlayheadMove);
    window.removeEventListener('pointerup',   onPlayheadUp);
}

// ── Ruler ticks ───────────────────────────────────────────────────
const rulerTicks = $derived.by(() => {
    const ticksPerBeat = kinetic.timeDiv || 96;
    const beatsPerBar  = 4;
    const tpb          = ticksPerBeat * beatsPerBar;
    const step         = zoom < 0.4 ? tpb * 4 : zoom < 1 ? tpb : ticksPerBeat;
    const marks = [];
    for (let t = 0; t <= kinetic.totalDuration; t += step) {
        const bar  = Math.floor(t / tpb) + 1;
        const beat = Math.floor((t % tpb) / ticksPerBeat) + 1;
        marks.push({ tick: t, label: beat === 1 ? `${bar}` : `.${beat}`, major: beat === 1 });
    }
    return marks;
});

// ── Automation breakpoint add ─────────────────────────────────────
function onLaneClick(e, instanceId, paramKey, desc) {
    const rect   = e.currentTarget.getBoundingClientRect();
    const x      = e.clientX - rect.left + scrollX;
    const tick   = Math.round(pxToTick(x));
    const pDesc  = desc?.params?.[paramKey];
    if (!pDesc) return;
    const yRatio = (e.clientY - rect.top) / LANE_H;
    const value  = pDesc.min + (1 - yRatio) * (pDesc.max - pDesc.min);
    const clamped = Math.max(pDesc.min, Math.min(pDesc.max, value));
    addAutoPoint(instanceId, paramKey, tick, clamped);
}

function onBreakpointRightClick(e, instanceId, paramKey, tick) {
    e.preventDefault();
    removeAutoPoint(instanceId, paramKey, tick);
}

// ── Build breakpoint SVG path ─────────────────────────────────────
function lanePath(points, pDesc) {
    if (!points?.length) return '';
    const range = pDesc.max - pDesc.min;
    const pts   = points.map(p => ({
        x: tickToPx(p.tick),
        y: LANE_H * (1 - (p.value - pDesc.min) / range),
    }));
    return pts.map((p, i) => (i === 0 ? `M` : `L`) + ` ${p.x} ${p.y}`).join(' ');
}
</script>

<div class="tl-shell" bind:this={tlEl}>

    <!-- Zoom control -->
    <div class="tl-zoom-bar">
        <span class="al-dim">Zoom</span>
        <input type="range" min="0.2" max="5" step="0.05"
            bind:value={zoom} style="width:80px" />
        <span class="al-val">{zoom.toFixed(1)}×</span>
    </div>

    <div class="tl-scroll-area"
        onscroll={e => scrollX = e.target.scrollLeft}
        style="overflow-x:auto;overflow-y:auto;flex:1;position:relative">

        <div class="tl-inner" style="width:{LABEL_W + totalW}px">

            <!-- Ruler -->
            <div class="tl-ruler" style="height:{HEADER_H}px"
                onclick={onRulerClick}>
                <!-- Label column -->
                <div class="tl-label-col" style="width:{LABEL_W}px;height:{HEADER_H}px">
                    <span class="al-dim" style="font-size:9px;padding:0 6px">TRACK</span>
                </div>
                <!-- Tick marks -->
                <div class="tl-ruler-marks" style="width:{totalW}px;height:{HEADER_H}px;position:relative">
                    {#each rulerTicks as mark}
                        <div class="tl-ruler-tick {mark.major ? 'major' : ''}"
                             style="left:{tickToPx(mark.tick)}px">
                            {#if mark.major}<span class="tl-ruler-label">{mark.label}</span>{/if}
                        </div>
                    {/each}
                    <!-- Playhead on ruler -->
                    <div class="tl-ph-head"
                         style="left:{tickToPx(kinetic.playheadTick)}px"
                         onpointerdown={onPlayheadPointerDown}>
                        ▼
                    </div>
                </div>
            </div>

            <!-- Tracks -->
            {#each kinetic.nodeInstances as instance (instance.instanceId)}
                {@const desc = NODE_BY_ID[instance.nodeId]}
                {@const col  = desc?.timelineColor ?? 'hsl(220,15%,50%)'}
                {@const isExp = expanded.has(instance.instanceId)}
                {@const lanes = visibleLanes[instance.instanceId] ?? new Set()}

                <!-- Node row -->
                <div class="tl-track">
                    <!-- Label -->
                    <div class="tl-label-col tl-track-label
                                {kinetic.selectedNodeIds.has(instance.instanceId) ? 'selected' : ''}"
                         style="--nc:{col}"
                         onclick={() => kinetic.selectedNodeIds = new Set([instance.instanceId])}>
                        <span
                            class="tl-expand-btn"
                            onclick={(e) => {
                                e.stopPropagation();
                                toggleExpand(instance.instanceId);
                            }}
                        >
                            {isExp ? '▾' : '▸'}
                        </span>
                        <span class="tl-node-dot" style="background:{col}"></span>
                        <span class="tl-track-name">{desc?.icon} {desc?.label}</span>
                    </div>
                    <!-- Block -->
                    <div class="tl-track-content" style="width:{totalW}px;position:relative;height:{ROW_H}px">
                        <div class="tl-node-block"
                             style="left:0;width:{totalW}px;--nc:{col};height:{ROW_H - 4}px;top:2px">
                            <span class="tl-block-label">{desc?.label}</span>
                        </div>
                        <!-- Playhead line -->
                        <div class="tl-ph-line" style="left:{tickToPx(kinetic.playheadTick)}px;height:{ROW_H}px"></div>
                    </div>
                </div>

                <!-- Automation lane rows (expanded) -->
                {#if isExp}
                    {@const automatable = Object.entries(desc?.params ?? {})
                        .filter(([,p]) => ['knob','float','int'].includes(p.type))}
                    {@const laneData = kinetic.automationData[instance.instanceId]?.[paramKey]}    
                    {#each automatable as [paramKey, pDesc]}
                        <div class="tl-track tl-lane-track">
                            <!-- Lane label -->
                            <div class="tl-label-col tl-lane-label" style="width:{LABEL_W}px">
                                <span class="tl-lane-dot"
                                      class:active={lanes.has(paramKey)}
                                      onclick={() => toggleLane(instance.instanceId, paramKey)}
                                ></span>
                                <span class="tl-lane-name">{pDesc.label}</span>
                                <span class="al-dim" style="font-size:9px;margin-left:auto">
                                    {sampleAuto(instance.instanceId, paramKey, kinetic.playheadTick)?.toFixed(pDesc.decimals ?? 1) ?? '—'}{pDesc.unit ?? ''}
                                </span>
                            </div>
                            <!-- Lane content -->
                            <div class="tl-lane-content"
                                 style="width:{totalW}px;height:{LANE_H}px;position:relative"
                                 onclick={e => onLaneClick(e, instance.instanceId, paramKey, desc)}>

                                <!-- Lane fill -->
                                <div class="tl-lane-bg"></div>

                                <!-- Breakpoint curve (SVG) -->
                                {#if laneData?.length}
                                    <svg class="tl-lane-svg" viewBox="0 0 {totalW} {LANE_H}"
                                         width={totalW} height={LANE_H} style="position:absolute;inset:0">
                                        <path d={lanePath(laneData, pDesc)}
                                              fill="none" stroke={col} stroke-width="1.5" opacity="0.8" />
                                        {#each laneData as bp}
                                            {@const range = pDesc.max - pDesc.min}
                                            <circle
                                                cx={tickToPx(bp.tick)}
                                                cy={LANE_H * (1 - (bp.value - pDesc.min) / range)}
                                                r="3" fill={col}
                                                style="cursor:pointer"
                                                oncontextmenu={e => onBreakpointRightClick(e, instance.instanceId, paramKey, bp.tick)}
                                            />
                                        {/each}
                                    </svg>
                                {/if}

                                <!-- Playhead -->
                                <div class="tl-ph-line" style="left:{tickToPx(kinetic.playheadTick)}px;height:{LANE_H}px"></div>
                            </div>
                        </div>
                    {/each}
                {/if}
            {/each}

        </div><!-- tl-inner -->
    </div><!-- scroll area -->
</div>

<style>
.tl-shell {
    display:        flex;
    flex-direction: column;
    height:         100%;
    overflow:       hidden;
    background:     rgba(6,8,20,0.7);
    border-top:     1px solid var(--color-border);
}

.tl-zoom-bar {
    display:     flex;
    align-items: center;
    gap:         6px;
    padding:     4px 12px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    height:      28px;
}

.tl-scroll-area { overflow-x: auto; overflow-y: auto; flex: 1; }

.tl-inner { position: relative; }

/* Ruler */
.tl-ruler {
    display:          flex;
    position:         sticky;
    top:              0;
    z-index:          10;
    background:       rgba(8,10,22,0.95);
    border-bottom:    1px solid var(--color-border);
}
.tl-ruler-marks  { position: relative; overflow: hidden; }
.tl-ruler-tick   { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.07); }
.tl-ruler-tick.major { background: rgba(255,255,255,0.14); }
.tl-ruler-label  { position: absolute; left: 3px; top: 4px; font-size: 9px; color: rgba(255,255,255,0.35); font-family: 'Geist Mono', monospace; white-space: nowrap; }
.tl-ph-head      { position: absolute; top: 4px; font-size: 10px; color: var(--color-accent); cursor: ew-resize; transform: translateX(-50%); user-select: none; z-index: 20; }

/* Track */
.tl-track { display: flex; height: auto; border-bottom: 1px solid rgba(255,255,255,0.04); }

.tl-label-col {
    flex-shrink:  0;
    display:      flex;
    align-items:  center;
    gap:          6px;
    padding:      0 8px;
    background:   rgba(8,10,22,0.9);
    border-right: 1px solid var(--color-border);
    cursor:       pointer;
    user-select:  none;
    height:       32px;
    position:     sticky;
    left:         0;
    z-index:      5;
}
.tl-track-label.selected { background: color-mix(in srgb, var(--nc) 12%, rgba(8,10,22,0.9)); }
.tl-expand-btn  { font-size: 9px; color: rgba(255,255,255,0.3); width: 10px; }
.tl-node-dot    { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.tl-track-name  { font-size: 11px; font-weight: 500; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px; }

.tl-track-content { background: rgba(255,255,255,0.01); }

.tl-node-block {
    position:      absolute;
    border-radius: 4px;
    background:    color-mix(in srgb, var(--nc) 20%, transparent);
    border:        1px solid color-mix(in srgb, var(--nc) 50%, transparent);
    display:       flex;
    align-items:   center;
    padding:       0 8px;
    overflow:      hidden;
}
.tl-block-label { font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6); white-space: nowrap; }

/* Playhead */
.tl-ph-line {
    position:   absolute;
    top:        0;
    width:      1px;
    background: var(--color-accent);
    opacity:    0.7;
    pointer-events: none;
    z-index:    8;
}

/* Automation lane */
.tl-lane-track { background: rgba(0,0,0,0.2); }
.tl-lane-label { height: 24px; padding: 0 6px 0 18px; background: rgba(6,8,18,0.9); }
.tl-lane-dot   { width: 8px; height: 8px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; flex-shrink: 0; }
.tl-lane-dot.active { background: var(--color-accent); border-color: var(--color-accent); }
.tl-lane-name  { font-size: 10px; color: rgba(255,255,255,0.3); white-space: nowrap; }
.tl-lane-content { background: rgba(255,255,255,0.015); cursor: crosshair; }
.tl-lane-bg    { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 48px); }
.tl-lane-svg   { pointer-events: none; }
</style>