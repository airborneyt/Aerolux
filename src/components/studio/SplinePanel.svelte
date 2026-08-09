<!-- src/components/studio/SplinePanel.svelte -->
<!--
    automation editor.

      - click a breakpoint to select it, shift/cmd+click to
        multi-select, drag-box select on empty canvas, escape clears.
      - drag a breakpoint (or the whole multi-selection at once) to move it
        in time and value together; shift constrains to whichever axis has
        moved further since the drag started; alt duplicates the dragged
        point(s) first, then drags the clones, leaving the originals in
        place; ctrl/cmd bypasses snapping for that drag.
      - right-click a breakpoint (or the whole selection, if it's part of
        one) deletes it. delete/backspace does the same from the keyboard.
      - double-click empty canvas adds a breakpoint there (only when a
        curve is active).
      - exact breakpoint tick/value/interpolation are editable directly; multiple
        selected shows count + ranges plus nudge/quantise/duplicate/delete.
      - registers as the curve-reveal handler (kineticUiSignals.svelte.js)
        so NodeInspector.svelte's per-param animate control can jump here
-->
<script>
import { onMount, onDestroy } from 'svelte';
import {
    kinetic, currentInstances, addAutoPoint, updateAutoPoint, removeAutoPoints, duplicateAutoPoints,
} from '../../stores/kinetic.svelte.js';
import { NODE_DEFS } from '../../lib/aerolux/kinetic/nodeRegistry.js';
import { INTERP_TYPES, INTERP_LABELS, sampleAutomationLane } from '../../lib/aerolux/kinetic/automation.js';
import { registerCurveRevealHandler, unregisterCurveRevealHandler } from '../../stores/kineticUiSignals.svelte.js';

const RULER_H = 16, WRAP_PAD = 16;
let canvasWrapH = $state(0);
const LANE_H = $derived(Math.max(120, canvasWrapH - RULER_H - WRAP_PAD));

let pxPerTick = $state(0.5);
function tickToPx(t) { return t * pxPerTick; }
function pxToTick(px) { return px / pxPerTick; }
const totalW = $derived(tickToPx(kinetic.transport.totalDuration));

function valueToY(value, pDesc) {
    const min = pDesc.min ?? 0, max = pDesc.max ?? 1;
    const range = (max - min) || 1;
    return LANE_H * (1 - (value - min) / range);
}

function animatableParams(def) {
    return Object.entries(def?.params ?? {})
        .filter(([, p]) => ['knob', 'float', 'int'].includes(p.type) && p.animatable === true);
}

// param list (left column) –––––––––––––––––––––––––––––––––––––––––
let query = $state('');
let onlyAnimated = $state(false);

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

const filteredRows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
        if (onlyAnimated && !(r.instance.automation?.[r.paramKey]?.length)) return false;
        if (!q) return true;
        return `${r.def?.label ?? ''} ${r.pDesc.label}`.toLowerCase().includes(q);
    });
});
// curve browser grouping –––––––––––––––––––––––––––––––––––––––––––
const groupedRows = $derived.by(() => {
    const groups = new Map(); // instanceId -> { instance, def, rows: [] }
    for (const row of filteredRows) {
        const id = row.instance.instanceId;
        if (!groups.has(id)) groups.set(id, { instance: row.instance, def: row.def, rows: [] });
        groups.get(id).rows.push(row);
    }
    return [...groups.values()];
});

let collapsedGroups = $state(new Set());
function toggleGroup(instanceId) {
    const next = new Set(collapsedGroups);
    next.has(instanceId) ? next.delete(instanceId) : next.add(instanceId);
    collapsedGroups = next;
}

function rowKey(instanceId, paramKey) { return `${instanceId}:${paramKey}`; }

let checked = $state(new Set());
let active  = $state(null); // { instanceId, paramKey }
let selectedTicks = $state(new Set()); // breakpoint selection

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
    selectedTicks = new Set();
}

function selectActive(row) {
    active = { instanceId: row.instance.instanceId, paramKey: row.paramKey };
    const key = rowKey(row.instance.instanceId, row.paramKey);
    if (!checked.has(key)) checked = new Set([...checked, key]);
    selectedTicks = new Set();
}

const visibleRows = $derived(rows.filter(r => checked.has(rowKey(r.instance.instanceId, r.paramKey))));
const activeRow = $derived(
    active ? rows.find(r => r.instance.instanceId === active.instanceId && r.paramKey === active.paramKey) ?? null : null
);
const activeLane = $derived(activeRow ? (activeRow.instance.automation?.[activeRow.paramKey] ?? []) : []);
const selectedPoints = $derived(
    activeLane.filter(p => selectedTicks.has(p.tick)).sort((a, b) => a.tick - b.tick)
);

// curve reveal –––––––––––––––––––––––––––––––––––––––––––––––––––––
onMount(() => {
    const handler = ({ instanceId, paramKey }) => {
        const key = rowKey(instanceId, paramKey);
        if (!checked.has(key)) checked = new Set([...checked, key]);
        active = { instanceId, paramKey };
        selectedTicks = new Set();
    };
    registerCurveRevealHandler(handler);
    return () => unregisterCurveRevealHandler(handler);
});

