<script>
// ════════════════════════════════════════════════════════════════════
// VirtualLP.svelte — WebGL2 Launchpad preview
// Colour pipeline: sRGB 6-bit palette → linear light → P3 (if avail)
// Instanced rendering: one draw call for all pads per frame.
// ════════════════════════════════════════════════════════════════════
import { onMount, onDestroy } from 'svelte';
import { buildLaunchpadGrid, cellBySysexPad, ZONE } from '../../lib/aerolux/midi-layout.js';

// ── Props ─────────────────────────────────────────────────────────
let {
    device        = 'LPP2',
    sysexColors   = new Map(),   // Map<sysexPad, [r6,g6,b6]>
    size          = 300,
    interactive   = true,
    pressedPads   = new Set(),
    onPadPress    = (/** @type {number} */ _sx) => {},
    onPadRelease  = (/** @type {number} */ _sx) => {},
    brightness    = 1.0,         // 0.0–1.0, applied in linear light
    logoOrMode    = 'logo',      // 'logo'|'mode' — which drives the shared output
} = $props();

// ── Layout constants ──────────────────────────────────────────────
const GAP        = 2.5;   // px between pads
const CORNER     = 3.5;   // border-radius (used in hit-test shape, not WebGL)
const MODE_RATIO = 0.55;  // mode-light row height as fraction of normal pad height

// ── Pad definitions ───────────────────────────────────────────────
// Build from midi-layout so this is the single source of truth.
// We build for LPP3 (widest profile) and also include all 4 corners
// plus the mode light as synthetic entries.

// Synthetic zone tags for cells not in midi-layout
const ZONE_CORNER_TL = 'corner_tl';
const ZONE_CORNER_TR = 'corner_tr'; // also logo
const ZONE_CORNER_BL = 'corner_bl';
const ZONE_CORNER_BR = 'corner_br';
const ZONE_MODE      = 'mode';

// Build the full cell list once — reactive only to `device` changes.
// Each entry: { sysexPad, x, y, zone, exportNote }
// We extend with the 4 corners and mode light as synthetic cells.
function buildCells(dev) {
    const base = buildLaunchpadGrid(dev);

    // 4 corners — use coordinate positions matching the 10×10 grid
    // Top-left  (0,9): SysEx 90
    // Top-right (9,9): SysEx 99 — logo, already in base as ZONE.LOGO
    // Bottom-left  (0,0): virtual, no real SysEx on most models
    // Bottom-right (9,0): virtual
    // We add corners not already present and tag them clearly.
    const extra = [
        { sysexPad: 90,   x: 0,   y: 9, zone: ZONE_CORNER_TL, exportNote: null },
        // (9,9) logo already exists in base — we tag it additionally as corner_tr below
        { sysexPad: null, x: 0,   y: 0, zone: ZONE_CORNER_BL, exportNote: null },
        { sysexPad: null, x: 9,   y: 0, zone: ZONE_CORNER_BR, exportNote: null },
        // Mode light — below the bottom edge, centred at x=4.5, y=-1
        { sysexPad: 99,   x: 4.5, y: -1, zone: ZONE_MODE,     exportNote: 27  },
    ];

    // Re-tag the logo cell from base as corner_tr for rendering purposes
    const cells = base.map(c =>
        c.zone === ZONE.LOGO ? { ...c, zone: ZONE_CORNER_TR } : c
    );

    return [...cells, ...extra];
}

// ── Layout math ───────────────────────────────────────────────────
// The display grid is 10 columns × 10 rows (x=0..9, y=0..9, top-left origin
// in display space), plus a short mode-light row below.
// y=9 in coord space → display row 0 (top); y=0 → display row 9 (bottom).
// x=0..9 in coord space → display col 0..9.
//
// Total vertical space: 10 normal rows + 10 gaps + 1 mode gap + mode row
// size = 11*GAP + 10*padH + modeGap + modeH
// modeH = padH * MODE_RATIO
// → padH = (size - 12*GAP - modeGap) / (10 + MODE_RATIO)
// We set modeGap = GAP*2 for a clear visual separation.

const MODE_GAP = GAP * 2;

function layoutMetrics(sz) {
    const padH = (sz - (11 * GAP) - MODE_GAP - 0) / (10 + MODE_RATIO);
    const padW = (sz - (11 * GAP)) / 10;
    const modeH = padH * MODE_RATIO;
    return { padW, padH, modeH };
}

