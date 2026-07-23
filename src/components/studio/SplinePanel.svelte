<!-- src/components/studio/SplinePanel.svelte -->
<!--
    curves-only automation editor.

    left: a checkbox list of every node's animatable params (only params
    marked `animatable: true` in their descriptor AND of a numeric type;
    same double-check KineticTimeline.svelte's original animatableParams()
    used, see its own comment on why both checks matter). checking a param
    shows its curve on the canvas; clicking a row (not just its checkbox)
    also makes it the active param; the one that responds to click-to-add
    and right-click-to-remove breakpoints. multiple curves can be visible
    at once for comparison; only one is ever editable at a time, to keep
    click targeting unambiguous.
-->
<script>
import {
    kinetic, currentInstances, addAutoPoint, removeAutoPoint,
} from '../../stores/kinetic.svelte.js';
import { NODE_DEFS } from '../../lib/aerolux/kinetic/nodeRegistry.js';

const LANE_H = 200;
let pxPerTick = $state(0.25);

function tickToPx(t) { return t * pxPerTick; }
function pxToTick(px) { return px / pxPerTick; }
const totalW = $derived(tickToPx(kinetic.transport.totalDuration));

const rulerMarks = $derived.by(() => {
    const step = kinetic.transport.timeDiv || 96;
    const marks = [];
    for (let t = 0; t <= kinetic.transport.totalDuration; t += step) marks.push(t);
    return marks;
});

function animatableParams(def) {
    return Object.entries(def?.params ?? {})
        .filter(([, p]) => ['knob', 'float', 'int'].includes(p.type) && p.animatable === true);
}

// every (instance, paramKey) pair that's actually animatable, across the currently-open graph level.
const rows = $derived.by(() => {
    const list = [];
    for (const instance of currentInstances()) {
        const def = NODE_DEFS[instance.nodeId];
        for (const [paramKey, pDesc] of animatableParams(def)) {
            list.push({ instance, def, paramKey, pDesc });
        }
    }
    return list;
});

function rowKey(instanceId, paramKey) { return `${instanceId}:${paramKey}`; }

let checked = $state(new Set());
let active  = $state(null); // { instanceId, paramKey } | null

function toggleChecked(row) {
    const key = rowKey(row.instance.instanceId, row.paramKey);
    const next = new Set(checked);
    if (next.has(key)) {
        next.delete(key);
        if (active && rowKey(active.instanceId, active.paramKey) === key) active = null;
    } else {
        next.add(key);
        active = { instanceId: row.instance.instanceId, paramKey: row.paramKey };
    }
    checked = next;
}

function selectActive(row) {
    active = { instanceId: row.instance.instanceId, paramKey: row.paramKey };
    const key = rowKey(row.instance.instanceId, row.paramKey);
    if (!checked.has(key)) {
        const next = new Set(checked);
        next.add(key);
        checked = next;
    }
}

const visibleRows = $derived(rows.filter(r => checked.has(rowKey(r.instance.instanceId, r.paramKey))));
const activeRow = $derived(
    active ? rows.find(r => r.instance.instanceId === active.instanceId && r.paramKey === active.paramKey) ?? null : null
);

