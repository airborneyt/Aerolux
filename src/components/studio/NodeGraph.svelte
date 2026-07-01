<!-- src/components/studio/NodeGraph.svelte -->
<!--
    Pannable, zoomable canvas node graph.
    Nodes are draggable cards. Output ports connect to input ports with wires.
    Double-click empty space to open node search.
    Right-click a node to open context menu.
-->
<script>
import { onMount, onDestroy } from 'svelte';
import { kinetic, addNode, removeNode, addWire, removeWire,
         moveNodeOnCanvas, toggleNode } from '../../stores/kinetic.svelte.js';
import { NODE_BY_ID, NODE_CATEGORIES } from '../../lib/aerolux/nodeRegistry.js';
import { showToast } from '../../lib/aerolux/toast.js';

let container;
let svgEl;

// Pan / zoom
let pan  = $state({ x: 60, y: 40 });
let zoom = $state(1);
let isPanning  = false;
let panStart   = { x: 0, y: 0 };
let panOrigin  = { x: 0, y: 0 };

// Wire dragging
let pendingWire = $state(null);
// { fromInstanceId, fromPort, startX, startY, curX, curY }

// Node search overlay
let searchOpen    = $state(false);
let searchQuery   = $state('');
let searchPos     = $state({ x: 0, y: 0 });   // graph coords for new node

// Context menu
let ctxMenu = $state(null);   // { x, y, instanceId }

// Port positions cache: `${instanceId}:${port}` → { x, y } in graph coords
let portPos = new Map();

function graphToScreen(gx, gy) {
    return { x: gx * zoom + pan.x, y: gy * zoom + pan.y };
}
function screenToGraph(sx, sy) {
    return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom };
}

// ── Filtered node list for search ─────────────────────────────────
const filteredNodes = $derived(
    kinetic.nodeInstances.filter(n =>
        !searchQuery ||
        NODE_BY_ID[n.nodeId]?.label.toLowerCase().includes(searchQuery.toLowerCase())
    )
);

const searchResults = $derived(
    Object.values(NODE_BY_ID).filter(desc =>
        !searchQuery ||
        desc.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        desc.category.toLowerCase().includes(searchQuery.toLowerCase())
    ).slice(0, 12)
);

// ── Background pan ────────────────────────────────────────────────
function onBgPointerDown(e) {
    if (e.target !== svgEl && e.target !== svgEl.querySelector('.ng-bg')) return;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanning = true;
        panStart  = { x: e.clientX, y: e.clientY };
        panOrigin = { ...pan };
        svgEl.style.cursor = 'grabbing';
    }
    ctxMenu = null;
    searchOpen = false;
}

function onBgPointerMove(e) {
    if (isPanning) {
        pan = {
            x: panOrigin.x + (e.clientX - panStart.x),
            y: panOrigin.y + (e.clientY - panStart.y),
        };
    }
    if (pendingWire) {
        const rect = svgEl.getBoundingClientRect();
        pendingWire.curX = e.clientX - rect.left;
        pendingWire.curY = e.clientY - rect.top;
    }
}

function onBgPointerUp(e) {
    isPanning = false;
    svgEl.style.cursor = '';
    if (pendingWire) {
        pendingWire = null;   // cancelled
    }
}

function onBgWheel(e) {
    e.preventDefault();
    const rect     = svgEl.getBoundingClientRect();
    const mx       = e.clientX - rect.left;
    const my       = e.clientY - rect.top;
    const factor   = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom  = Math.max(0.25, Math.min(3, zoom * factor));
    pan = {
        x: mx - (mx - pan.x) * (newZoom / zoom),
        y: my - (my - pan.y) * (newZoom / zoom),
    };
    zoom = newZoom;
}

function onBgDblClick(e) {
    const rect  = svgEl.getBoundingClientRect();
    const gp    = screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
    searchPos   = gp;
    searchOpen  = true;
    searchQuery = '';
}

// ── Node dragging ─────────────────────────────────────────────────
let nodeDrag = null;

function onNodePointerDown(e, instanceId) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const node = kinetic.nodeInstances.find(n => n.instanceId === instanceId);
    if (!node) return;
    kinetic.selectedNodeIds = new Set([instanceId]);
    nodeDrag = {
        instanceId,
        startX: e.clientX, startY: e.clientY,
        origX: node.position?.x ?? 0, origY: node.position?.y ?? 0,
    };
    window.addEventListener('pointermove', onNodeDragMove);
    window.addEventListener('pointerup',   onNodeDragUp);
}