// snapping –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
const GRID_OPTIONS = [
    { id: 'auto',      label: 'Auto' },
    { id: 'none',      label: 'Off' },
    { id: 'tick',      label: 'Tick (1)' },
    { id: 'sixteenth', label: '1/16 beat' },
    { id: 'eighth',    label: '1/8 beat' },
    { id: 'quarter',   label: '1/4 beat' },
    { id: 'half',      label: '1/2 beat' },
    { id: 'beat',      label: 'Beat' },
    { id: 'bar',       label: 'Bar (4 beats)' },
];
let gridMode = $state('auto');
const MIN_GRID_PX = 12, MAX_GRID_PX = 40; // comfortable on-screen spacing band for 'auto'

function fixedGridInterval(mode) {
    const beat = Math.max(1, kinetic.transport.timeDiv || 96);
    switch (mode) {
        case 'sixteenth': return Math.max(1, Math.round(beat / 16));
        case 'eighth':    return Math.max(1, Math.round(beat / 8));
        case 'quarter':   return Math.max(1, Math.round(beat / 4));
        case 'half':      return Math.max(1, Math.round(beat / 2));
        case 'beat':      return beat;
        case 'bar':       return beat * 4;
        default:          return 1; // 'tick'
    }
}

// candidate steps for 'auto' (smallest to largest) chooses the finest one that is still within MIN_GRID_PX
function autoGridInterval() {
    const beat = Math.max(1, kinetic.transport.timeDiv || 96);
    const candidates = [1, beat / 16, beat / 8, beat / 4, beat / 2, beat, beat * 4, beat * 16].map(v => Math.max(1, Math.round(v)));
    const target = Math.sqrt(MIN_GRID_PX * MAX_GRID_PX); // geometric mean of the comfort band
    let best = candidates[0], bestDiff = Infinity;
    for (const step of candidates) {
        const diff = Math.abs(Math.log((step * pxPerTick) / target));
        if (diff < bestDiff) { bestDiff = diff; best = step; }
    }
    return best;
}
function activeGridInterval() {
    // null = no grid at all ('none')
    if (gridMode === 'none') return null;
    if (gridMode === 'auto') return autoGridInterval();
    return fixedGridInterval(gridMode);
}

function snapInterval() {
    return activeGridInterval() ?? 1; // dragging still lands on a whole tick even with the grid display off
}
function snapTick(tick, bypass = false) {
    const t = bypass ? tick : Math.round(tick / snapInterval()) * snapInterval();
    return Math.max(0, Math.round(t));
}

// grid + value axis ––––––––––––––––––––––––––––––––––––––––––––––––
const gridLines = $derived.by(() => {
    const minor = activeGridInterval();
    if (minor == null) return []; // grid off
    const beat = Math.max(1, kinetic.transport.timeDiv || 96);
    const bar  = beat * 4;
    const lines = [];
    for (let t = 0; t <= kinetic.transport.totalDuration; t += minor) {
        const tier = (t % bar === 0) ? 'bar' : (t % beat === 0) ? 'beat' : 'minor';
        lines.push({ tick: t, tier });
    }
    return lines;
});
const valueAxisLines = $derived.by(() => {
    if (!activeRow) return [];
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    const mid = (min + max) / 2;
    return [max, mid, min].map(v => ({ value: v, label: v.toFixed(2), y: valueToY(v, activeRow.pDesc) }));
});
const playheadX = $derived(tickToPx(kinetic.transport.playheadTick));

// eased curve path –––––––––––––––––––––––––––––––––––––––––––––––––
function lanePath(lane, pDesc) {
    if (!lane?.length) return '';
    const endPx = tickToPx(kinetic.transport.totalDuration);
    if (lane.length === 1) {
        const y = valueToY(lane[0].value, pDesc);
        return `M 0 ${y} L ${endPx} ${y}`;
    }
    const minPx = tickToPx(lane[0].tick), maxPx = tickToPx(lane[lane.length - 1].tick);
    const stepPx = 4; // sample every 4 canvas px
    let d = '';
    for (let px = minPx; px <= maxPx; px += stepPx) {
        const v = sampleAutomationLane(lane, pxToTick(px), lane[0].value);
        d += `${px === minPx ? 'M' : 'L'} ${px} ${valueToY(v, pDesc)} `;
    }
    const firstY = valueToY(lane[0].value, pDesc), lastY = valueToY(lane[lane.length - 1].value, pDesc);
    const pre  = minPx > 0     ? `M 0 ${firstY} L ${minPx} ${firstY} ` : '';
    const post = maxPx < endPx ? `M ${maxPx} ${lastY} L ${endPx} ${lastY} ` : '';
    return pre + d + post;
}

// refs –––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
let canvasEl    = $state(null);
let canvasWrapEl = $state(null);

// box select –––––––––––––––––––––––––––––––––––––––––––––––––––––––
let boxSelect = $state(null); // {startX,startY,endX,endY,additive} in canvas-local px, or null