function lanePath(lane, pDesc) {
    if (!lane?.length) return '';
    const min = pDesc.min ?? 0, max = pDesc.max ?? 1;
    const range = (max - min) || 1;
    return lane
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${tickToPx(p.tick)} ${LANE_H * (1 - (p.value - min) / range)}`)
        .join(' ');
}

function onCanvasClick(e) {
    if (!activeRow) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tick = Math.round(pxToTick(e.clientX - rect.left));
    const yRatio = (e.clientY - rect.top) / LANE_H;
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    const value = Math.max(min, Math.min(max, min + (1 - yRatio) * (max - min)));
    addAutoPoint(activeRow.instance.instanceId, activeRow.paramKey, tick, value);
}
function onBreakpointRightClick(e, row, tick) {
    e.preventDefault();
    e.stopPropagation();
    removeAutoPoint(row.instance.instanceId, row.paramKey, tick);
}

// playhead marker, shown on the canvas so scrubbing/playback (TransportBar) is visible against the curves being edited.
const playheadX = $derived(tickToPx(kinetic.transport.playheadTick));
</script>

<div class="sp-shell">
    <div class="sp-list">
        <div class="sp-list-header">
            <span class="al-label" style="margin:0">Animatable params</span>
        </div>
        {#if !rows.length}
            <p class="al-hint-text" style="padding:12px">No animatable params in this graph yet.</p>
        {/if}
        {#each rows as row}
            {@const key = rowKey(row.instance.instanceId, row.paramKey)}
            {@const isChecked = checked.has(key)}
            {@const isActive = active && rowKey(active.instanceId, active.paramKey) === key}
            <div class="sp-row {isActive ? 'active' : ''}" onclick={() => selectActive(row)}>
                <input type="checkbox" checked={isChecked} onclick={e => { e.stopPropagation(); toggleChecked(row); }} />
                <span class="sp-row-dot" style="background:{row.def?.color ?? '#888'}"></span>
                <span class="sp-row-label">{row.def?.icon} {row.def?.label} · {row.pDesc.label}</span>
            </div>
        {/each}
    </div>

    <div class="sp-canvas-wrap">
        <div class="sp-ruler" style="width:{totalW}px">
            {#each rulerMarks as mark}
                <span class="sp-tick-label" style="left:{tickToPx(mark)}px">{mark}</span>
            {/each}
        </div>
        <div class="sp-canvas" style="width:{totalW}px; height:{LANE_H}px" onclick={onCanvasClick}>
            <div class="sp-canvas-bg"></div>
            <div class="sp-playhead" style="left:{playheadX}px"></div>
            <svg class="sp-svg" width={totalW} height={LANE_H}>
                {#each visibleRows as row}
                    {@const lane = row.instance.automation?.[row.paramKey]}
                    {@const isActive = active && active.instanceId === row.instance.instanceId && active.paramKey === row.paramKey}
                    <path d={lanePath(lane, row.pDesc)} fill="none" stroke={row.def?.color ?? '#888'}
                        stroke-width={isActive ? 2 : 1.25} opacity={isActive ? 1 : 0.5} />
                    {#if lane?.length}
                        {#each lane as bp (bp.tick)}
                            {@const min = row.pDesc.min ?? 0}
                            {@const range = (row.pDesc.max ?? 1) - min || 1}
                            <circle
                                cx={tickToPx(bp.tick)}
                                cy={LANE_H * (1 - (bp.value - min) / range)}
                                r={isActive ? 3.5 : 2.5} fill={row.def?.color ?? '#888'}
                                oncontextmenu={e => isActive && onBreakpointRightClick(e, row, bp.tick)}
                            />
                        {/each}
                    {/if}
                {/each}
            </svg>
        </div>
        {#if !visibleRows.length}
            <p class="sp-canvas-hint">Check a param on the left to plot its curve here. Click the canvas to add a breakpoint on the active (highlighted) param.</p>
        {/if}
    </div>
</div>

<style>
.sp-shell { display: flex; height: 100%; overflow: hidden; background: rgba(6,8,20,0.7); }

.sp-list        { width: 220px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--color-border); }
.sp-list-header { padding: 8px 10px; border-bottom: 1px solid var(--color-border); }
.sp-row {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 10px; cursor: pointer;
    border-left: 2px solid transparent;
}
.sp-row:hover  { background: var(--color-surface-1); }
.sp-row.active { border-left-color: var(--color-accent); background: var(--color-accent-subtle); }
.sp-row-dot    { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.sp-row-label  { font-size: 11px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sp-canvas-wrap { flex: 1; overflow: auto; position: relative; padding: 8px; }
.sp-ruler       { position: relative; height: 16px; }
.sp-tick-label  { position: absolute; top: 0; font-size: 9px; color: rgba(255,255,255,0.32); font-family: 'Geist Mono', monospace; }

.sp-canvas    { position: relative; cursor: crosshair; border: 1px solid var(--color-border); overflow: hidden; }
.sp-canvas-bg { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 48px); }
.sp-playhead  { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--color-accent); box-shadow: var(--glow-accent); pointer-events: none; z-index: 2; }
.sp-svg       { position: relative; z-index: 1; }
.sp-svg circle{ cursor: pointer; }

.sp-canvas-hint { margin-top: 8px; font-size: 11px; color: var(--color-text-dim); max-width: 320px; }
</style>