// Convert a cell's (x,y) coord to canvas pixel (top-left of the pad).
// x,y in Launchpad coord space (x=0..9, y=-1..9; y=9=top).
// Returns null for cells outside the renderable area.
function cellToPixel(cell, sz) {
    const { padW, padH, modeH } = layoutMetrics(sz);

    if (cell.y === -1) {
        // Mode light row — below display row 9
        const px = GAP + cell.x * (padW + GAP) - padW / 2; // centred at x=4.5
        const py = GAP + 10 * (padH + GAP) + MODE_GAP;
        return { px, py, pw: padW, ph: modeH };
    }

    // Normal grid rows: y=9 → dispRow=0 (top), y=0 → dispRow=9 (bottom)
    const dispRow = 9 - cell.y;
    const dispCol = cell.x;

    // Fractional x (e.g. logo at x=4.5 on mk2) — centre the pad
    const px = GAP + dispCol * (padW + GAP);
    const py = GAP + dispRow * (padH + GAP);
    return { px, py, pw: padW, ph: padH };
}

// ── WebGL state ───────────────────────────────────────────────────
let canvas  = $state(null);
let gl      = null;
let isP3    = false;
let isF16   = false;
let prog    = null;
let vao     = null;
let colTex  = null;      // 128×1 RGBA texture, one texel per SysEx pad
let colData = null;      // Float32Array (128*4) or Uint8Array
let dpr     = 1;
let dirty   = true;
let rafId   = null;

// Uniform locations
let uRes, uBrightness, uColTex;
// Attribute locations (per-instance)
let aRect, aColIdx, aPressed;

// ── Programmer menu state ─────────────────────────────────────────
let progMenuOpen  = $state(false);
let labelMode     = $state('none');   // 'none'|'sysex'|'note'|'xy'

// ── GLSL shaders ─────────────────────────────────────────────────
// Vertex: receives per-instance rect (x,y,w,h in CSS px), colour-texture
//         index, and pressed flag. Outputs UV for colour lookup.
//
// sRGB→P3 matrix (IEC 61966-2-1 → SMPTE EG 432-1, both linear light):
// [ 0.8225  0.1774  0.0000 ]
// [ 0.0332  0.9669  0.0000 ]  (rows are P3 R,G,B)
// [ 0.0171  0.0724  0.9108 ]

const VS = `#version 300 es
precision highp float;

// Per-instance attributes
in vec4  aRect;     // x, y, w, h  (CSS pixels, top-left origin)
in float aColIdx;   // SysEx pad index 0-127; -1 = unlit/virtual
in float aPressed;  // 0 or 1

uniform vec2 uRes;  // canvas CSS size in px

out vec2  vUV;      // 0..1 within the pad
flat out float vColIdx;
flat out float vPressed;

void main() {
    // Expand unit quad [-0.5..0.5] to pad rect
    vec2 quad[4];
    quad[0] = vec2(0.0, 0.0);
    quad[1] = vec2(1.0, 0.0);
    quad[2] = vec2(0.0, 1.0);
    quad[3] = vec2(1.0, 1.0);

    vec2 q = quad[gl_VertexID];
    vec2 pos = vec2(aRect.x, aRect.y) + q * vec2(aRect.z, aRect.w);

    // Convert to clip space (y-flip: CSS y=0 is top, GL y=0 is bottom)
    vec2 clip = (pos / uRes) * 2.0 - 1.0;
    clip.y = -clip.y;

    gl_Position = vec4(clip, 0.0, 1.0);
    vUV         = q;
    vColIdx     = aColIdx;
    vPressed    = aPressed;
}
`;

// Fragment: samples colour texture.
// brightness, and pressed highlight.
const FS = `#version 300 es
precision highp float;

uniform sampler2D uColTex;
uniform float     uBrightness;

in vec2  vUV;
flat in float vColIdx;
flat in float vPressed;

out vec4 fragColor;

void main() {
    vec3 bg  = vec3(0.012);
    vec3 col = bg;

    if (vColIdx >= 0.0) {
        float u   = (vColIdx + 0.5) / 128.0;
        vec4  tex = texture(uColTex, vec2(u, 0.5));
        vec3  raw = tex.rgb * uBrightness;
        col = dot(raw, vec3(1.0)) > 0.001 ? raw : bg;
    }

    if (vPressed > 0.5) col += vec3(0.06);



    fragColor = vec4(col, 1.0);
}`;

