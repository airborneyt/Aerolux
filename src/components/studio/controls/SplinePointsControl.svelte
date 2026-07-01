<script>
import { onMount } from 'svelte';

let {
    value    = [{ col: 1, row: 1, type: 'corner', handleIn: null, handleOut: null },
                { col: 8, row: 8, type: 'corner', handleIn: null, handleOut: null }],
    device   = 'LPP2',
    onchange = /** @type {(pts:any[])=>void} */ (() => {}),
} = $props();

const SIZE    = 240;
const COLS    = 10;
const ROWS    = 10;
const GAP     = 2;
const RADIUS  = 2.5;
const ABSENT  = new Set(['0,0','0,9','9,0','9,9']);

let canvas = $state(null);
let ctx    = null;
let dpr    = 1;

let pts    = $state(value.map(p => ({ ...p })));
let dragIdx = -1;

function pw() { return (SIZE - GAP * (COLS + 1)) / COLS; }
function ph() { return (SIZE - GAP * (ROWS + 1)) / ROWS; }

function isAbsent(col, row) { return ABSENT.has(`${col},${row}`); }

function gridToXY(col, row) {
    return {
        x: GAP + col * (pw() + GAP) + pw() / 2,
        y: GAP + (9 - row) * (ph() + GAP) + ph() / 2,
    };
}

function xyToGrid(x, y) {
    const col = Math.max(0, Math.min(9, Math.round((x - GAP - pw()/2) / (pw() + GAP))));
    const row = Math.max(0, Math.min(9, 9 - Math.round((y - GAP - ph()/2) / (ph() + GAP))));
    return { col, row };
}

function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    const s = SIZE / r.width;
    return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s };
}

function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = pw(), H = ph();

    // Grid slots
    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const x = GAP + col * (W + GAP);
            const y = GAP + (9 - row) * (H + GAP);
            if (isAbsent(col, row)) {
                ctx.fillStyle = 'rgba(255,255,255,0.012)';
            } else {
                const side = col === 0 || col === 9 || row === 0 || row === 9;
                ctx.fillStyle = side ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
            }
            ctx.beginPath();
            ctx.roundRect(x, y, W, H, RADIUS);
            ctx.fill();
        }
    }

    // Line between points
    if (pts.length >= 2) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(43,127,255,0.5)';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([3, 3]);
        pts.forEach((p, i) => {
            const { x, y } = gridToXY(p.col, p.row);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Points
    pts.forEach((p, i) => {
        const { x, y } = gridToXY(p.col, p.row);
        const px = GAP + p.col * (W + GAP);
        const py = GAP + (9 - p.row) * (H + GAP);

        // Pad highlight
        ctx.fillStyle   = 'rgba(43,127,255,0.18)';
        ctx.strokeStyle = '#2b7fff';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.roundRect(px, py, W, H, RADIUS);
        ctx.fill();
        ctx.stroke();

        // Dot
        const col = i === 0 ? '#22c55e' : i === pts.length - 1 ? '#f87171' : '#2b7fff';
        ctx.shadowColor = col;
        ctx.shadowBlur  = 5;
        ctx.fillStyle   = col;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Index
        ctx.fillStyle    = '#fff';
        ctx.font         = `bold ${Math.max(6, W * 0.3)}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y);
    });

    ctx.restore();
}

function emit() { onchange(pts.map(p => ({ ...p }))); }

function onPointerDown(e) {
    const { x, y } = canvasXY(e);
    const pad = xyToGrid(x, y);

    if (e.button === 2) {
        const idx = pts.findIndex(p => p.col === pad.col && p.row === pad.row);
        if (idx !== -1 && pts.length > 2) {
            pts.splice(idx, 1);
            draw(); emit();
        }
        return;
    }

    const hitIdx = pts.findIndex(p => {
        const c = gridToXY(p.col, p.row);
        return Math.hypot(c.x - x, c.y - y) < pw() * 0.9;
    });

    if (hitIdx !== -1) {
        dragIdx = hitIdx;
    } else {
        pts.push({ col: pad.col, row: pad.row, type: 'corner', handleIn: null, handleOut: null });
        dragIdx = pts.length - 1;
        draw(); emit();
    }
}

function onPointerMove(e) {
    if (dragIdx === -1) return;
    const { x, y } = canvasXY(e);
    const pad = xyToGrid(x, y);
    pts[dragIdx].col = pad.col;
    pts[dragIdx].row = pad.row;
    draw();
}

function onPointerUp() {
    if (dragIdx !== -1) { dragIdx = -1; emit(); }
}

onMount(() => {
    dpr = window.devicePixelRatio || 1;
    canvas.width       = SIZE * dpr;
    canvas.height      = SIZE * dpr;
    canvas.style.width  = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    ctx = canvas.getContext('2d');
    draw();
});

$effect(() => {
    void pts.length;
    if (ctx) draw();
});
</script>

<div class="spc-wrap">
    <div class="spc-legend">
        <span class="spc-dot" style="background:#22c55e"></span>Start
        <span class="spc-dot" style="background:#f87171;margin-left:8px"></span>End
        <span class="spc-dot" style="background:#2b7fff;margin-left:8px"></span>Mid
        <span class="al-dim" style="margin-left:auto;font-size:10px">{pts.length} pts</span>
    </div>
    <canvas
        bind:this={canvas}
        style="display:block;border-radius:var(--radius-md);
               background:rgba(0,0,0,0.45);border:1px solid var(--color-border);
               cursor:crosshair"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointerleave={onPointerUp}
        oncontextmenu={e => e.preventDefault()}
    ></canvas>
    <p class="al-hint-text" style="font-size:10px">
        Click = add · Drag = move · Right-click = remove
    </p>
</div>

<style>
.spc-wrap   { display: flex; flex-direction: column; gap: 5px; }
.spc-legend { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--color-text-dim); }
.spc-dot    { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
</style>