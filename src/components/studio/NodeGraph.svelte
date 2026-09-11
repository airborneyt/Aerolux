<!-- src/components/studio/NodeGraph.svelte -->
<!--
    canonical node graph canvas. pannable and zoomable. nodes are draggable
    cards; output ports drag-connect to input ports. double-click empty space
    to search-add a node; double-click a composite's card to open it.
    right-click a node for bypass/duplicate/rename/disconnect/ungroup/delete.
    drag a node from NodeMenu.svelte and drop it on the canvas to add it at
    the drop position, or simply click the node. 
    shift+drag on empty canvas draws a box-select marquee.
-->
<script>
import { onMount, onDestroy } from 'svelte';
import {
    kinetic, currentInstances, currentWires, addNode, removeNode, moveNode, addWire, removeWire,
    selectNode, selectWire, toggleNode, openComposite, closeComposite,
    groupSelectionIntoComposite, bakeSelection, duplicateNode, ungroupComposite,
    copySelectionToClipboard, pasteClipboard, pushKineticUndo, undoKinetic, redoKinetic, runKineticBatch,
} from '../../stores/kinetic.svelte.js';
import { editor } from '../../stores/velocity.svelte.js';
import { NODE_DEFS } from '../../lib/aerolux/kinetic/nodeRegistry.js';
import { reachableInstanceIds } from '../../lib/aerolux/kinetic/compileGraph.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { hapticSnap, hapticTick } from '../../lib/aerolux/haptics.js';
import { registerDropHandler, unregisterDropHandler, requestRename } from '../../stores/kineticUiSignals.svelte.js';
import GraphBreadcrumb from './GraphBreadcrumb.svelte';

const NODE_W = 170;
const NODE_H = 56;
const DEFAULT_PAN = { x: 60, y: 40 };
const DEFAULT_ZOOM = 1;
const MIN_BOX_SELECT_SIZE = 2; // to ignore an accidental zero-size Shift+click
const GRID_SIZE = 20;
const WIRE_SNAP_DISTANCE = 24;

let { boundMultiSelectCount = $bindable(0) } = $props();

let svgEl = $state(null);

// device filter ––––––––––––––––––––––––––––––––––––––––––––––––––––
let deviceFilterId = $state(null);

const reachableSet = $derived(
    deviceFilterId
        ? reachableInstanceIds(currentInstances(), currentWires(), deviceFilterId)
        : null
);
function isDimmed(instanceId) {
    return reachableSet !== null && !reachableSet.has(instanceId);
}

// pan / zoom –––––––––––––––––––––––––––––––––––––––––––––––––––––––
let pan  = $state({ ...DEFAULT_PAN });
let zoom = $state(DEFAULT_ZOOM);
let isPanning  = false;
let panStart   = { x: 0, y: 0 };
let panOrigin  = { x: 0, y: 0 };

function graphToScreen(gx, gy) { return { x: gx * zoom + pan.x, y: gy * zoom + pan.y }; }
function screenToGraph(sx, sy) { return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom }; }
function resetView() { pan = { ...DEFAULT_PAN }; zoom = DEFAULT_ZOOM; }

// wire dragging ––––––––––––––––––––––––––––––––––––––––––––––––––––
let pendingWire = $state(null);

// box select (shift+drag on empty canvas) ––––––––––––––––––––––––––
let boxSelect = $state(null); // {startX, startY, endX, endY} in graph space, or null

function applyBoxSelect(box) {
    const x0 = Math.min(box.startX, box.endX), x1 = Math.max(box.startX, box.endX);
    const y0 = Math.min(box.startY, box.endY), y1 = Math.max(box.startY, box.endY);
    if (x1 - x0 < MIN_BOX_SELECT_SIZE && y1 - y0 < MIN_BOX_SELECT_SIZE) return;

    const next = new Set(multiSelected);
    for (const inst of currentInstances()) {
        const gx = inst.position?.x ?? 0, gy = inst.position?.y ?? 0;
        // AABB intersection between the node card and the marquee.
        const intersects = gx < x1 && gx + NODE_W > x0 && gy < y1 && gy + NODE_H > y0;
        if (intersects) next.add(inst.instanceId);
    }
    multiSelected = next;
}

// node dragging ––––––––––––––––––––––––––––––––––––––––––––––––––––
let nodeDrag = null;