// ── WebGL init ────────────────────────────────────────────────────
function initGL(sz) {
    dpr = window.devicePixelRatio || 1;
    canvas.width  = size;
    canvas.height = size; // square — mode light fits within

    // Probe context capabilities
    const ctxAttribs = { alpha: false, antialias: false, depth: false, stencil: false };

    // Try display-p3 + float16 first
    let attempt = { ...ctxAttribs, colorSpace: 'display-p3' };
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) { console.warn('VirtualLP: WebGL2 unavailable'); return false; }
    gl.getExtension('EXT_color_buffer_float');

    // Shader compile
    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            console.error('VirtualLP shader error:', gl.getShaderInfoLog(s));
        return s;
    }

    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        console.error('VirtualLP link error:', gl.getProgramInfoLog(prog));

    // Uniform locations
    uRes        = gl.getUniformLocation(prog, 'uRes');
    uBrightness = gl.getUniformLocation(prog, 'uBrightness');
    uColTex     = gl.getUniformLocation(prog, 'uColTex');

    // Attribute locations
    aRect    = gl.getAttribLocation(prog, 'aRect');
    aColIdx  = gl.getAttribLocation(prog, 'aColIdx');
    aPressed = gl.getAttribLocation(prog, 'aPressed');

    // VAO + instance buffers — populated in buildInstanceBuffers()
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Colour texture — 128×1 RGBA32F (linear light)
    colTex  = gl.createTexture();
    colData = new Float32Array(128 * 4); // rgba per pad
    gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 128, 1, 0,
                  gl.RGBA, gl.FLOAT, colData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindVertexArray(null);

    buildInstanceBuffers(sz);
    return true;
}

// ── Instance buffers ──────────────────────────────────────────────
// Each pad = one instance. Instance data: rect(4f) + colIdx(1f) + pressed(1f)
// We rebuild when device or size changes.

let instanceCount  = 0;
let rectBuf        = null;
let colIdxBuf      = null;
let pressedBuf     = null;
let padEntries     = []; // { cell, px, py, pw, ph } — for hit testing

function buildInstanceBuffers(sz) {
    if (!gl) return;

    const cells = buildCells(device);
    padEntries  = [];

    const rects    = [];
    const colIdxs  = [];
    const presseds = [];

    for (const cell of cells) {
        // Skip the ZONE.MODE cell from base (we handle it via synthetic ZONE_MODE)
        if (cell.zone === ZONE.MODE) continue;

        const pix = cellToPixel(cell, sz);
        if (!pix) continue;

        const { px, py, pw, ph } = pix;
        padEntries.push({ cell, px, py, pw, ph });

        rects.push(px, py, pw, ph);
        colIdxs.push(cell.sysexPad !== null ? cell.sysexPad : -1);
        presseds.push(0);
    }

    instanceCount = padEntries.length;

    gl.bindVertexArray(vao);

    // Rect buffer — vec4, per instance
    if (!rectBuf) rectBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rects), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aRect);
    gl.vertexAttribPointer(aRect, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aRect, 1);

    // ColIdx buffer — float, per instance
    if (!colIdxBuf) colIdxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colIdxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colIdxs), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aColIdx);
    gl.vertexAttribPointer(aColIdx, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aColIdx, 1);

    // Pressed buffer — float, per instance, updated each frame
    if (!pressedBuf) pressedBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pressedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(presseds), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPressed);
    gl.vertexAttribPointer(aPressed, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aPressed, 1);

    gl.bindVertexArray(null);
    dirty = true;
}

// ── Colour texture upload ─────────────────────────────────────────
function uploadColours() {
    if (!gl || !colTex) return;

    colData.fill(0);

    const map = sysexColors instanceof Map ? sysexColors : new Map();

    for (const [pad, rgb] of map) {
        if (pad < 0 || pad > 127) continue;
        const r6 = rgb[0] ?? 0;
        const g6 = rgb[1] ?? 0;
        const b6 = rgb[2] ?? 0;
        // 6-bit → [0,1] → linear light (sRGB EOTF)
        const i = pad * 4;
        colData[i + 0] = r6 / 63;
        colData[i + 1] = g6 / 63;
        colData[i + 2] = b6 / 63;
        colData[i + 3] = 1.0;
    }

    gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 1,
                     gl.RGBA, gl.FLOAT, colData);
    dirty = true;
}