function onNodeDragMove(e) {
    if (!nodeDrag) return;
    const dx = (e.clientX - nodeDrag.startX) / zoom;
    const dy = (e.clientY - nodeDrag.startY) / zoom;
    moveNodeOnCanvas(nodeDrag.instanceId, nodeDrag.origX + dx, nodeDrag.origY + dy);
}

function onNodeDragUp() {
    nodeDrag = null;
    window.removeEventListener('pointermove', onNodeDragMove);
    window.removeEventListener('pointerup',   onNodeDragUp);
}

// ── Port interaction ──────────────────────────────────────────────

function onPortPointerDown(e, instanceId, port, isOutput) {
    e.stopPropagation();
    if (!isOutput) return;   // can only drag from outputs
    const rect = svgEl.getBoundingClientRect();
    pendingWire = {
        fromInstanceId: instanceId,
        fromPort: port,
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        curX:   e.clientX - rect.left,
        curY:   e.clientY - rect.top,
    };
}

function onPortPointerUp(e, instanceId, port, isOutput) {
    if (!pendingWire || isOutput) return;
    e.stopPropagation();
    if (pendingWire.fromInstanceId === instanceId) { pendingWire = null; return; }
    addWire(pendingWire.fromInstanceId, pendingWire.fromPort, instanceId, port);
    pendingWire = null;
}

// ── Node right-click ──────────────────────────────────────────────

function onNodeRightClick(e, instanceId) {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = { x: e.clientX, y: e.clientY, instanceId };
}

// ── Node card dimensions ──────────────────────────────────────────
const NODE_W = 180;
const NODE_H_BASE = 60;

function nodeHeight(desc) {
    return NODE_H_BASE + Object.keys(desc?.params ?? {}).length * 0;
}