function snapToGrid(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

// multi-select –––––––––––––––––––––––––––––––––––––––––––––––––––––
let multiSelected = $state(new Set());

function clearMultiSelect() { multiSelected = new Set(); }

function toggleMultiSelect(instanceId) {
    const next = new Set(multiSelected);
    next.has(instanceId) ? next.delete(instanceId) : next.add(instanceId);
    multiSelected = next;
}

const multiSelectCount = $derived(multiSelected.size);

$effect(() => { boundMultiSelectCount = multiSelectCount; });

$effect(() => {
    void kinetic.graphPath.length;
    clearMultiSelect();
});

function handleGroup() {
    if (multiSelectCount < 1) return;
    const result = groupSelectionIntoComposite([...multiSelected], 'Composite');
    if (!result.ok) {
        showToast(result.reason ?? 'Could not group selection', 'error', 5000);
        return;
    }
    clearMultiSelect();
    selectNode(result.composite.instanceId);
    showToast('Grouped into a composite', 'success');
}

function handleBake() {
    if (multiSelectCount < 1) return;
    const engineContext = { palette: editor.palette, devices: kinetic.devices };
    const result = bakeSelection([...multiSelected], 'Composite', engineContext, {});
    if (!result.ok) {
        showToast(result.reason ?? 'Could not bake selection', 'error', 5000);
        return;
    }
    clearMultiSelect();
    selectNode(result.composite.instanceId);
    showToast('Grouped and baked', 'success');
}

function handleDuplicateSelection() {
    if (multiSelectCount > 0) {
        const ids = [...multiSelected];
        clearMultiSelect();
        runKineticBatch(() => { for (const id of ids) duplicateNode(id); });
        showToast(`Duplicated ${ids.length} node(s)`, 'success', 2000);
    } else if (kinetic.selectedInstanceId) {
        duplicateNode(kinetic.selectedInstanceId);
    }
}

// node search overlay ––––––––––––––––––––––––––––––––––––––––––––––
let searchOpen  = $state(false);
let searchQuery = $state('');
let searchPos   = $state({ x: 0, y: 0 });

// internal:true entries (groupInput/groupInputB/composite) are produced
// only by grouping; never offered here.
const nodeDefList = Object.values(NODE_DEFS).filter(d => !d.internal);
const searchResults = $derived(
    searchQuery.trim() === ''
        ? nodeDefList
        : nodeDefList.filter(d =>
            d.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            d.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
            d.subcategory?.toLowerCase().includes(searchQuery.toLowerCase())
          )
);

function defaultParamsFor(nodeId) {
    const def = NODE_DEFS[nodeId];
    const params = {};
    if (!def) return params;
    for (const [key, p] of Object.entries(def.params ?? {})) params[key] = p.default;
    return params;
}

// context menu –––––––––––––––––––––––––––––––––––––––––––––––––––––
let ctxMenu = $state(null);
const ctxMenuInstance = $derived(
    ctxMenu ? currentInstances().find(n => n.instanceId === ctxMenu.instanceId) ?? null : null
);

function onCtxDuplicate() {
    if (!ctxMenu) return;
    duplicateNode(ctxMenu.instanceId);
    ctxMenu = null;
}
function onCtxCopy() {
    if (!ctxMenu) return;
    const ids = multiSelected.has(ctxMenu.instanceId) && multiSelectCount > 0 ? [...multiSelected] : [ctxMenu.instanceId];
    copySelectionToClipboard(ids);
    ctxMenu = null;
}
function onCtxRename() {
    if (!ctxMenu) return;
    selectNode(ctxMenu.instanceId);
    requestRename(ctxMenu.instanceId);
    ctxMenu = null;
}
function onCtxDisconnect() {
    if (!ctxMenu) return;
    const id = ctxMenu.instanceId;
    runKineticBatch(() => {
        for (const w of currentWires().filter(w => w.fromId === id || w.toId === id)) removeWire(w.id);
    });
    ctxMenu = null;
}
function onCtxUngroup() {
    if (!ctxMenu) return;
    const result = ungroupComposite(ctxMenu.instanceId);
    if (!result.ok) showToast(result.reason ?? 'Could not ungroup', 'error', 4000);
    else showToast('Ungrouped', 'success');
    ctxMenu = null;
}

// port positions –––––––––––––––––––––––––––––––––––––––––––––––––––
function portPos(instance, port) {
    const gx = instance.position?.x ?? 0;
    const gy = instance.position?.y ?? 0;
    if (port === 'output') return { x: gx + NODE_W, y: gy + NODE_H * 0.5 };
    if (port === 'inputB') return { x: gx, y: gy + NODE_H * 0.7 };
    return { x: gx, y: gy + NODE_H * 0.3 };
}

function wirePath(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function findNearestInputPort(graphX, graphY, fromInstanceId) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const instance of currentInstances()) {
        // cannot connect a node to itself
        if (instance.instanceId === fromInstanceId) continue;
        const def = NODE_DEFS[instance.nodeId];
        const possiblePorts = [];
        if (hasInputFor(instance, def)) { possiblePorts.push('input'); }
        if (isMultiInputFor(instance, def)) { possiblePorts.push('inputB'); }
        for (const port of possiblePorts) {
            const pos = portPos(instance, port);
            const dx = graphX - pos.x;
            const dy = graphY - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if ( distance <= WIRE_SNAP_DISTANCE && distance < nearestDistance ) {
                nearest = { instanceId: instance.instanceId, port, x: pos.x, y: pos.y, };
                nearestDistance = distance;
            }
        }
    }
    return nearest;
}