function onCanvasPointerDown(e) {
    if (e.target !== canvasEl && !e.target.classList?.contains('sp-canvas-bg')) return;
    if (e.button !== 0 || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    boxSelect = { startX: x, startY: y, endX: x, endY: y, additive: e.shiftKey || e.metaKey || e.ctrlKey };
    window.addEventListener('pointermove', onBoxSelectMove);
    window.addEventListener('pointerup', onBoxSelectUp);
}
function onBoxSelectMove(e) {
    if (!boxSelect || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    boxSelect = { ...boxSelect, endX: e.clientX - rect.left, endY: e.clientY - rect.top };
}
function onBoxSelectUp() {
    if (boxSelect && activeRow) {
        const x0 = Math.min(boxSelect.startX, boxSelect.endX), x1 = Math.max(boxSelect.startX, boxSelect.endX);
        const y0 = Math.min(boxSelect.startY, boxSelect.endY), y1 = Math.max(boxSelect.startY, boxSelect.endY);
        const moved = (x1 - x0) > 2 || (y1 - y0) > 2;
        if (moved) {
            const hit = activeLane
                .filter(p => {
                    const px = tickToPx(p.tick), py = valueToY(p.value, activeRow.pDesc);
                    return px >= x0 && px <= x1 && py >= y0 && py <= y1;
                })
                .map(p => p.tick);
            selectedTicks = boxSelect.additive ? new Set([...selectedTicks, ...hit]) : new Set(hit);
        } else if (!boxSelect.additive) {
            selectedTicks = new Set(); // plain click on empty canvas: clear selection
        }
    }
    boxSelect = null;
    window.removeEventListener('pointermove', onBoxSelectMove);
    window.removeEventListener('pointerup', onBoxSelectUp);
}

function onCanvasDblClick(e) {
    if (!activeRow || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const tick = snapTick(Math.round(pxToTick(e.clientX - rect.left)), e.metaKey || e.ctrlKey);
    const yRatio = (e.clientY - rect.top) / LANE_H;
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    const value = Math.max(min, Math.min(max, min + (1 - yRatio) * (max - min)));
    addAutoPoint(activeRow.instance.instanceId, activeRow.paramKey, tick, value);
    selectedTicks = new Set([tick]);
}

function onCanvasWheel(e) {
    if (!canvasEl) return;
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const tickAtCursor = pxToTick(mx);
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    pxPerTick = Math.max(0.02, Math.min(4, pxPerTick * factor));
    if (canvasWrapEl) {
        canvasWrapEl.scrollLeft += (tickToPx(tickAtCursor) - mx);
    }
}

function zoomToFit() {
    if (!activeRow || !canvasWrapEl) return;
    if (!activeLane.length) { pxPerTick = 0.25; canvasWrapEl.scrollLeft = 0; return; }
    const minT = Math.min(0, ...activeLane.map(p => p.tick));
    const maxT = Math.max(kinetic.transport.timeDiv || 96, ...activeLane.map(p => p.tick));
    const span = Math.max(1, maxT - minT);
    const containerW = canvasWrapEl.clientWidth || 600;
    pxPerTick = Math.max(0.02, Math.min(4, (containerW - 40) / span));
    canvasWrapEl.scrollLeft = Math.max(0, tickToPx(minT) - 20);
}

// breakpoint selection + drag ––––––––––––––––––––––––––––––––––––––
function toggleSelect(tick) {
    const next = new Set(selectedTicks);
    next.has(tick) ? next.delete(tick) : next.add(tick);
    selectedTicks = next;
}

let pointDrag = null;

function startPointDrag(e, row, point) {
    e.stopPropagation();
    if (e.button !== 0) return;

    if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleSelect(point.tick); // modifier-click: selection only
        return;
    }

    let dragTicks;
    if (selectedTicks.has(point.tick) && selectedTicks.size > 1) {
        dragTicks = [...selectedTicks]; // plain click on an already-multi-selected point drags the whole selection
    } else {
        selectedTicks = new Set([point.tick]);
        dragTicks = [point.tick];
    }

    const lane = row.instance.automation?.[row.paramKey] ?? [];
    let origins = dragTicks.map(t => {
        const p = lane.find(pp => pp.tick === t);
        return { currentTick: t, origValue: p?.value ?? 0 };
    });

    if (e.altKey) {
        // duplicate first (tiny +1 tick nudge so the clones don't just
        // overwrite the originals), then drag the clones from there
        const newTicks = duplicateAutoPoints(row.instance.instanceId, row.paramKey, dragTicks, 1);
        origins = newTicks.map((t, i) => ({ currentTick: t, origValue: origins[i]?.origValue ?? 0 }));
        selectedTicks = new Set(newTicks);
    }

    pointDrag = {
        instanceId: row.instance.instanceId, paramKey: row.paramKey, pDesc: row.pDesc,
        startX: e.clientX, startY: e.clientY,
        origins: origins.map(o => ({ ...o, startTick: o.currentTick })),
    };
    window.addEventListener('pointermove', onPointDragMove);
    window.addEventListener('pointerup', onPointDragUp);
}

function onPointDragMove(e) {
    if (!pointDrag) return;
    const dxPx = e.clientX - pointDrag.startX;
    const dyPx = e.clientY - pointDrag.startY;
    const range = ((pointDrag.pDesc.max ?? 1) - (pointDrag.pDesc.min ?? 0)) || 1;

    let dTick  = pxToTick(dxPx);
    let dValue = -dyPx * range / LANE_H;

    if (e.shiftKey) {
        if (Math.abs(dxPx) >= Math.abs(dyPx)) dValue = 0; else dTick = 0;
    }

    const bypassSnap = e.metaKey || e.ctrlKey;
    const min = pointDrag.pDesc.min ?? 0, max = pointDrag.pDesc.max ?? 1;

    for (const origin of pointDrag.origins) {
        const newTick  = snapTick(origin.startTick + dTick, bypassSnap);
        const newValue = Math.max(min, Math.min(max, origin.origValue + dValue));
        updateAutoPoint(pointDrag.instanceId, pointDrag.paramKey, origin.currentTick, { tick: newTick, value: newValue });
        origin.currentTick = newTick;
    }
    selectedTicks = new Set(pointDrag.origins.map(o => o.currentTick));
}

function onPointDragUp() {
    pointDrag = null;
    window.removeEventListener('pointermove', onPointDragMove);
    window.removeEventListener('pointerup', onPointDragUp);
}

function onPointContextMenu(e, row, point) {
    e.preventDefault();
    e.stopPropagation();
    const ticks = (selectedTicks.has(point.tick) && selectedTicks.size > 1) ? [...selectedTicks] : [point.tick];
    removeAutoPoints(row.instance.instanceId, row.paramKey, ticks);
    selectedTicks = new Set([...selectedTicks].filter(t => !ticks.includes(t)));
}

// numeric inspector (below canvas) –––––––––––––––––––––––––––––––––
function commitSinglePoint(field, value) {
    if (selectedPoints.length !== 1 || !activeRow) return;
    const p = selectedPoints[0];
    const patch = {};
    if (field === 'tick')   patch.tick   = Math.max(0, Math.round(value));
    if (field === 'value')  patch.value  = Math.max(activeRow.pDesc.min ?? 0, Math.min(activeRow.pDesc.max ?? 1, value));
    if (field === 'interp') patch.interp = value;
    updateAutoPoint(activeRow.instance.instanceId, activeRow.paramKey, p.tick, patch);
    if (patch.tick != null) selectedTicks = new Set([patch.tick]);
}

function multiNudgeTick(delta) {
    if (!activeRow) return;
    const newTicks = [];
    for (const p of selectedPoints) {
        const newTick = Math.max(0, p.tick + delta);
        updateAutoPoint(activeRow.instance.instanceId, activeRow.paramKey, p.tick, { tick: newTick });
        newTicks.push(newTick);
    }
    selectedTicks = new Set(newTicks);
}
function multiNudgeValue(delta) {
    if (!activeRow) return;
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    for (const p of selectedPoints) {
        updateAutoPoint(activeRow.instance.instanceId, activeRow.paramKey, p.tick, { value: Math.max(min, Math.min(max, p.value + delta)) });
    }
}
function quantiseSelected() {
    if (!activeRow) return;
    const interval = snapInterval();
    const newTicks = [];
    for (const p of selectedPoints) {
        const newTick = Math.round(p.tick / interval) * interval;
        updateAutoPoint(activeRow.instance.instanceId, activeRow.paramKey, p.tick, { tick: newTick });
        newTicks.push(newTick);
    }
    selectedTicks = new Set(newTicks);
}
function deleteSelected() {
    if (!activeRow || !selectedTicks.size) return;
    removeAutoPoints(activeRow.instance.instanceId, activeRow.paramKey, [...selectedTicks]);
    selectedTicks = new Set();
}
function duplicateSelected() {
    if (!activeRow || !selectedTicks.size) return;
    const offset = Math.max(1, snapInterval());
    selectedTicks = new Set(duplicateAutoPoints(activeRow.instance.instanceId, activeRow.paramKey, [...selectedTicks], offset));
}

// multi-select transform operations ––––––––––––––––––––––––––––––––
// all of these operate on `selectedPoints` (already sorted by tick) and
// route every change through updateAutoPoint
let showTransforms   = $state(false);
let scaleTimeFactor  = $state(1.5);
let scaleValueFactor = $state(1.5);
let offsetTimeAmount = $state(16);
let offsetValueAmount = $state(0.1);

function applyToSelected(mapFn) {
    if (!activeRow || selectedPoints.length < 1) return;
    const pts = selectedPoints; // snapshot, sorted 
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    const newTicks = [];
    for (let i = 0; i < pts.length; i++) {
        const patch = mapFn(pts[i], i, pts);
        const out = {};
        if (patch.tick  != null) out.tick  = Math.max(0, Math.round(patch.tick));
        if (patch.value != null) out.value = Math.max(min, Math.min(max, patch.value));
        updateAutoPoint(activeRow.instance.instanceId, activeRow.paramKey, pts[i].tick, out);
        newTicks.push(out.tick ?? pts[i].tick);
    }
    selectedTicks = new Set(newTicks);
}

// scales tick spacing around the first selected point (anchored)
function scaleTime() {
    if (selectedPoints.length < 2) return;
    const anchor = selectedPoints[0].tick;
    applyToSelected(p => ({ tick: anchor + (p.tick - anchor) * scaleTimeFactor }));
}
// scales values around the midpoint of the selection's own min/max (not the param's full range)
function scaleValue() {
    if (!selectedPoints.length) return;
    const vals = selectedPoints.map(p => p.value);
    const anchor = (Math.min(...vals) + Math.max(...vals)) / 2;
    applyToSelected(p => ({ value: anchor + (p.value - anchor) * scaleValueFactor }));
}
function offsetTime()  { applyToSelected(p => ({ tick: p.tick + offsetTimeAmount })); }
function offsetValue() { applyToSelected(p => ({ value: p.value + offsetValueAmount })); }

// sets every selected point to the same value (average)
function flattenSelected() {
    if (!selectedPoints.length) return;
    const avg = selectedPoints.reduce((s, p) => s + p.value, 0) / selectedPoints.length;
    applyToSelected(() => ({ value: avg }));
}
// mirrors the values across the selection in time-order (ticks stay at the same place)
function reverseSelected() {
    if (selectedPoints.length < 2) return;
    const reversedValues = [...selectedPoints].reverse().map(p => p.value);
    applyToSelected((p, i) => ({ value: reversedValues[i] }));
}
// flips every selected value around the param's own min/max midpoint
function invertSelected() {
    if (!activeRow) return;
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    applyToSelected(p => ({ value: min + max - p.value }));
}
// rescales the selection's own value span to fill the param's full min..max range
function normaliseSelected() {
    if (!activeRow || selectedPoints.length < 2) return;
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    const vals = selectedPoints.map(p => p.value);
    const srcMin = Math.min(...vals), srcMax = Math.max(...vals);
    const srcRange = (srcMax - srcMin) || 1;
    applyToSelected(p => ({ value: min + ((p.value - srcMin) / srcRange) * (max - min) }));
}
// re-spaces selected ticks evenly between the first and last selected tick
function distributeEvenly() {
    if (selectedPoints.length < 3) return; // fewer than 3 has nothing meaningful to distribute
    const first = selectedPoints[0].tick, last = selectedPoints[selectedPoints.length - 1].tick;
    const step = (last - first) / (selectedPoints.length - 1);
    applyToSelected((p, i) => ({ tick: first + step * i }));
}

// moving-average pass over values only (ticks untouched)
let smoothWindow = $state(1);
function smoothSelected() {
    if (selectedPoints.length < 3) return;
    const pts = selectedPoints;
    const w = Math.max(1, Math.round(smoothWindow));
    applyToSelected((p, i) => {
        const lo = Math.max(0, i - w), hi = Math.min(pts.length - 1, i + w);
        let sum = 0;
        for (let j = lo; j <= hi; j++) sum += pts[j].value;
        return { value: sum / (hi - lo + 1) };
    });
}

// removes almost-redundant points
// a point is dropped if its value is within 'simplifyTolerance'
// first and last points are always kept
let simplifyTolerance = $state(0.02);
function simplifySelected() {
    if (!activeRow || selectedPoints.length < 3) return;
    const pts = selectedPoints;
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    const tol = simplifyTolerance * ((max - min) || 1);

    const keep = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const prev = keep[keep.length - 1];
        const next = pts[i + 1];
        const span = next.tick - prev.tick;
        const expected = span === 0 ? prev.value : prev.value + (pts[i].tick - prev.tick) / span * (next.value - prev.value);
        if (Math.abs(pts[i].value - expected) > tol) keep.push(pts[i]);
    }
    keep.push(pts[pts.length - 1]);

    const removedTicks = pts.filter(p => !keep.includes(p)).map(p => p.tick);
    if (removedTicks.length) {
        removeAutoPoints(activeRow.instance.instanceId, activeRow.paramKey, removedTicks);
        selectedTicks = new Set(keep.map(p => p.tick));
    }
}

// clipboard ––––––––––––––––––––––––––––––––––––––––––––––––––––––––
let clipboard = $state(null); // { points: [{relTick, normValue, interp}] } | null
let pasteOffsetAmount = $state(16);

function copySelected() {
    if (!activeRow || selectedPoints.length < 1) return;
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    const range = (max - min) || 1;
    const baseTick = selectedPoints[0].tick;
    clipboard = {
        points: selectedPoints.map(p => ({
            relTick: p.tick - baseTick,
            normValue: (p.value - min) / range,
            interp: p.interp ?? 'linear',
        })),
    };
}
function cutSelected() {
    copySelected();
    deleteSelected();
}
function pasteAt(anchorTick) {
    if (!clipboard || !activeRow) return;
    const min = activeRow.pDesc.min ?? 0, max = activeRow.pDesc.max ?? 1;
    const range = max - min;
    const newTicks = [];
    for (const cp of clipboard.points) {
        const tick = Math.max(0, Math.round(anchorTick + cp.relTick));
        const value = Math.max(min, Math.min(max, min + cp.normValue * range));
        addAutoPoint(activeRow.instance.instanceId, activeRow.paramKey, tick, value, cp.interp);
        newTicks.push(tick);
    }
    selectedTicks = new Set(newTicks);
}
function pasteAtPlayhead() { pasteAt(kinetic.transport.playheadTick); }
function pasteWithOffset()  { pasteAt(kinetic.transport.playheadTick + pasteOffsetAmount); }

// keyboard –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
function isTyping(e) {
    const tag = e.target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
}
function onKeyDown(e) {
    if (isTyping(e) || !activeRow) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    else if (e.key === 'Escape') { selectedTicks = new Set(); boxSelect = null; }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelected(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') { e.preventDefault(); cutSelected(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteAtPlayhead(); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); multiNudgeTick(-(e.shiftKey ? snapInterval() : 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); multiNudgeTick(  e.shiftKey ? snapInterval() : 1); }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); multiNudgeValue(((activeRow.pDesc.max ?? 1) - (activeRow.pDesc.min ?? 0)) * (e.shiftKey ? 0.1 : 0.01)); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); multiNudgeValue(-((activeRow.pDesc.max ?? 1) - (activeRow.pDesc.min ?? 0)) * (e.shiftKey ? 0.1 : 0.01)); }
}
onMount(() => window.addEventListener('keydown', onKeyDown));
onDestroy(() => window.removeEventListener('keydown', onKeyDown));
</script>

<div class="sp-shell">
    <div class="sp-list">
        <div class="sp-list-header">
            <span class="al-label" style="margin:0">Animatable params</span>
            <input class="al-input" style="margin-top:6px;height:26px;font-size:11px;width:100%" type="text" placeholder="Search…" bind:value={query} />
            <label class="al-checkbox-label" style="margin-top:6px;font-size:11px">
                <input type="checkbox" bind:checked={onlyAnimated} />
                Only animated
            </label>
        </div>
        {#if !filteredRows.length}
            <p class="al-hint-text" style="padding:12px">No matching params.</p>
        {/if}
        {#each groupedRows as group}
            {@const collapsed = collapsedGroups.has(group.instance.instanceId)}
            <button class="sp-group-header" onclick={() => toggleGroup(group.instance.instanceId)}>
                <span class="sp-group-chevron">{collapsed ? '▸' : '▾'}</span>
                <span class="sp-row-dot" style="background:{group.def?.color ?? '#888'}"></span>
                <span class="sp-group-label">{group.def?.icon} {group.instance.label || group.def?.label || group.instance.nodeId}</span>
                <span class="sp-group-count">{group.rows.length}</span>
            </button>
            {#if !collapsed}
                {#each group.rows as row}
                    {@const key = rowKey(row.instance.instanceId, row.paramKey)}
                    {@const isChecked = checked.has(key)}
                    {@const isActive = active && rowKey(active.instanceId, active.paramKey) === key}
                    {@const lane = row.instance.automation?.[row.paramKey]}
                    <div class="sp-row {isActive ? 'active' : ''}" onclick={() => selectActive(row)}>
                        <input type="checkbox" checked={isChecked} onclick={e => { e.stopPropagation(); toggleChecked(row); }} />
                        <span class="sp-row-label">{row.pDesc.label}</span>
                        {#if lane?.length}<span class="sp-row-count">{lane.length}</span>{/if}
                    </div>
                {/each}
            {/if}
        {/each}
    </div>

    <div class="sp-main">
        <div class="sp-toolbar">
            <span class="al-dim" style="font-size:10px">Grid</span>
            <select class="al-select" style="width:100px;height:24px;font-size:11px" bind:value={gridMode} title="Controls both what's drawn and what dragging snaps to">
                {#each GRID_OPTIONS as opt}<option value={opt.id}>{opt.label}</option>{/each}
            </select>
            <button class="al-btn al-btn-sm" onclick={zoomToFit} disabled={!activeRow}>⤢ Fit</button>
            {#if clipboard}
                <button class="al-btn al-btn-sm" onclick={pasteAtPlayhead} disabled={!activeRow} title="Paste at playhead (Ctrl/Cmd+V)">📋 Paste</button>
                <div class="sp-paste-offset">
                    <input type="number" class="al-num-input" style="width:44px" bind:value={pasteOffsetAmount} step="1" />
                    <button class="al-btn al-btn-sm" onclick={pasteWithOffset} disabled={!activeRow} title="Paste at playhead + offset">Paste w/ offset</button>
                </div>
            {/if}
            <span class="al-dim" style="font-size:10px;margin-left:auto">
                {selectedTicks.size ? `${selectedTicks.size} selected` : 'Dbl-click to add · drag to move · ⇧ constrain · ⌥ duplicate'}
            </span>
        </div>

        <div class="sp-canvas-wrap" bind:this={canvasWrapEl} bind:clientHeight={canvasWrapH}>
            <div class="sp-ruler" style="width:{totalW}px">
                {#each gridLines.filter(g => g.tier === 'bar') as g}
                    <span class="sp-tick-label" style="left:{tickToPx(g.tick)}px">{g.tick}</span>
                {/each}
            </div>
            <svg
                bind:this={canvasEl}
                class="sp-canvas"
                width={totalW} height={LANE_H}
                onpointerdown={onCanvasPointerDown}
                ondblclick={onCanvasDblClick}
                onwheel={onCanvasWheel}
                oncontextmenu={e => e.preventDefault()}
            >
                <rect class="sp-canvas-bg" width={totalW} height={LANE_H} />

                {#each gridLines as g}
                    <line x1={tickToPx(g.tick)} x2={tickToPx(g.tick)} y1="0" y2={LANE_H} class="sp-grid-line {g.tier}" />
                {/each}
                {#each valueAxisLines as vl}
                    <line x1="0" x2={totalW} y1={vl.y} y2={vl.y} class="sp-value-line" />
                    <text x="4" y={Math.min(LANE_H - 3, Math.max(9, vl.y - 3))} class="sp-value-label">{vl.label}</text>
                {/each}
                <line x1={playheadX} x2={playheadX} y1="0" y2={LANE_H} class="sp-playhead" />

                {#each visibleRows as row}
                    {@const lane = row.instance.automation?.[row.paramKey]}
                    {@const isActiveCurve = active && active.instanceId === row.instance.instanceId && active.paramKey === row.paramKey}
                    <path d={lanePath(lane, row.pDesc)} fill="none" stroke={row.def?.color ?? '#888'}
                        stroke-width={isActiveCurve ? 2 : 1.25} opacity={isActiveCurve ? 1 : 0.45} />
                    {#if isActiveCurve && lane?.length}
                        {#each lane as bp (bp.tick)}
                            {@const selected = selectedTicks.has(bp.tick)}
                            <circle
                                cx={tickToPx(bp.tick)} cy={valueToY(bp.value, row.pDesc)}
                                r={selected ? 5 : 3.5}
                                class="sp-point {selected ? 'selected' : ''}"
                                style="--nc:{row.def?.color ?? '#888'}"
                                onpointerdown={e => startPointDrag(e, row, bp)}
                                oncontextmenu={e => onPointContextMenu(e, row, bp)}
                            />
                        {/each}
                    {/if}
                {/each}

                {#if boxSelect}
                    {@const bx0 = Math.min(boxSelect.startX, boxSelect.endX)}
                    {@const by0 = Math.min(boxSelect.startY, boxSelect.endY)}
                    {@const bw  = Math.abs(boxSelect.endX - boxSelect.startX)}
                    {@const bh  = Math.abs(boxSelect.endY - boxSelect.startY)}
                    <rect class="sp-box-select" x={bx0} y={by0} width={bw} height={bh} />
                {/if}
            </svg>
        </div>

        {#if !activeRow}
            <p class="sp-canvas-hint">Select a param on the left to edit its curve.</p>
        {:else if selectedPoints.length === 0}
            <p class="sp-canvas-hint">Double-click the canvas to add a breakpoint · shift/cmd+click to multi-select · right-click to delete</p>
        {:else if selectedPoints.length === 1}
            {@const p = selectedPoints[0]}
            <div class="sp-inspector">
                <label class="sp-inspector-field">
                    <span class="al-dim" style="font-size:10px">Tick</span>
                    <input type="number" class="al-num-input" value={p.tick} min="0" onchange={e => commitSinglePoint('tick', parseFloat(e.target.value))} />
                </label>
                <label class="sp-inspector-field">
                    <span class="al-dim" style="font-size:10px">Value</span>
                    <input type="number" class="al-num-input" value={p.value} step="any" onchange={e => commitSinglePoint('value', parseFloat(e.target.value))} />
                </label>
                <label class="sp-inspector-field">
                    <span class="al-dim" style="font-size:10px">Interpolation</span>
                    <select class="al-select" style="height:26px" value={p.interp ?? 'linear'} onchange={e => commitSinglePoint('interp', e.target.value)}>
                        {#each INTERP_TYPES as it}<option value={it}>{INTERP_LABELS[it]}</option>{/each}
                    </select>
                </label>
                <button class="al-btn al-btn-sm al-btn-danger" onclick={deleteSelected}>Delete</button>
            </div>
        {:else}
            {@const ticks = selectedPoints.map(p => p.tick)}
            {@const values = selectedPoints.map(p => p.value)}
            <div class="sp-inspector-block">
                <div class="sp-inspector">
                    <span class="al-dim" style="font-size:11px">
                        {selectedPoints.length} breakpoints · ticks {Math.min(...ticks)}–{Math.max(...ticks)} · values {Math.min(...values).toFixed(2)}–{Math.max(...values).toFixed(2)}
                    </span>
                    <button class="al-btn al-btn-sm" onclick={() => multiNudgeTick(-snapInterval())}>◀ Nudge</button>
                    <button class="al-btn al-btn-sm" onclick={() => multiNudgeTick(snapInterval())}>Nudge ▶</button>
                    <button class="al-btn al-btn-sm" onclick={quantiseSelected}>Quantise</button>
                    <button class="al-btn al-btn-sm" onclick={duplicateSelected}>⧉ Duplicate</button>
                    <button class="al-btn al-btn-sm al-btn-danger" onclick={deleteSelected}>Delete</button>
                    <button class="al-btn al-btn-sm al-btn-ghost" style="margin-left:auto" onclick={() => showTransforms = !showTransforms}>
                        Transform {showTransforms ? '▾' : '▸'}
                    </button>
                </div>

                {#if showTransforms}
                    <div class="sp-transform-panel">
                        <div class="sp-transform-row">
                            <span class="sp-transform-label">Scale time ×</span>
                            <input type="number" class="al-num-input" style="width:52px" bind:value={scaleTimeFactor} step="0.1" disabled={selectedPoints.length < 2} />
                            <button class="al-btn al-btn-sm" onclick={scaleTime} disabled={selectedPoints.length < 2}>Apply</button>
                            <span class="al-hint-text" style="margin:0">around the first selected point</span>
                        </div>
                        <div class="sp-transform-row">
                            <span class="sp-transform-label">Scale value ×</span>
                            <input type="number" class="al-num-input" style="width:52px" bind:value={scaleValueFactor} step="0.1" />
                            <button class="al-btn al-btn-sm" onclick={scaleValue}>Apply</button>
                            <span class="al-hint-text" style="margin:0">around the selection's own midpoint</span>
                        </div>
                        <div class="sp-transform-row">
                            <span class="sp-transform-label">Offset time</span>
                            <input type="number" class="al-num-input" style="width:52px" bind:value={offsetTimeAmount} step="1" />
                            <button class="al-btn al-btn-sm" onclick={offsetTime}>Apply</button>
                            <span class="al-hint-text" style="margin:0">ticks</span>
                        </div>
                        <div class="sp-transform-row">
                            <span class="sp-transform-label">Offset value</span>
                            <input type="number" class="al-num-input" style="width:52px" bind:value={offsetValueAmount} step="0.01" />
                            <button class="al-btn al-btn-sm" onclick={offsetValue}>Apply</button>
                        </div>
                        <div class="sp-transform-row">
                            <button class="al-btn al-btn-sm" onclick={flattenSelected}>Flatten</button>
                            <button class="al-btn al-btn-sm" onclick={reverseSelected} disabled={selectedPoints.length < 2}>Reverse</button>
                            <button class="al-btn al-btn-sm" onclick={invertSelected}>Invert</button>
                            <button class="al-btn al-btn-sm" onclick={normaliseSelected} disabled={selectedPoints.length < 2}>Normalise</button>
                            <button class="al-btn al-btn-sm" onclick={distributeEvenly} disabled={selectedPoints.length < 3}>Distribute evenly</button>
                        </div>
                        <div class="sp-transform-row">
                            <span class="sp-transform-label">Smooth ±</span>
                            <input type="number" class="al-num-input" style="width:44px" bind:value={smoothWindow} min="1" step="1" />
                            <button class="al-btn al-btn-sm" onclick={smoothSelected} disabled={selectedPoints.length < 3}>Apply</button>
                            <span class="al-hint-text" style="margin:0">points, moving average</span>
                        </div>
                        <div class="sp-transform-row">
                            <span class="sp-transform-label">Simplify tol.</span>
                            <input type="number" class="al-num-input" style="width:44px" bind:value={simplifyTolerance} min="0" step="0.01" />
                            <button class="al-btn al-btn-sm" onclick={simplifySelected} disabled={selectedPoints.length < 3}>Apply</button>
                            <span class="al-hint-text" style="margin:0">fraction of the param's own range</span>
                        </div>
                        <div class="sp-transform-row">
                            <button class="al-btn al-btn-sm" onclick={copySelected}>⧉ Copy</button>
                            <button class="al-btn al-btn-sm" onclick={cutSelected}>✂ Cut</button>
                            <span class="al-hint-text" style="margin:0">Paste</span>
                        </div>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
.sp-shell { display: flex; height: 100%; overflow: hidden; background: rgba(6,8,20,0.7); }

.sp-list        { width: 220px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--color-border); display: flex; flex-direction: column; }
.sp-list-header { padding: 8px 10px; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.sp-row {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 10px; cursor: pointer;
    border-left: 2px solid transparent;
}
.sp-row:hover  { background: var(--color-surface-1); }
.sp-row.active { border-left-color: var(--color-accent); background: var(--color-accent-subtle); }
.sp-row-dot    { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.sp-row-label  { font-size: 11px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; padding-left: 16px; }
.sp-row-count  { font-size: 9px; font-family: 'Geist Mono', monospace; color: var(--color-text-dim); background: var(--color-surface-2); border-radius: 3px; padding: 1px 4px; flex-shrink: 0; }

.sp-group-header {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 6px 10px; background: transparent; border: none;
    color: var(--color-text-secondary); font-size: 11px; font-weight: 600;
    cursor: pointer; font-family: inherit; text-align: left;
}
.sp-group-header:hover { background: var(--color-surface-1); }
.sp-group-chevron { font-size: 9px; width: 10px; color: var(--color-text-dim); flex-shrink: 0; }
.sp-group-label   { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-group-count   { font-size: 9px; font-family: 'Geist Mono', monospace; color: var(--color-text-dim); }

.sp-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.sp-toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 10px; height: 30px; flex-shrink: 0;
    border-bottom: 1px solid var(--color-border);
}

.sp-canvas-wrap { flex: 1; overflow: auto; position: relative; padding: 8px; min-height: 0; }
.sp-ruler       { position: relative; height: 16px; }
.sp-tick-label  { position: absolute; top: 0; font-size: 9px; color: rgba(255,255,255,0.32); font-family: 'Geist Mono', monospace; }

.sp-canvas    { position: relative; cursor: crosshair; border: 1px solid var(--color-border); display: block; }
.sp-canvas-bg { fill: rgba(255,255,255,0.012); }

.sp-grid-line       { stroke: rgba(255,255,255,0.035); stroke-width: 1; }
.sp-grid-line.beat  { stroke: rgba(255,255,255,0.08); }
.sp-grid-line.bar   { stroke: rgba(255,255,255,0.16); }
.sp-value-line       { stroke: rgba(255,255,255,0.05); stroke-width: 1; stroke-dasharray: 2 3; }
.sp-value-label       { font-size: 9px; fill: rgba(255,255,255,0.28); font-family: 'Geist Mono', monospace; }
.sp-playhead   { stroke: var(--color-accent); stroke-width: 1; opacity: 0.8; pointer-events: none; }

.sp-point {
    fill: var(--nc, #888); stroke: rgba(0,0,0,0.5); stroke-width: 1;
    cursor: grab;
}
.sp-point:active   { cursor: grabbing; }
.sp-point.selected { stroke: white; stroke-width: 2; }

.sp-box-select {
    fill: var(--color-accent-subtle); stroke: var(--color-accent);
    stroke-width: 1.5; stroke-dasharray: 4 3; pointer-events: none;
}

.sp-canvas-hint { margin: 8px; font-size: 11px; color: var(--color-text-dim); }

.sp-inspector {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 8px 12px;
    flex-shrink: 0;
}
.sp-inspector-field { display: flex; flex-direction: column; gap: 2px; }

.sp-inspector-block { border-top: 1px solid var(--color-border); flex-shrink: 0; }
.sp-inspector-block .sp-inspector { border-top: none; }

.sp-transform-panel {
    display: flex; flex-direction: column; gap: 6px;
    padding: 0 12px 10px;
}
.sp-transform-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sp-transform-label { font-size: 10px; color: var(--color-text-dim); width: 78px; flex-shrink: 0; }

.sp-paste-offset { display: flex; align-items: center; gap: 4px; }
</style>