// ── Wire path ─────────────────────────────────────────────────────
function wirePath(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function getPortScreenPos(instanceId, port) {
    return portPos.get(`${instanceId}:${port}`) ?? { x: 0, y: 0 };
}

// Port positions are tracked via ref callbacks on the SVG foreignObject port elements
// We use a simple approximation based on node position + known layout:
function computePortPos(instance, port) {
    const gx = instance.position?.x ?? 0;
    const gy = instance.position?.y ?? 0;
    const desc = NODE_BY_ID[instance.nodeId];
    const h   = nodeHeight(desc);
    if (port === 'output') return { x: gx + NODE_W, y: gy + h / 2 };
    if (port === 'input')  return { x: gx,         y: gy + h * 0.35 };
    if (port === 'inputB') return { x: gx,         y: gy + h * 0.65 };
    return { x: gx, y: gy };
}

// ── Category colour ───────────────────────────────────────────────
function categoryColor(category) {
    return NODE_CATEGORIES[category?.toUpperCase()]?.timelineColor
        ?? NODE_BY_ID[category]?.timelineColor
        ?? 'hsl(220,15%,50%)';
}

// Search add
function addFromSearch(nodeId) {
    addNode(nodeId, { x: searchPos.x, y: searchPos.y });
    searchOpen  = false;
    searchQuery = '';
}

const knobParams = $derived.by(() =>
    Object.entries(desc?.params ?? {})
        .filter(([,p]) =>
            p.type === 'knob' || p.type === 'float'
        )
        .slice(0, 2)
);
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
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
    <!-- Background grid -->
    <defs>
        <pattern id="ng-grid" width={20 * zoom} height={20 * zoom}
            x={pan.x % (20 * zoom)} y={pan.y % (20 * zoom)}
            patternUnits="userSpaceOnUse">
            <circle cx="0.5" cy="0.5" r="0.5" fill="rgba(255,255,255,0.06)" />
        </pattern>
    </defs>
    <rect class="ng-bg" width="100%" height="100%" fill="url(#ng-grid)" />

    <!-- Transform group for pan/zoom -->
    <g transform="translate({pan.x},{pan.y}) scale({zoom})">

        <!-- Wires -->
        {#each kinetic.wires as wire (wire.id)}
            {@const fromPos = computePortPos(
                kinetic.nodeInstances.find(n => n.instanceId === wire.fromInstanceId) ?? {},
                wire.fromPort
            )}
            {@const toPos = computePortPos(
                kinetic.nodeInstances.find(n => n.instanceId === wire.toInstanceId) ?? {},
                wire.toPort
            )}
            <path
                class="ng-wire {kinetic.selectedWireId === wire.id ? 'selected' : ''}"
                d={wirePath(fromPos.x, fromPos.y, toPos.x, toPos.y)}
                onclick={() => kinetic.selectedWireId = wire.id}
                ondblclick={() => { removeWire(wire.id); kinetic.selectedWireId = null; }}
            />
        {/each}

        <!-- Pending wire -->
        {#if pendingWire}
            {@const fromPos = computePortPos(
                kinetic.nodeInstances.find(n => n.instanceId === pendingWire.fromInstanceId) ?? {},
                pendingWire.fromPort
            )}
            <path class="ng-wire-pending"
                d={wirePath(
                    fromPos.x, fromPos.y,
                    (pendingWire.curX - pan.x) / zoom,
                    (pendingWire.curY - pan.y) / zoom
                )}
            />
        {/if}

        <!-- Nodes -->
        {#each kinetic.nodeInstances as instance (instance.instanceId)}
            {@const desc = NODE_BY_ID[instance.nodeId]}
            {@const gx   = instance.position?.x ?? 0}
            {@const gy   = instance.position?.y ?? 0}
            {@const h    = nodeHeight(desc)}
            {@const col  = desc?.timelineColor ?? 'hsl(220,15%,50%)'}
            {@const selected = kinetic.selectedNodeIds.has(instance.instanceId)}

            <g
                class="ng-node {selected ? 'selected' : ''} {!instance.enabled ? 'bypassed' : ''}"
                transform="translate({gx},{gy})"
                onpointerdown={e => onNodePointerDown(e, instance.instanceId)}
                oncontextmenu={e => onNodeRightClick(e, instance.instanceId)}
            >
                <!-- Node body -->
                <rect x="0" y="0" width={NODE_W} height={h} rx="8"
                    fill="rgba(18,22,40,0.90)"
                    stroke={selected ? col : 'rgba(255,255,255,0.10)'}
                    stroke-width={selected ? 1.5 : 1} />

                <!-- Category colour bar at top -->
                <rect x="0" y="0" width={NODE_W} height="4" rx="4"
                    fill={col} />
                <rect x="0" y="2" width={NODE_W} height="2"
                    fill={col} />

                <!-- Icon + label -->
                <text x="12" y="26" class="ng-node-icon">{desc?.icon ?? '?'}</text>
                <text x="30" y="26" class="ng-node-label">{desc?.label ?? instance.nodeId}</text>

                <!-- Bypass indicator -->
                {#if !instance.enabled}
                    <text x={NODE_W - 10} y="26" class="ng-node-bypass">⏸</text>
                {/if}

                <!-- Param summary (first 2 knob/float params) -->
                {#each knobParams as [key, pd], i}
                    <text x="12" y={42 + i * 14} class="ng-param-text">
                        {pd.label}: {instance.params[key]?.toFixed?.(pd.decimals ?? 1) ?? instance.params[key]}{pd.unit ?? ''}
                    </text>
                {/each}

                <!-- Input port(s) -->
                {#if desc?.hasInput !== false} 
                <circle class="ng-port ng-port-in"
                    cx="0" cy={h * 0.35} r="5"
                    onpointerdown={e => onPortPointerDown(e, instance.instanceId, 'input', false)}
                    onpointerup={e => onPortPointerUp(e, instance.instanceId, 'input', false)}
                    title="Input A"
                />
                {#if desc?.isMultiInput}
                    <circle class="ng-port ng-port-in ng-port-b"
                        cx="0" cy={h * 0.65} r="5"
                        onpointerdown={e => onPortPointerDown(e, instance.instanceId, 'inputB', false)}
                        onpointerup={e => onPortPointerUp(e, instance.instanceId, 'inputB', false)}
                        title="Input B (overlay)"
                    />
                {/if}
                {/if}

                <!-- Output port -->
                <circle class="ng-port ng-port-out"
                    cx={NODE_W} cy={h * 0.5} r="5"
                    onpointerdown={e => onPortPointerDown(e, instance.instanceId, 'output', true)}
                    title="Output"
                />
            </g>
        {/each}

    </g><!-- end pan/zoom group -->

    <!-- Empty state -->
    {#if kinetic.nodeInstances.length === 0}
        <text x="50%" y="45%" class="ng-empty-h" text-anchor="middle">No nodes yet</text>
        <text x="50%" y="52%" class="ng-empty-s" text-anchor="middle">
            Double-click to add a node · Drag nodes from the menu
        </text>
    {/if}

</svg>

<!-- Node search overlay (screen space, not inside SVG transform) -->
{#if searchOpen}
    {@const sp = graphToScreen(searchPos.x, searchPos.y)}
    <div class="ng-search-overlay" style="left:{sp.x}px;top:{sp.y}px">
        <input class="al-text-input ng-search-input" type="text"
            bind:value={searchQuery}
            placeholder="Search nodes…"
            autofocus
            onkeydown={e => {
                if (e.key === 'Escape') { searchOpen = false; }
                if (e.key === 'Enter' && searchResults.length) addFromSearch(searchResults[0].id);
            }}
        />
        <div class="ng-search-list">
            {#each searchResults as desc}
                <button class="ng-search-item" onclick={() => addFromSearch(desc.id)}>
                    <span>{desc.icon}</span>
                    <span class="ng-search-label">{desc.label}</span>
                    <span class="ng-search-cat">{desc.category}</span>
                </button>
            {/each}
        </div>
    </div>
{/if}

<!-- Context menu -->
{#if ctxMenu}
    <div class="ng-ctx-menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px"
        onmouseleave={() => ctxMenu = null}>
        <button class="ng-ctx-item" onclick={() => { toggleNode(ctxMenu.instanceId); ctxMenu = null; }}>
            Toggle bypass
        </button>
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
    background: rgba(8,10,22,0.6);
}

/* Wires */
.ng-wire {
    fill:           none;
    stroke:         rgba(255,255,255,0.25);
    stroke-width:   3;
    cursor:         pointer;
    transition:     stroke 0.1s;
}
.ng-wire:hover    { stroke: rgba(255,255,255,0.55); stroke-width: 4; }
.ng-wire.selected { stroke: var(--color-accent); stroke-width: 5; }
.ng-wire-pending  { fill: none; stroke: var(--color-accent); stroke-width: 2.5; stroke-dasharray: 5 3; }

/* Nodes */
.ng-node         { cursor: grab; }
.ng-node:active  { cursor: grabbing; }
.ng-node.bypassed{ opacity: 0.4; }

.ng-node-icon  { font-size: 13px; fill: rgba(255,255,255,0.7); dominant-baseline: middle; }
.ng-node-label { font-size: 12px; fill: #e8e4da; font-weight: 600; dominant-baseline: middle; font-family: inherit; }
.ng-node-bypass{ font-size: 11px; fill: rgba(248,113,113,0.8); text-anchor: end; dominant-baseline: middle; }
.ng-param-text { font-size: 10px; fill: rgba(255,255,255,0.35); font-family: 'Geist Mono', monospace; dominant-baseline: middle; }

/* Ports */
.ng-port {
    cursor:         crosshair;
    stroke-width:   2;
    transition:     r 0.1s, fill 0.1s;
}
.ng-port-in  { fill: rgba(43,127,255,0.6); stroke: #2b7fff; }
.ng-port-out { fill: rgba(34,197,94,0.6);  stroke: #22c55e; }
.ng-port-b   { fill: rgba(248,113,113,0.6);stroke: #f87171; }
.ng-port:hover { r: 7; }

/* Empty state */
.ng-empty-h { font-size: 18px; fill: rgba(255,255,255,0.2); font-weight: 600; }
.ng-empty-s { font-size: 13px; fill: rgba(255,255,255,0.12); }

/* Search overlay */
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
}
.ng-search-item:hover { background: var(--color-surface-2); color: var(--color-text); }
.ng-search-label { flex: 1; font-weight: 500; }
.ng-search-cat   { font-size: 10px; color: var(--color-text-dim); }

/* Context menu */
.ng-ctx-menu {
    position:      fixed;
    z-index:       300;
    min-width:     140px;
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
}
.ng-ctx-item:hover        { background: var(--color-surface-2); }
.ng-ctx-item.danger:hover { background: var(--color-danger-subtle); color: var(--color-danger); }
</style>