function isSnapTarget(instanceId, port) {
    return (
        pendingWire?.snapTarget?.instanceId === instanceId &&
        pendingWire?.snapTarget?.port === port
    );
}

// per-instance port-count override (composites: 0/1/2 depending on what
// was grouped, per instance. see groupSelectionIntoComposite in the
// store). falls back to the registry default for every other node type.
function hasInputFor(instance, def) { return instance.hasInput ?? def?.hasInput; }
function isMultiInputFor(instance, def) { return instance.isMultiInput ?? def?.isMultiInput; }

// background pan / box-select ––––––––––––––––––––––––––––––––––––––
function onBgPointerDown(e) {
    const isBg = e.target === svgEl || e.target.classList.contains('ng-bg');
    if (isBg && e.button === 0) {
        if (e.shiftKey) {
            const rect = svgEl.getBoundingClientRect();
            const start = screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
            boxSelect = { startX: start.x, startY: start.y, endX: start.x, endY: start.y };
        } else {
            isPanning = true;
            panStart  = { x: e.clientX, y: e.clientY };
            panOrigin = { ...pan };
            svgEl.style.cursor = 'grabbing';
        }
    }
    if (isBg) {
        searchOpen = false;
        ctxMenu = null;
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) clearMultiSelect();
    }
}
function onBgPointerMove(e) {
    if (isPanning) {
        pan = {
            x: panOrigin.x + (e.clientX - panStart.x),
            y: panOrigin.y + (e.clientY - panStart.y),
        };
    }
    if (boxSelect) {
        const rect = svgEl.getBoundingClientRect();
        const cur = screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
        boxSelect = { ...boxSelect, endX: cur.x, endY: cur.y };
    }
    if (pendingWire) {
    const rect = svgEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const graphPos = screenToGraph(cx, cy);
    const snapTarget = findNearestInputPort(graphPos.x, graphPos.y, pendingWire.fromId);
    const previousTarget = pendingWire.snapTarget;
    const targetChanged =
        previousTarget?.instanceId !== snapTarget?.instanceId ||
        previousTarget?.port !== snapTarget?.port;
    if (targetChanged) {
        if (snapTarget) {
            hapticTick();
        } else if (previousTarget) {
            hapticSnap();
        }
    }
    pendingWire = {...pendingWire, cx, cy, snapTarget,};
}
}
function onBgPointerUp() {
    isPanning = false;
    if (svgEl) svgEl.style.cursor = '';
    if (pendingWire) {
        const target = pendingWire.snapTarget;
        if (target) {
            addWire(
                pendingWire.fromId,
                pendingWire.fromPort,
                target.instanceId,
                target.port
            );
        }
        pendingWire = null;
    }
    if (boxSelect) {
        applyBoxSelect(boxSelect);
        boxSelect = null;
    }
}
function onBgWheel(e) {
    e.preventDefault();
    const rect    = svgEl.getBoundingClientRect();
    const mx      = e.clientX - rect.left;
    const my      = e.clientY - rect.top;
    const factor  = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.25, Math.min(3, zoom * factor));
    pan = {
        x: mx - (mx - pan.x) * (newZoom / zoom),
        y: my - (my - pan.y) * (newZoom / zoom),
    };
    zoom = newZoom;
}
function onBgDblClick(e) {
    const isBg = e.target === svgEl || e.target.classList.contains('ng-bg');
    if (!isBg) return;
    const rect  = svgEl.getBoundingClientRect();
    searchPos   = screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
    searchOpen  = true;
    searchQuery = '';
}

