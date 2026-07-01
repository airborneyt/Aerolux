<!-- src/components/studio/SplineAdvancedEditor.svelte -->
<!--
    Advanced spline editor. Renders as a slide-up drawer anchored to the
    bottom of the Kinetic workspace. Does not block the node graph.

    Props:
      points     [ControlPoint[]] — current control points (bound two-way)
      curved     boolean
      tension    number 0–1
      smoothing  string
      onclose    () => void
      onchange   (points, curved, tension, smoothing) => void
-->
<script>
import { onMount } from 'svelte';

let {
    points    = $bindable([]),
    curved    = $bindable(true),
    tension   = $bindable(0.5),
    smoothing = $bindable('catmull-rom'),
    onclose   = () => {},
    onchange  = () => {},
} = $props();

// ── Canvas ────────────────────────────────────────────────────────
let canvas, ctx;
let dpr   = 1;

// ── Editor state ──────────────────────────────────────────────────
// Working copy — committed on close/apply
let pts = $state(points.map(deepCopy));

// Selection
let selIdx    = $state(null);   // selected point index
let dragState = $state(null);
// dragState: { kind: 'point'|'handleIn'|'handleOut', idx: number,
//              startX, startY, startCol, startRow }

// Grid config (10×10 with absent corners)
const COLS = 10, ROWS = 10;
const ABSENT = new Set(['0,0','0,9','9,0','9,9']);
const GRID_PAD = 20;   // canvas padding in logical px
let canvasSize = $state(480);

function isAbsent(col, row) {
    return ABSENT.has(`${col},${row}`);
}

function padW(size) { return (size - 2*GRID_PAD) / COLS; }
function padH(size) { return (size - 2*GRID_PAD) / ROWS; }

function gridToCanvas(col, row, size) {
    const w = padW(size), h = padH(size);
    return {
        x: GRID_PAD + col * w + w / 2,
        y: GRID_PAD + (9 - row) * h + h / 2,   // row 0 at bottom
    };
}

function canvasToGrid(x, y, size) {
    const w = padW(size), h = padH(size);
    const col = Math.max(0, Math.min(9, Math.round((x - GRID_PAD - w/2) / w)));
    const row = Math.max(0, Math.min(9, 9 - Math.round((y - GRID_PAD - h/2) / h)));
    return { col, row };
}

function deepCopy(p) {
    return {
        col:       p.col,
        row:       p.row,
        type:      p.type ?? 'corner',
        handleIn:  p.handleIn  ? { ...p.handleIn  } : null,
        handleOut: p.handleOut ? { ...p.handleOut } : null,
    };
}

// ── Spline preview (re-uses pure math from spline.js logic inlined) ──

function catmullSegment(p0, p1, p2, p3, t) {
    const t2 = t*t, t3 = t2*t;
    return {
        col: 0.5*(2*p1.col+(-p0.col+p2.col)*t+(2*p0.col-5*p1.col+4*p2.col-p3.col)*t2+(-p0.col+3*p1.col-3*p2.col+p3.col)*t3),
        row: 0.5*(2*p1.row+(-p0.row+p2.row)*t+(2*p0.row-5*p1.row+4*p2.row-p3.row)*t2+(-p0.row+3*p1.row-3*p2.row+p3.row)*t3),
    };
}

function bezierSegment(p1, p2, t) {
    const h1 = p1.handleOut ?? p1, h2 = p2.handleIn ?? p2;
    const mt = 1-t, mt2=mt*mt, mt3=mt2*mt, t2=t*t, t3=t2*t;
    return {
        col: mt3*p1.col+3*mt2*t*h1.col+3*mt*t2*h2.col+t3*p2.col,
        row: mt3*p1.row+3*mt2*t*h1.row+3*mt*t2*h2.row+t3*p2.row,
    };
}

function sampleCurve(pts, curved, nSamples = 400) {
    if (pts.length < 2) return pts.map(p => ({ col: p.col, row: p.row }));
    const segs = pts.length - 1;
    const spp  = Math.max(Math.floor(nSamples / segs), 8);
    const out  = [];
    const ext  = [pts[0], ...pts, pts[pts.length-1]];
    if (!curved) {
        for (let i = 0; i < segs; i++) {
            for (let j = 0; j <= spp; j++) {
                const t = j / spp;
                out.push({ col: pts[i].col + t*(pts[i+1].col-pts[i].col),
                           row: pts[i].row + t*(pts[i+1].row-pts[i].row) });
            }
        }
        return out;
    }
    for (let i = 1; i < ext.length-2; i++) {
        const p0=ext[i-1],p1=ext[i],p2=ext[i+1],p3=ext[i+2];
        const usesBezier = p1.handleOut || p2.handleIn;
        for (let j = 0; j <= spp; j++) {
            const t = j / spp;
            out.push(usesBezier ? bezierSegment(p1, p2, t) : catmullSegment(p0,p1,p2,p3,t));
        }
    }
    return out;
}