// ── Pressed buffer update ─────────────────────────────────────────
function uploadPressed() {
    if (!gl || !pressedBuf || !padEntries.length) return;
    const data = new Float32Array(instanceCount);
    for (let i = 0; i < padEntries.length; i++) {
        const sx = padEntries[i].cell.sysexPad;
        data[i] = sx !== null && pressedPads.has(sx) ? 1 : 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, pressedBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    dirty = true;
}

// ── Draw ──────────────────────────────────────────────────────────
function draw() {
    if (!gl || !prog || !vao) return;

    const W = canvas.width;
    const H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.012, 0.012, 0.012, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(prog);
    gl.uniform2f(uRes, size, size);  // CSS px
    gl.uniform1f(uBrightness, brightness);
    gl.uniform1i(uColTex, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colTex);

    gl.bindVertexArray(vao);
    // 4 vertices per quad (triangle strip), instanceCount instances
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
    gl.bindVertexArray(null);

    dirty = false;
}

// ── Render loop ───────────────────────────────────────────────────
function loop() {
    if (dirty) draw();
    rafId = requestAnimationFrame(loop);
}

// ── Hit testing ───────────────────────────────────────────────────
function hitTest(cx, cy) {
    const rect  = canvas.getBoundingClientRect();
    const scale = size / rect.width;
    const lx    = (cx - rect.left)  * scale;
    const ly    = (cy - rect.top)   * scale;
    for (const { cell, px, py, pw, ph } of padEntries) {
        if (lx >= px && lx <= px + pw && ly >= py && ly <= py + ph)
            return cell.sysexPad;
    }
    return null;
}

let _held = new Set();

function onPointerDown(e) {
    if (!interactive) return;
    canvas.setPointerCapture(e.pointerId);
    const sx = hitTest(e.clientX, e.clientY);
    if (sx !== null && !_held.has(sx)) { _held.add(sx); onPadPress(sx); }
}

function onPointerMove(e) {
    if (!interactive || !_held.size) return;
    const sx = hitTest(e.clientX, e.clientY);
    if (sx !== null && !_held.has(sx)) { _held.add(sx); onPadPress(sx); }
}

function onPointerUp() {
    for (const sx of _held) onPadRelease(sx);
    _held.clear();
}

// ── Programmer menu (Alt key) ─────────────────────────────────────
function onKeyDown(e) { if (e.key === 'Alt') { e.preventDefault(); progMenuOpen = true;  } }
function onKeyUp(e)   { if (e.key === 'Alt')   progMenuOpen = false; }

// ── Lifecycle ─────────────────────────────────────────────────────
onMount(() => {
    if (initGL(size)) {
        uploadColours();
        loop();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
});

onDestroy(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup',   onKeyUp);
    // Clean up GL resources
    if (gl) {
        gl.deleteProgram(prog);
        gl.deleteTexture(colTex);
        gl.deleteBuffer(rectBuf);
        gl.deleteBuffer(colIdxBuf);
        gl.deleteBuffer(pressedBuf);
        gl.deleteVertexArray(vao);
    }
});

// ── Reactive effects ──────────────────────────────────────────────

// Device or size change → full rebuild
$effect(() => {
    void [device, size];
    if (gl) {
        canvas.width  = size * dpr;
        canvas.height = size * dpr;
        buildInstanceBuffers(size);
        uploadColours();
    }
});

// Colour map change → texture upload only (dirty flag set inside)
let _prevColRef = null;
$effect(() => {
    const ref = sysexColors instanceof Map ? sysexColors : null;
    // Track both reference change and Map size change
    const sig = ref ? ref.size : 0;
    void sig;
    if (gl && (ref !== _prevColRef || sig !== _prevColRef?.size)) {
        _prevColRef = ref;
        uploadColours();
    }
});

// Pressed pads change → pressed buffer only
$effect(() => {
    void pressedPads.size;
    if (gl) uploadPressed();
});

// Brightness change → just mark dirty, uniform is set each draw
$effect(() => {
    void brightness;
    dirty = true;
});
</script>

<!-- ── Canvas shell ──────────────────────────────────────────────── -->
<div class="vlp-shell" style="width:{size}px;height:{size}px;position:relative">
    <canvas
        bind:this={canvas}
        class="vlp-canvas"
        style="cursor:{interactive ? 'crosshair' : 'default'};display:block;width:{size}px;height:{size}px"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
    ></canvas>

    <!-- Programmer menu overlay (Alt held) -->
    {#if progMenuOpen}
        <div class="vlp-prog-menu" onclick={e => e.stopPropagation()}>
            <p class="vlp-prog-title">Programmer</p>

            <label class="vlp-prog-row">
                <span>Labels</span>
                <select bind:value={labelMode} class="vlp-prog-select">
                    <option value="none">None</option>
                    <option value="sysex">SysEx pad</option>
                    <option value="note">Export note</option>
                    <option value="xy">x,y</option>
                </select>
            </label>

            <label class="vlp-prog-row">
                <span>Brightness</span>
                <!-- Brightness slider — port this wherever needed in the app -->
                <input
                    type="range" min="0" max="1" step="0.01"
                    value={brightness}
                    oninput={e => brightness = parseFloat(e.target.value)}
                    class="vlp-prog-slider"
                />
                <span class="vlp-prog-val">{Math.round(brightness * 100)}%</span>
            </label>

            <label class="vlp-prog-row">
                <span>Corner</span>
                <select
                    value={logoOrMode}
                    onchange={e => logoOrMode = e.target.value}
                    class="vlp-prog-select"
                >
                    <option value="logo">Logo light</option>
                    <option value="mode">Mode light</option>
                </select>
            </label>

            <label class="vlp-prog-row">
                <span>Device</span>
                <select bind:value={device} class="vlp-prog-select">
                    <option value="LPX">Launchpad X</option>
                    <option value="LPP2">Pro MK2</option>
                    <option value="LPP3">Pro MK3</option>
                </select>
            </label>

            <p class="vlp-prog-hint">Hold Alt to keep open · release to close</p>
        </div>
    {/if}

    <!-- Canvas label overlay (SVG, zero-cost when labelMode=none) -->
    {#if labelMode !== 'none'}
        <svg class="vlp-labels"
             width={size} height={size}
             style="position:absolute;top:0;left:0;pointer-events:none">
            {#each padEntries as { cell, px, py, pw, ph }}
                {@const label = labelMode === 'sysex'  ? (cell.sysexPad ?? '—')
                               : labelMode === 'note'   ? (cell.exportNote ?? '—')
                               : `${cell.x},${cell.y}`}
                <text
                    x={px + pw / 2}
                    y={py + ph / 2}
                    text-anchor="middle"
                    dominant-baseline="middle"
                    font-size={Math.max(5, pw * 0.27)}
                    font-family="monospace"
                    fill="rgba(255,255,255,0.35)"
                >{label}</text>
            {/each}
        </svg>
    {/if}
</div>

<style>
.vlp-shell {
    overflow:       hidden;
    background:     #000;
    border:         1px solid var(--color-border, rgba(255,255,255,0.08));
}

.vlp-canvas {
    image-rendering: pixelated;
}

/* ── Programmer menu ─────────────────────────────────────────── */
.vlp-prog-menu {
    position:        absolute;
    top:             8px;
    left:            8px;
    background:      rgba(10,10,18,0.92);
    border:          1px solid rgba(255,255,255,0.12);
    border-radius:   8px;
    padding:         10px 12px;
    backdrop-filter: blur(12px);
    display:         flex;
    flex-direction:  column;
    gap:             7px;
    z-index:         10;
    min-width:       200px;
    font-size:       11px;
    color:           rgba(255,255,255,0.7);
    font-family:     system-ui, sans-serif;
}

.vlp-prog-title {
    font-size:      10px;
    font-weight:    700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color:          rgba(255,255,255,0.3);
    margin-bottom:  2px;
}

.vlp-prog-row {
    display:     flex;
    align-items: center;
    gap:         8px;
    cursor:      default;
}

.vlp-prog-row span:first-child {
    min-width: 60px;
    opacity:   0.6;
}

.vlp-prog-select {
    background:    rgba(255,255,255,0.07);
    border:        1px solid rgba(255,255,255,0.1);
    border-radius: 5px;
    color:         inherit;
    font-size:     11px;
    padding:       2px 4px;
    font-family:   inherit;
    flex:          1;
}

.vlp-prog-slider {
    flex:   1;
    height: 3px;
}

.vlp-prog-val {
    min-width: 28px;
    text-align: right;
    opacity:    0.5;
    font-family: monospace;
}

.vlp-prog-hint {
    font-size: 9px;
    opacity:   0.3;
    margin-top: 2px;
}

/* ── SVG label overlay ────────────────────────────────────────── */
.vlp-labels { overflow: visible; }
</style>