// drop handler for NodeMenu's pointer-based drag –––––––––––––––––––
// registered with the shared kineticUiSignals store on mount; called
// directly (not via a window listener) by NodeMenu.svelte's own pointerup
// handler once a drag has actually crossed the move threshold. owns the
// coordinate math (screenToGraph) and hit-testing against its own bounds,
// since NodeMenu has no idea where the canvas is or how it's panned/zoomed.
function tryDropNode(nodeId, clientX, clientY) {
    if (!svgEl || !nodeId) return;
    const def = NODE_DEFS[nodeId];
    if (!def || def.internal) return;
    const rect = svgEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return; // dropped outside this canvas entirely. rip
    }
    const pos = screenToGraph(clientX - rect.left, clientY - rect.top);
    // centre the new card under the cursor rather than anchoring its
    // top-left corner there.
    addNode(nodeId, defaultParamsFor(nodeId), { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 });
}

onMount(() => registerDropHandler(tryDropNode));
onDestroy(() => unregisterDropHandler(tryDropNode));

// node drag / select –––––––––––––––––––––––––––––––––––––––––––––––
function onNodePointerDown(e, instanceId) {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleMultiSelect(instanceId);
        return; // modifier-click is multi-select only, doesn't start a drag or change single-selection
    }
    clearMultiSelect();
    selectNode(instanceId);
    const inst = currentInstances().find(n => n.instanceId === instanceId);
    if (!inst) return;
    const draggedIds = multiSelected.has(instanceId) ? [...multiSelected] : [instanceId];
    const draggedNodes = draggedIds
        .map(id => {
            const node = currentInstances().find(n => n.instanceId === id);
            if (!node) return null;
            return {
                instanceId: id,
                origX: node.position?.x ?? 0,
                origY: node.position?.y ?? 0,
            };
        })
        .filter(Boolean);
    nodeDrag = {
        startX: e.clientX,
        startY: e.clientY,
        nodes: draggedNodes,
    };
    window.addEventListener('pointermove', onNodeDragMove);
    window.addEventListener('pointerup', onNodeDragUp);
}
function onNodeDragMove(e) {
    if (!nodeDrag) return;
    pushKineticUndo();
    const rawDx = (e.clientX - nodeDrag.startX) / zoom;
    const rawDy = (e.clientY - nodeDrag.startY) / zoom;
    // shift = free movement
    const dx = e.shiftKey ? rawDx : snapToGrid(rawDx);
    const dy = e.shiftKey ? rawDy : snapToGrid(rawDy);
    for (const node of nodeDrag.nodes) {
        moveNode(
            node.instanceId,
            node.origX + dx,
            node.origY + dy
        );
    }
}
function onNodeDragUp() {
    nodeDrag = null;
    window.removeEventListener('pointermove', onNodeDragMove);
    window.removeEventListener('pointerup', onNodeDragUp);
}
function nudgeSelection(dx, dy) {
    const ids = multiSelectCount > 0 ? [...multiSelected] : (kinetic.selectedInstanceId ? [kinetic.selectedInstanceId] : []);
    if (!ids.length) return false;
    pushKineticUndo();
    for (const id of ids) {
        const inst = currentInstances().find(n => n.instanceId === id);
        if (inst) moveNode(id, (inst.position?.x ?? 0) + dx, (inst.position?.y ?? 0) + dy);
    }
    return true;
}
function onNodeRightClick(e, instanceId) {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = { x: e.clientX, y: e.clientY, instanceId };
}
function onNodeDblClick(e, instance) {
    e.stopPropagation();
    if (instance.nodeId === 'composite') {
        openComposite(instance.instanceId); // multi-select clearing handled by the graphPath $effect above
    }
}

// ports / wires ––––––––––––––––––––––––––––––––––––––––––––––––––––
function onOutputPortDown(e, instanceId) {
    e.stopPropagation();
    const rect = svgEl.getBoundingClientRect();
    pendingWire = {
        fromId: instanceId, fromPort: 'output',
        cx: e.clientX - rect.left, cy: e.clientY - rect.top,
    };
}
function onInputPortUp(e, instanceId, port) {
    e.stopPropagation();
    if (!pendingWire || pendingWire.fromId === instanceId) { pendingWire = null; return; }
    addWire(pendingWire.fromId, pendingWire.fromPort, instanceId, port);
    pendingWire = null;
}