// ── Drawing ───────────────────────────────────────────────────────

function draw() {
    if (!ctx) return;
    const S = canvasSize;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const w = padW(S), h = padH(S);

    // Grid
    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const px = GRID_PAD + col * w;
            const py = GRID_PAD + (9 - row) * h;
            if (isAbsent(col, row)) {
                ctx.fillStyle = 'rgba(255,255,255,0.015)';
            } else {
                const side = col === 0 || col === 9 || row === 0 || row === 9;
                ctx.fillStyle = side ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.09)';
            }
            ctx.beginPath();
            ctx.roundRect(px, py, w - 1, h - 1, 3);
            ctx.fill();
        }
    }

    // Spline curve
    if (pts.length >= 2 && curved) {
        const samples = sampleCurve(pts, true);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(43,127,255,0.6)';
        ctx.lineWidth   = 2;
        ctx.shadowColor = '#2b7fff';
        ctx.shadowBlur  = 6;
        samples.forEach((s, i) => {
            const { x, y } = gridToCanvas(s.col, s.row, S);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
    } else if (pts.length >= 2) {
        // Linear preview
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(43,127,255,0.4)';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 4]);
        pts.forEach((p, i) => {
            const { x, y } = gridToCanvas(p.col, p.row, S);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Bezier handles (for selected point)
    if (selIdx !== null) {
        const p = pts[selIdx];
        const pc = gridToCanvas(p.col, p.row, S);

        for (const key of ['handleIn', 'handleOut']) {
            if (!p[key]) continue;
            const hc = gridToCanvas(p[key].col, p[key].row, S);
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,200,60,0.5)';
            ctx.lineWidth   = 1;
            ctx.setLineDash([3, 3]);
            ctx.moveTo(pc.x, pc.y);
            ctx.lineTo(hc.x, hc.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Handle dot
            ctx.beginPath();
            ctx.fillStyle = 'hsl(38,90%,60%)';
            ctx.arc(hc.x, hc.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth   = 1;
            ctx.stroke();
        }
    }

    // Control points
    pts.forEach((p, i) => {
        const { x, y } = gridToCanvas(p.col, p.row, S);
        const isSel  = selIdx === i;
        const isFirst = i === 0, isLast = i === pts.length - 1;

        // Pad highlight
        const col = Math.max(0, Math.min(9, Math.round(p.col)));
        const row = Math.max(0, Math.min(9, Math.round(p.row)));
        const px = GRID_PAD + col * w;
        const py = GRID_PAD + (9 - row) * h;
        ctx.fillStyle = 'rgba(43,127,255,0.18)';
        ctx.strokeStyle = isSel ? '#2b7fff' : 'rgba(43,127,255,0.5)';
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(px, py, w - 1, h - 1, 3);
        ctx.fill();
        ctx.stroke();

        // Dot
        ctx.shadowColor = isSel ? '#2b7fff' : 'transparent';
        ctx.shadowBlur  = isSel ? 8 : 0;
        ctx.fillStyle   = isFirst ? '#22c55e' : isLast ? '#f87171' : '#2b7fff';
        ctx.beginPath();
        ctx.arc(x, y, isSel ? 6 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur  = 0;

        // Index label
        ctx.fillStyle    = '#fff';
        ctx.font         = 'bold 9px monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y);
    });

    ctx.restore();
}

// ── Interaction ───────────────────────────────────────────────────

function hitTestPoint(x, y) {
    const S = canvasSize;
    for (let i = 0; i < pts.length; i++) {
        const c = gridToCanvas(pts[i].col, pts[i].row, S);
        if (Math.hypot(c.x - x, c.y - y) < 12) return { kind: 'point', idx: i };
    }
    // Handle hit test for selected point
    if (selIdx !== null) {
        const p = pts[selIdx];
        for (const key of ['handleIn', 'handleOut']) {
            if (!p[key]) continue;
            const c = gridToCanvas(p[key].col, p[key].row, S);
            if (Math.hypot(c.x - x, c.y - y) < 9) return { kind: key, idx: selIdx };
        }
    }
    return null;
}

function canvasEvent(e) {
    const rect  = canvas.getBoundingClientRect();
    const scale = canvasSize / rect.width;
    return {
        x: (e.clientX - rect.left) * scale,
        y: (e.clientY - rect.top)  * scale,
    };
}

function onPointerDown(e) {
    const { x, y } = canvasEvent(e);
    const hit = hitTestPoint(x, y);

    if (e.button === 2) {
        // Right-click on point: remove it (min 2 points)
        if (hit?.kind === 'point' && pts.length > 2) {
            pts.splice(hit.idx, 1);
            if (selIdx !== null && selIdx >= pts.length) selIdx = pts.length - 1;
            emit(); draw();
        }
        return;
    }

    if (hit) {
        selIdx = hit.idx;
        const gp = canvasToGrid(x, y, canvasSize);
        const src = hit.kind === 'point' ? pts[hit.idx]
            : pts[hit.idx][hit.kind];
        dragState = {
            kind:      hit.kind,
            idx:       hit.idx,
            startX:    x, startY: y,
            startCol:  src.col, startRow: src.row,
        };
    } else {
        // Add new point
        const gp = canvasToGrid(x, y, canvasSize);
        const newPt = { col: gp.col, row: gp.row, type: 'smooth', handleIn: null, handleOut: null };
        pts.push(newPt);
        selIdx = pts.length - 1;
        dragState = { kind: 'point', idx: selIdx, startX: x, startY: y, startCol: gp.col, startRow: gp.row };
        emit(); draw();
    }
}

function onPointerMove(e) {
    if (!dragState) return;
    const { x, y } = canvasEvent(e);
    const gp = canvasToGrid(x, y, canvasSize);

    if (dragState.kind === 'point') {
        pts[dragState.idx].col = gp.col;
        pts[dragState.idx].row = gp.row;
        // If symmetric, move handles proportionally
        const p = pts[dragState.idx];
        if (p.type === 'symmetric' && p.handleOut) {
            const dcol = gp.col - dragState.startCol;
            const drow = gp.row - dragState.startRow;
            if (p.handleIn)  { p.handleIn.col  += dcol; p.handleIn.row  += drow; }
            if (p.handleOut) { p.handleOut.col += dcol; p.handleOut.row += drow; }
        }
    } else {
        // Moving a handle
        const handle = pts[dragState.idx][dragState.kind];
        if (handle) {
            handle.col = gp.col;
            handle.row = gp.row;
            // Symmetric: mirror the other handle
            const p    = pts[dragState.idx];
            if (p.type === 'symmetric') {
                const other = dragState.kind === 'handleIn' ? 'handleOut' : 'handleIn';
                const dc = p.col - gp.col;
                const dr = p.row - gp.row;
                if (!p[other]) p[other] = { col: p.col, row: p.row };
                p[other].col = p.col + dc;
                p[other].row = p.row + dr;
            }
        }
    }
    draw();
}

function onPointerUp() {
    if (dragState) { emit(); }
    dragState = null;
}

// ── Handle creation helpers ───────────────────────────────────────

function addHandles(idx) {
    const p    = pts[idx];
    const prev = idx > 0              ? pts[idx-1] : null;
    const next = idx < pts.length-1  ? pts[idx+1] : null;
    // Default handle: 1/3 of the way to neighbours
    const hicol = prev ? p.col + (prev.col - p.col) * 0.33 : p.col - 1;
    const hirow = prev ? p.row + (prev.row - p.row) * 0.33 : p.row;
    const hocol = next ? p.col + (next.col - p.col) * 0.33 : p.col + 1;
    const horow = next ? p.row + (next.row - p.row) * 0.33 : p.row;
    p.handleIn  = { col: Math.max(0,Math.min(9,hicol)), row: Math.max(0,Math.min(9,hirow)) };
    p.handleOut = { col: Math.max(0,Math.min(9,hocol)), row: Math.max(0,Math.min(9,horow)) };
    emit(); draw();
}

function removeHandles(idx) {
    pts[idx].handleIn  = null;
    pts[idx].handleOut = null;
    pts[idx].type      = 'corner';
    emit(); draw();
}

function setPointType(idx, type) {
    pts[idx].type = type;
    if (type !== 'corner' && !pts[idx].handleOut) addHandles(idx);
    emit(); draw();
}

// ── Emit changes ──────────────────────────────────────────────────

function emit() {
    onchange(pts.map(deepCopy), curved, tension, smoothing);
}

function applyAndClose() {
    // Commit working copy back to the bound prop
    points = pts.map(deepCopy);
    emit();
    onclose();
}

// ── Lifecycle ─────────────────────────────────────────────────────

onMount(() => {
    dpr = window.devicePixelRatio || 1;
    canvas.width  = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    canvas.style.width  = canvasSize + 'px';
    canvas.style.height = canvasSize + 'px';
    ctx = canvas.getContext('2d');
    draw();
});

$effect(() => {
    // Redraw when pts or options change
    void [pts.length, curved, tension, smoothing, selIdx];
    if (ctx) draw();
});

const selPoint = $derived(selIdx !== null ? pts[selIdx] : null);
</script>

<!-- Slide-up drawer — sits above the timeline, below the node graph -->
<div class="sae-backdrop" onclick={onclose}></div>

<div class="sae-drawer">

    <!-- Header -->
    <div class="sae-header">
        <span class="sae-title">Advanced Spline Editor</span>
        <div class="sae-header-actions">
            <span class="al-hint-text" style="font-size:10px">
                Click = add point · Drag = move · Right-click = remove
            </span>
            <button class="al-btn al-btn-blue" onclick={applyAndClose}>Apply & Close</button>
            <button class="al-btn al-btn-danger" onclick={onclose}>Discard</button>
        </div>
    </div>

    <div class="sae-body">

        <!-- Canvas -->
        <div class="sae-canvas-wrap">
            <canvas
                bind:this={canvas}
                class="sae-canvas"
                onpointerdown={onPointerDown}
                onpointermove={onPointerMove}
                onpointerup={onPointerUp}
                onpointerleave={onPointerUp}
                oncontextmenu={e => e.preventDefault()}
            ></canvas>
            <div class="sae-legend">
                <span class="sae-legend-dot" style="background:#22c55e"></span>Start
                <span class="sae-legend-dot" style="background:#f87171;margin-left:8px"></span>End
                <span class="sae-legend-dot" style="background:#2b7fff;margin-left:8px"></span>Midpoint
                <span class="sae-legend-dot" style="background:hsl(38,90%,60%);margin-left:8px"></span>Handle
            </div>
        </div>

        <!-- Right controls -->
        <div class="sae-controls">

            <!-- Curve global options -->
            <div class="sae-section">
                <p class="al-label">Curve</p>
                <label class="al-toggle-wrap" style="margin-bottom:8px">
                    <input type="checkbox" bind:checked={curved}
                        onchange={() => { emit(); draw(); }} />
                    <span class="al-dim">Curved</span>
                </label>

                {#if curved}
                    <p class="al-label">Mode</p>
                    <div class="al-pill-group" style="flex-direction:column;gap:3px">
                        {#each [
                            { value: 'catmull-rom', label: 'Catmull-Rom' },
                            { value: 'bezier',      label: 'Bezier'      },
                            { value: 'cardinal',    label: 'Cardinal'    },
                        ] as opt}
                            <button
                                class="al-pill {smoothing === opt.value ? 'active' : ''}"
                                style="justify-content:flex-start"
                                onclick={() => { smoothing = opt.value; emit(); draw(); }}
                            >{opt.label}</button>
                        {/each}
                    </div>

                    <p class="al-label" style="margin-top:10px">Tension</p>
                    <div class="al-range-row">
                        <input type="range" min="0" max="1" step="0.01"
                            bind:value={tension}
                            oninput={() => { emit(); draw(); }} />
                        <span class="al-val">{tension.toFixed(2)}</span>
                    </div>
                {/if}
            </div>

            <!-- Selected point controls -->
            <div class="sae-section">
                <p class="al-label">Selected point
                    {#if selIdx !== null}
                        <span class="al-dim" style="font-weight:400;text-transform:none;letter-spacing:0">
                            · #{selIdx + 1}
                        </span>
                    {/if}
                </p>

                {#if selPoint}
                    <!-- Position inputs -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
                        <div>
                            <p class="al-label" style="font-size:9px">Col</p>
                            <input type="number" class="al-num-input" style="width:100%"
                                min="0" max="9"
                                value={selPoint.col}
                                onchange={e => {
                                    pts[selIdx].col = Math.max(0, Math.min(9, parseInt(e.target.value)||0));
                                    emit(); draw();
                                }} />
                        </div>
                        <div>
                            <p class="al-label" style="font-size:9px">Row</p>
                            <input type="number" class="al-num-input" style="width:100%"
                                min="0" max="9"
                                value={selPoint.row}
                                onchange={e => {
                                    pts[selIdx].row = Math.max(0, Math.min(9, parseInt(e.target.value)||0));
                                    emit(); draw();
                                }} />
                        </div>
                    </div>

                    <!-- Point type -->
                    <p class="al-label">Point type</p>
                    <div class="al-pill-group" style="flex-direction:column;gap:3px;margin-bottom:8px">
                        {#each [
                            { value: 'corner',    label: 'Corner: sharp angle'     },
                            { value: 'smooth',    label: 'Smooth: independent handles' },
                            { value: 'symmetric', label: 'Symmetric: mirrored handles' },
                        ] as opt}
                            <button
                                class="al-pill {selPoint.type === opt.value ? 'active' : ''}"
                                style="justify-content:flex-start;font-size:11px"
                                onclick={() => setPointType(selIdx, opt.value)}
                            >{opt.label}</button>
                        {/each}
                    </div>

                    <!-- Handle controls -->
                    {#if selPoint.type !== 'corner'}
                        {#if !selPoint.handleOut}
                            <button class="al-btn" style="width:100%"
                                onclick={() => addHandles(selIdx)}>
                                + Add Bezier handles
                            </button>
                        {:else}
                            <button class="al-btn al-btn-ghost" style="width:100%;font-size:11px"
                                onclick={() => removeHandles(selIdx)}>
                                Remove handles
                            </button>

                            <!-- Handle-in coords -->
                            <p class="al-label" style="margin-top:8px;color:hsl(38,90%,60%)">
                                In-handle
                            </p>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
                                <div>
                                    <p class="al-label" style="font-size:9px">Col</p>
                                    <input type="number" class="al-num-input" style="width:100%"
                                        min="0" max="9"
                                        value={selPoint.handleIn?.col ?? selPoint.col}
                                        onchange={e => {
                                            if (!pts[selIdx].handleIn) pts[selIdx].handleIn = { col: pts[selIdx].col, row: pts[selIdx].row };
                                            pts[selIdx].handleIn.col = Math.max(0,Math.min(9,parseInt(e.target.value)||0));
                                            emit(); draw();
                                        }} />
                                </div>
                                <div>
                                    <p class="al-label" style="font-size:9px">Row</p>
                                    <input type="number" class="al-num-input" style="width:100%"
                                        min="0" max="9"
                                        value={selPoint.handleIn?.row ?? selPoint.row}
                                        onchange={e => {
                                            if (!pts[selIdx].handleIn) pts[selIdx].handleIn = { col: pts[selIdx].col, row: pts[selIdx].row };
                                            pts[selIdx].handleIn.row = Math.max(0,Math.min(9,parseInt(e.target.value)||0));
                                            emit(); draw();
                                        }} />
                                </div>
                            </div>

                            <!-- Handle-out coords -->
                            <p class="al-label" style="color:hsl(38,90%,60%)">Out-handle</p>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                                <div>
                                    <p class="al-label" style="font-size:9px">Col</p>
                                    <input type="number" class="al-num-input" style="width:100%"
                                        min="0" max="9"
                                        value={selPoint.handleOut?.col ?? selPoint.col}
                                        onchange={e => {
                                            if (!pts[selIdx].handleOut) pts[selIdx].handleOut = { col: pts[selIdx].col, row: pts[selIdx].row };
                                            pts[selIdx].handleOut.col = Math.max(0,Math.min(9,parseInt(e.target.value)||0));
                                            emit(); draw();
                                        }} />
                                </div>
                                <div>
                                    <p class="al-label" style="font-size:9px">Row</p>
                                    <input type="number" class="al-num-input" style="width:100%"
                                        min="0" max="9"
                                        value={selPoint.handleOut?.row ?? selPoint.row}
                                        onchange={e => {
                                            if (!pts[selIdx].handleOut) pts[selIdx].handleOut = { col: pts[selIdx].col, row: pts[selIdx].row };
                                            pts[selIdx].handleOut.row = Math.max(0,Math.min(9,parseInt(e.target.value)||0));
                                            emit(); draw();
                                        }} />
                                </div>
                            </div>
                        {/if}
                    {/if}

                    <!-- Delete point -->
                    {#if pts.length > 2}
                        <button class="al-btn al-btn-danger"
                            style="width:100%;margin-top:10px"
                            onclick={() => {
                                pts.splice(selIdx, 1);
                                selIdx = Math.min(selIdx, pts.length - 1);
                                emit(); draw();
                            }}>
                            Delete point
                        </button>
                    {/if}

                {:else}
                    <p class="al-hint-text">Click a point on the canvas to select it.</p>
                {/if}
            </div>

            <!-- Point list -->
            <div class="sae-section" style="flex:1;min-height:0;overflow-y:auto">
                <p class="al-label">All points ({pts.length})</p>
                {#each pts as p, i}
                    <div
                        class="sae-pt-row {selIdx === i ? 'selected' : ''}"
                        onclick={() => { selIdx = i; draw(); }}
                    >
                        <span class="sae-pt-dot" style="background:{i===0?'#22c55e':i===pts.length-1?'#f87171':'#2b7fff'}"></span>
                        <span class="sae-pt-label">#{i+1}</span>
                        <span class="al-dim" style="font-family:'Geist Mono',monospace;font-size:10px">
                            ({p.col}, {p.row})
                        </span>
                        <span class="sae-pt-type">{p.type}</span>
                    </div>
                {/each}
            </div>

        </div>
    </div>
</div>

<style>
/* Backdrop */
.sae-backdrop {
    position:   fixed;
    inset:      0;
    z-index:    400;
    background: rgba(0,0,0,0.25);
}

/* Drawer */
.sae-drawer {
    position:       fixed;
    bottom:         0;
    left:           180px;   /* clear node menu */
    right:          280px;   /* clear inspector */
    z-index:        401;
    height:         75vh;
    width:          80vw;
    background:     var(--color-glass-modal);
    backdrop-filter:         blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border-top:     1px solid var(--color-border-bright);
    border-left:    1px solid var(--color-border);
    border-right:   1px solid var(--color-border);
    border-radius:  var(--radius-xl) var(--radius-xl) 0 0;
    box-shadow:     0 -8px 40px rgba(0,0,0,0.5);
    display:        flex;
    flex-direction: column;
    overflow:       hidden;
    animation:      sae-slide-up 0.22s cubic-bezier(0.34,1.2,0.64,1) both;
}

@keyframes sae-slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
}

/* Header */
.sae-header {
    display:         flex;
    align-items:     center;
    justify-content: space-between;
    padding:         12px 20px;
    border-bottom:   1px solid var(--color-border);
    flex-shrink:     0;
    gap:             12px;
}
.sae-title {
    font-size:   14px;
    font-weight: 600;
    flex-shrink: 0;
}
.sae-header-actions {
    display:     flex;
    align-items: center;
    gap:         8px;
    flex-wrap:   wrap;
}

/* Body */
.sae-body {
    display:    flex;
    flex:       1;
    min-height: 0;
    overflow:   hidden;
}

/* Canvas area */
.sae-canvas-wrap {
    flex-shrink: 0;
    padding:     16px;
    display:     flex;
    flex-direction: column;
    gap:         8px;
    align-items: flex-start;
}
.sae-canvas {
    display:       block;
    border-radius: var(--radius-lg);
    background:    rgba(0,0,0,0.5);
    border:        1px solid var(--color-border);
    cursor:        crosshair;
}
.sae-legend {
    display:     flex;
    align-items: center;
    gap:         4px;
    font-size:   10px;
    color:       var(--color-text-dim);
}
.sae-legend-dot {
    display:       inline-block;
    width:         8px;
    height:        8px;
    border-radius: 50%;
    flex-shrink:   0;
}

/* Controls panel */
.sae-controls {
    flex:           1;
    min-width:      0;
    overflow-y:     auto;
    padding:        16px;
    display:        flex;
    flex-direction: column;
    gap:            16px;
    border-left:    1px solid var(--color-border);
}
.sae-section {
    display:        flex;
    flex-direction: column;
    gap:            6px;
    padding-bottom: 14px;
    border-bottom:  1px solid rgba(255,255,255,0.05);
}
.sae-section:last-child { border-bottom: none; }

/* Point list */
.sae-pt-row {
    display:       flex;
    align-items:   center;
    gap:           7px;
    padding:       5px 8px;
    border-radius: var(--radius-sm);
    cursor:        pointer;
    transition:    background 0.1s;
    font-size:     11px;
}
.sae-pt-row:hover    { background: var(--color-surface-2); }
.sae-pt-row.selected { background: var(--color-accent-subtle); }
.sae-pt-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sae-pt-label{ font-weight: 600; min-width: 24px; font-family: 'Geist Mono', monospace; }
.sae-pt-type { margin-left: auto; color: var(--color-text-dim); font-size: 10px; }
</style>