// search add –––––––––––––––––––––––––––––––––––––––––––––––––––––––
function addFromSearch(nodeId) {
    addNode(nodeId, defaultParamsFor(nodeId), { x: searchPos.x, y: searchPos.y });
    searchOpen = false;
    searchQuery = '';
}

// keyboard –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
function isTyping(e) {
    const tag = e.target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
}
function onKeyDown(e) {
    if (isTyping(e)) return;

    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicateSelection();
        return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const ids = multiSelectCount > 0 ? [...multiSelected] : (kinetic.selectedInstanceId ? [kinetic.selectedInstanceId] : []);
        if (ids.length) copySelectionToClipboard(ids);
        return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const pastedIds = pasteClipboard();
        if (pastedIds.length) {
            clearMultiSelect();
            multiSelected = new Set(pastedIds);
        }
        return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        multiSelected = new Set(currentInstances().map(n => n.instanceId));
        return;
    }
    if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        handleGroup();
        return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoKinetic(); else undoKinetic();
        return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoKinetic();
        return;
    }
    if (e.key === 'Home' || e.key === '.') {
        e.preventDefault();
        resetView();
        return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (multiSelectCount > 0) {
            runKineticBatch(() => { for (const id of multiSelected) removeNode(id); });
            clearMultiSelect();
        } else if (kinetic.selectedInstanceId) removeNode(kinetic.selectedInstanceId);
        else if (kinetic.selectedWireId) removeWire(kinetic.selectedWireId);
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const step = e.shiftKey ? 20 : 4;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (nudgeSelection(dx, dy)) e.preventDefault();
        return;
    }
    if (e.key === 'Escape') {
        if (boxSelect) {
            boxSelect = null;
        } else if (searchOpen || ctxMenu || multiSelectCount > 0) {
            searchOpen = false;
            ctxMenu = null;
            clearMultiSelect();
        } else if (kinetic.graphPath.length) {
            // nothing else to dismiss; back out one composite level, so
            // the breadcrumb isn't the only way out of a nested graph.
            closeComposite();
        }
    }
}


onMount(() => window.addEventListener('keydown', onKeyDown));
onDestroy(() => window.removeEventListener('keydown', onKeyDown));

// bound API for the parent page (KineticPage.svelte's top bar) –––––
// lets a page-level Bake/Group button act on whatever's currently 
// multi-selected in the graph, without promoting multi-select
// itself into shared store state.
export function groupCurrentSelection() { handleGroup(); }
export function bakeCurrentSelection() { handleBake(); }
export function getMultiSelectCount() { return multiSelectCount; }
</script>

<GraphBreadcrumb />

<svg
    bind:this={svgEl}
    class="ng-canvas"
    onpointerdown={onBgPointerDown}
    onpointermove={onBgPointerMove}
    onpointerup={onBgPointerUp}
    onwheel={onBgWheel}
    ondblclick={onBgDblClick}
    oncontextmenu={e => e.preventDefault()}
>
    <defs>
        <pattern id="ng-grid" width={20 * zoom} height={20 * zoom}
            x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)}
            patternUnits="userSpaceOnUse">
            <circle cx="0.5" cy="0.5" r="0.5" fill="var(--color-text-dim)" />
        </pattern>
    </defs>
    <rect class="ng-bg" width="100%" height="100%" fill="url(#ng-grid)" />

    <g transform="translate({pan.x},{pan.y}) scale({zoom})">

        {#each currentWires() as wire (wire.id)}
            {@const fromInst = currentInstances().find(n => n.instanceId === wire.fromId)}
            {@const toInst   = currentInstances().find(n => n.instanceId === wire.toId)}
            {#if fromInst && toInst}
                {@const fp = portPos(fromInst, wire.fromPort)}
                {@const tp = portPos(toInst, wire.toPort)}
                <path
                    class="ng-wire {kinetic.selectedWireId === wire.id ? 'selected' : ''}"
                    d={wirePath(fp.x, fp.y, tp.x, tp.y)}
                    onclick={() => selectWire(wire.id)}
                    ondblclick={() => removeWire(wire.id)}
                />
            {/if}
        {/each}

        {#if pendingWire}
            {@const fromInst = currentInstances().find(n => n.instanceId === pendingWire.fromId)}
            {#if fromInst}
                {@const fp  = portPos(fromInst, pendingWire.fromPort)}
                {@const cursorX = (pendingWire.cx - pan.x) / zoom}
                {@const cursorY = (pendingWire.cy - pan.y) / zoom}
                {@const tgx = pendingWire.snapTarget?.x ?? cursorX}
                {@const tgy = pendingWire.snapTarget?.y ?? cursorY}
                <path class="ng-wire-pending {pendingWire.snapTarget ? 'snapped' : ''}" d={wirePath(fp.x, fp.y, tgx, tgy)} />
            {/if}
        {/if}

        {#each currentInstances() as instance (instance.instanceId)}
            {@const def = NODE_DEFS[instance.nodeId]}
            {@const gx  = instance.position?.x ?? 0}
            {@const gy  = instance.position?.y ?? 0}
            {@const col = def?.color ?? 'hsl(220,15%,50%)'}
            {@const selected = instance.instanceId === kinetic.selectedInstanceId}
            {@const multiSel = multiSelected.has(instance.instanceId)}

            <g
                class="ng-node ng-node-blur {selected ? 'selected' : ''} {multiSel ? 'multi-selected' : ''} {!instance.enabled ? 'bypassed' : ''} {isDimmed(instance.instanceId) ? 'dimmed' : ''}"
                transform="translate({gx},{gy})"
                onpointerdown={e => onNodePointerDown(e, instance.instanceId)}
                oncontextmenu={e => onNodeRightClick(e, instance.instanceId)}
                ondblclick={e => onNodeDblClick(e, instance)}
            >
                <rect x="0" y="0" width={NODE_W} height={NODE_H} rx="8"
                    fill="var(--color-surface-3)" class="ng-node-blur"
                    stroke={multiSel ? 'var(--color-warning)' : (selected ? col : 'rgba(255,255,255,0.10)')}
                    stroke-width={multiSel ? 2 : (selected ? 1.5 : 1)} />
                <rect x="0" y="0" width={NODE_W} height="4" rx="4" fill={col} />
                <rect x="0" y="2" width={NODE_W} height="2" fill={col} />

                <text x="12" y="26" class="ng-node-icon">{def?.icon ?? '?'}</text>
                <text x="30" y="26" class="ng-node-label">{instance.label || def?.label || instance.nodeId}</text>

                {#if instance.nodeId === 'composite'}
                    <text x={NODE_W - 24} y="26" class="ng-node-composite-badge">▣<title>Double-click to open</title></text>
                {/if}
                {#if !instance.enabled}
                    <text x={NODE_W - 10} y="26" class="ng-node-bypass">⏸</text>
                {/if}

                {#if hasInputFor(instance, def)}
                    <circle class="ng-port ng-port-in {isSnapTarget(instance.instanceId, 'input') ? 'snap-target' : ''}" 
                        cx="0" cy={NODE_H * 0.3} r="5"
                        onpointerdown={e => e.stopPropagation()}
                        onpointerup={e => onInputPortUp(e, instance.instanceId, 'input')} />
                {/if}
                {#if isMultiInputFor(instance, def)}
                    <circle class="ng-port ng-port-in ng-port-b {isSnapTarget(instance.instanceId, 'inputB') ? 'snap-target' : ''}" 
                        cx="0" cy={NODE_H * 0.7} r="5"
                        onpointerdown={e => e.stopPropagation()}
                        onpointerup={e => onInputPortUp(e, instance.instanceId, 'inputB')} />
                {/if}
                <circle class="ng-port ng-port-out" cx={NODE_W} cy={NODE_H * 0.5} r="5"
                    onpointerdown={e => onOutputPortDown(e, instance.instanceId)} />
            </g>
        {/each}

        {#if boxSelect}
            {@const bx0 = Math.min(boxSelect.startX, boxSelect.endX)}
            {@const by0 = Math.min(boxSelect.startY, boxSelect.endY)}
            {@const bw  = Math.abs(boxSelect.endX - boxSelect.startX)}
            {@const bh  = Math.abs(boxSelect.endY - boxSelect.startY)}
            <rect class="ng-box-select" x={bx0} y={by0} width={bw} height={bh} />
        {/if}

    </g><!-- end pan/zoom group -->

    {#if currentInstances().length === 0}
        <text x="50%" y="45%" class="ng-empty-h" text-anchor="middle">No nodes yet</text>
        <text x="50%" y="52%" class="ng-empty-s" text-anchor="middle">Double-click, or drag from the Node Menu, to add a node</text>
    {/if}
</svg>

{#if kinetic.devices.length > 1}
    <div class="ng-device-filter">
        <button class="ng-filter-pill {deviceFilterId === null ? 'active' : ''}" onclick={() => deviceFilterId = null}>
            All
        </button>
        {#each kinetic.devices as device (device.id)}
            <button
                class="ng-filter-pill {deviceFilterId === device.id ? 'active' : ''}"
                onclick={() => deviceFilterId = device.id}
                title="Dim nodes that don't reach {device.instanceNo}"
            >{device.instanceNo}{device.isPrimary ? ' ★' : ''}</button>
        {/each}
    </div>
{/if}

{#if multiSelectCount > 0}
    <div class="ng-multiselect-bar">
        <span class="al-dim" style="font-size:11px">{multiSelectCount} selected</span>
        <button class="al-btn al-btn-sm" onclick={handleDuplicateSelection}>⧉ Duplicate</button>
        <button class="al-btn al-btn-sm al-btn-blue" onclick={handleGroup}>▣ Group</button>
        <button class="al-btn al-btn-sm al-btn-green" onclick={handleBake}>⬢ Group + Bake</button>
        <button class="al-btn al-btn-sm al-btn-ghost" onclick={clearMultiSelect}>Cancel</button>
    </div>
{/if}

{#if searchOpen}
    {@const sp = graphToScreen(searchPos.x, searchPos.y)}
    <div class="ng-search-overlay" style="left:{sp.x}px;top:{sp.y}px">
        <input class="al-text-input ng-search-input" type="text"
            bind:value={searchQuery}
            placeholder="Search nodes…"
            autofocus
            onkeydown={e => {
                if (e.key === 'Escape') searchOpen = false;
                if (e.key === 'Enter' && searchResults.length) addFromSearch(searchResults[0].id);
            }}
        />
        <div class="ng-search-list">
            {#each searchResults as def}
                <button class="ng-search-item" onclick={() => addFromSearch(def.id)}>
                    <span>{def.icon}</span>
                    <span class="ng-search-label">{def.label}</span>
                    <span class="ng-search-cat" style="--nc:{def.color}">{def.category}</span>
                </button>
            {/each}
            {#if !searchResults.length}
                <p class="ng-search-empty">No matching nodes</p>
            {/if}
        </div>
    </div>
{/if}

{#if ctxMenu}
    <div class="ng-ctx-menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px" onmouseleave={() => ctxMenu = null}>
        <button class="ng-ctx-item" onclick={() => { toggleNode(ctxMenu.instanceId); ctxMenu = null; }}>
            Toggle bypass
        </button>
        <button class="ng-ctx-item" onclick={onCtxDuplicate}>
            Duplicate
        </button>
        <button class="ng-ctx-item" onclick={onCtxCopy}>
            Copy
        </button>
        <button class="ng-ctx-item" onclick={onCtxRename}>
            Rename…
        </button>
        <button class="ng-ctx-item" onclick={onCtxDisconnect}>
            Disconnect all wires
        </button>
        {#if ctxMenuInstance?.nodeId === 'composite'}
            <button class="ng-ctx-item" onclick={onCtxUngroup}>
                Ungroup
            </button>
        {/if}
        <button class="ng-ctx-item danger" onclick={() => { removeNode(ctxMenu.instanceId); ctxMenu = null; }}>
            Delete node
        </button>
    </div>
{/if}

<style>
.ng-canvas {
    width:    100%;
    height:   100%;
    display:  block;
    outline:  none;
    cursor:   default;
    user-select: none;
}
.ng-bg { cursor: default; }

.ng-wire {
    fill:           none;
    stroke:         var(--color-text-secondary);
    stroke-width:   3;
    cursor:         pointer;
    transition:     stroke 0.1s;
}
.ng-wire:hover    { stroke: var(--color-accent-hover); stroke-width: 4; }
.ng-wire.selected { stroke: var(--color-accent); stroke-width: 5; }
.ng-wire-pending  { fill: none; stroke: var(--color-accent); stroke-width: 2.5; stroke-dasharray: 5 3; pointer-events: none; }
.ng-wire-pending.snapped { stroke-dasharray: none; stroke-width: 3; }

.ng-box-select {
    fill:            var(--color-accent-subtle);
    stroke:          var(--color-accent);
    stroke-width:    1.5;
    stroke-dasharray: 4 3;
    pointer-events:  none;
    vector-effect:   non-scaling-stroke;
}

.ng-node             { cursor: grab; }
.ng-node:active       { cursor: grabbing; }
.ng-node.bypassed     { opacity: 0.4; }
.ng-node.dimmed       { opacity: 0.18; }
.ng-node.multi-selected { filter: drop-shadow(0 0 4px var(--color-warning-glow)); }
.ng-node-blur { backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);}

.ng-device-filter {
    position: absolute;
    top: 10px; left: 10px;
    display: flex; gap: 4px;
    z-index: 20;
}
.ng-filter-pill {
    padding: 4px 10px;
    border: 1px solid var(--color-border-bright);
    border-radius: var(--radius-full);
    background: var(--color-glass-header);
    backdrop-filter: blur(8px);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
}
.ng-filter-pill:hover  { background: var(--color-surface-2); color: var(--color-text); }
.ng-filter-pill.active { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent-text); }

.ng-multiselect-bar {
    position: absolute;
    top: 10px; right: 10px;
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-lg);
    background: var(--color-warning-subtle);
    backdrop-filter: blur(10px);
    z-index: 20;
}

.ng-node-icon  { font-size: 13px; fill: var(--color-text); dominant-baseline: middle; user-select: none; -webkit-user-select: none; }
.ng-node-label { font-size: 12px; fill: var(--color-text); font-weight: 600; dominant-baseline: middle; font-family: inherit; user-select: none; -webkit-user-select: none; }
.ng-node-bypass{ font-size: 11px; fill: rgba(248,113,113,0.8); text-anchor: end; dominant-baseline: middle; user-select: none; -webkit-user-select: none; }
.ng-node-composite-badge { font-size: 11px; fill: rgba(255,255,255,0.5); text-anchor: end; dominant-baseline: middle; user-select: none; -webkit-user-select: none; }

.ng-port {
    cursor:         crosshair;
    stroke-width:   2;
    transition:     r 0.1s, fill 0.1s;
}
.ng-port-in  { fill: rgba(43,127,255,0.6); stroke: #2b7fff; }
.ng-port-out { fill: rgba(34,197,94,0.6);  stroke: #22c55e; }
.ng-port-b   { fill: rgba(248,113,113,0.6);stroke: #f87171; }
.ng-port:hover { r: 7; }
.ng-port.snap-target { r: 8; filter: drop-shadow(0 0 5px var(--color-accent)); }

.ng-empty-h { font-size: 18px; fill: var(--color-text); font-weight: 600; user-select: none; -webkit-user-select: none; }
.ng-empty-s { font-size: 13px; fill: var(--color-text-dim); user-select: none; -webkit-user-select: none; }

.ng-search-overlay {
    position:  fixed;
    z-index:   200;
    width:     220px;
    background:var(--color-glass-modal);
    border:    1px solid var(--color-border-bright);
    border-radius: var(--radius-lg);
    box-shadow:var(--shadow-modal);
    backdrop-filter: blur(16px);
    overflow:  hidden;
}
.ng-search-input {
    border:        none;
    border-bottom: 1px solid var(--color-border);
    border-radius: 0;
    background:    transparent;
}
.ng-search-list { max-height: 240px; overflow-y: auto; }
.ng-search-item {
    display:       flex;
    align-items:   center;
    gap:           8px;
    width:         100%;
    padding:       8px 12px;
    background:    transparent;
    border:        none;
    color:         var(--color-text-secondary);
    font-size:     12px;
    font-family:   inherit;
    text-align:    left;
    cursor:        pointer;
    user-select: none;
    -webkit-user-select: none;
}
.ng-search-item:hover { background: var(--color-surface-2); color: var(--color-text); }
.ng-search-label { flex: 1; font-weight: 500; }
.ng-search-cat   { font-size: 10px; color:var(--nc); }
.ng-search-empty { padding: 10px 12px; font-size: 11px; color: var(--color-text-dim); }

.ng-ctx-menu {
    position:      fixed;
    z-index:       300;
    min-width:     150px;
    background:    var(--color-glass-modal);
    border:        1px solid var(--color-border-bright);
    border-radius: var(--radius-md);
    box-shadow:    var(--shadow-modal);
    backdrop-filter: blur(12px);
    overflow:      hidden;
}
.ng-ctx-item {
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
    user-select: none;
    -webkit-user-select: none;
}
.ng-ctx-item:hover        { background: var(--color-surface-2); }
.ng-ctx-item.danger:hover { background: var(--color-danger-subtle); color: var(--color-danger); }
</style>