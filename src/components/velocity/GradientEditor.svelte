<!-- src/components/velocity/GradientEditor.svelte -->
<!--
    gradient panel
    renders the gradient preview within velocity
    also handles quick action functions and calculations
-->
<script>
import { onMount, onDestroy } from 'svelte';
import { editor, gradResult, repeatSteps, sortStopsInPlace } from '../../stores/velocity.svelte.js';
import { pushUndo, undoState } from '../../stores/velocityActions.svelte.js';
import { initRepeatPanel } from '../../lib/aerolux/repeat-panel.js';
import { findNearest, lerpRgb } from '../../lib/aerolux/gradient.js';
import { toHex, toHSL, hslToRgb63 } from '../../lib/aerolux/palette.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { rgbToLab } from '../../lib/aerolux/palette.js';
import { hapticSnap } from '../../lib/aerolux/haptics.js';

// canUndo/canRedo come from the store directly
const canUndo = $derived(undoState.canUndo);
const canRedo = $derived(undoState.canRedo);

const gr      = $derived(gradResult());
const repeats = $derived(repeatSteps());

let { onUndo, onRedo } = $props();

let stopsTrack;
let dragging = null;
let lastSnapPoint = null;
let disposeRepeatPanel = () => {};

// repeat toast ──────────────────────────────────────────────────────
// fire a toast when anti-repeat is toggled
let prevAntiRepeat = editor.antiRepeat;
$effect(() => {
    if (editor.antiRepeat !== prevAntiRepeat) {
        showToast(
            editor.antiRepeat ? 'Anti-repetition on' : 'Anti-repetition off',
            'info', 1500
        );
        prevAntiRepeat = editor.antiRepeat;
    }
});

// auto-fix wiring ───────────────────────────────────────────────────
onMount(() => {
    disposeRepeatPanel = initRepeatPanel({
        getPalette:     () => editor.palette,
        getLabCache:    () => {
            // ensure cache is populated
            if (!editor.paletteLabCache) {
                editor.paletteLabCache = editor.palette.map(c =>
                    rgbToLab(c.r, c.g, c.b)
                );
            }
            return editor.paletteLabCache;
        },
        getEditorState: () => ({
            stops:      JSON.parse(JSON.stringify(editor.stops)),
            algorithm:  editor.algorithm,
            easing:     editor.easing,
            hslDir:     editor.hslDir,
            steps:      editor.steps,
            hueShift:   editor.hueShift,
            tint:       { ...editor.tint },
            envelope:   { ...editor.envelope },
            antiRepeat: editor.antiRepeat,
        }),
        setAlgorithm: (a) => { editor.algorithm = a; },
        setSteps:     (n) => { editor.steps = n; },
        getGradResult:     () => gradResult(),
        pushUndo,
        updateUndoButtons: () => {},
        syncUiToState:     () => {},
        renderAll:         () => {},
        showToast,
    });
    const onMousemove = (e) => {
    if (!dragging) return;
    const rawPos = Math.max(0, Math.min(1, (e.clientX - dragging.rect.left) / dragging.rect.width));
    let pos = rawPos;
    if (e.shiftKey) {
        const snapStep = 0.05;
        pos = Math.round(rawPos / snapStep) * snapStep;
        const snapPoint = Math.round(pos * 100);
        if (snapPoint !== lastSnapPoint) {
            hapticSnap();
            lastSnapPoint = snapPoint;
        }
    } else {
        lastSnapPoint = null;
    }
    const stop = editor.stops.find(s => s.id === dragging.id);
    if (stop) {
        stop.pos = pos;
    }
    sortStopsInPlace();
};
    const onMouseup = () => { dragging = null; };
    document.addEventListener('mousemove', onMousemove);
    document.addEventListener('mouseup',   onMouseup);
    return () => {
        disposeRepeatPanel();
        document.removeEventListener('mousemove', onMousemove);
        document.removeEventListener('mouseup',   onMouseup);
    };    
});

// gradient bar CSS ──────────────────────────────────────────────────
const gradBarCss = $derived.by(() => {
    if (!gr.length) return 'transparent';
    const parts = gr.map(g => {
        const c = editor.palette[g.velocity] ?? editor.palette[0];
        return toHex(c.r, c.g, c.b);
    });
    return `linear-gradient(to right, ${
        parts.map((h, i) =>
            `${h} ${(i / parts.length * 100).toFixed(1)}%,` +
            `${h} ${((i + 1) / parts.length * 100).toFixed(1)}%`
        ).join(',')
    })`;
});

const selectedStop = $derived.by(() => {
    const stop =
        editor.stops.find(s => s.id === editor.selStop);

    return stop ? { ...stop } : null;
});

// stop drag ─────────────────────────────────────────────────────────
function onTrackMousedown(e) {
    const mk = e.target.closest('.al-stop-mk');
    if (mk) {
        pushUndo();
        editor.selStop = parseInt(mk.dataset.id);
        dragging = { id: editor.selStop, rect: stopsTrack.getBoundingClientRect() };
        e.preventDefault();
        return;
    }
    const rect = stopsTrack.getBoundingClientRect();
    let pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (e.shiftKey) {
        pos = Math.round(pos / 0.05) * 0.05;
    }
    const sorted = [...editor.stops].sort((a, b) => a.pos - b.pos);
    let s0 = sorted[0], s1 = sorted[sorted.length - 1];
    for (let j = 0; j < sorted.length - 1; j++) {
        if (pos >= sorted[j].pos && pos <= sorted[j + 1].pos) {
            s0 = sorted[j]; s1 = sorted[j + 1]; break;
        }
    }
    const span = s1.pos - s0.pos;
    const lt   = span < 0.0001 ? 0 : (pos - s0.pos) / span;
    const ca   = editor.palette[s0.ci] ?? editor.palette[0];
    const cb   = editor.palette[s1.ci] ?? editor.palette[0];
    const ci   = findNearest(
        lerpRgb([ca.r, ca.g, ca.b], [cb.r, cb.g, cb.b], Math.max(0, Math.min(1, lt))),
        editor.palette, 'rgb'
    );
    pushUndo();
    const ns = { id: editor.nextId++, pos, ci };
    editor.stops.push(ns);
    editor.selStop = ns.id;
    dragging = { id: ns.id, rect };
}

function setPosFromInput(e) {
    const s = editor.stops.find(s => s.id === editor.selStop);
    if (!s) return;
    pushUndo();
    s.pos = Math.max(0, Math.min(1, parseInt(e.target.value) / 100));
    sortStopsInPlace();
}

function deleteStop() {
    if (editor.stops.length <= 2) { showToast('Need at least 2 stops', 'warning'); return; }
    pushUndo();
    editor.stops   = editor.stops.filter(s => s.id !== editor.selStop);
    editor.selStop = editor.stops[0].id;
    showToast('Stop deleted', 'info', 1500);
}

function reverse() {
    pushUndo();
    editor.stops = editor.stops.map(s => ({ ...s, pos: 1 - s.pos }));
    sortStopsInPlace();
    showToast('Gradient reversed', 'info', 1500);
}

function randomise() {
    pushUndo();
    const count = 2 + Math.floor(Math.random() * 7);
    editor.stops = Array.from({ length: count }, (_, i) => ({
        id:  editor.nextId++,
        pos: i === 0 ? 0 : i === count - 1 ? 1 : Math.random(),
        ci:  1 + Math.floor(Math.random() * (editor.palette.length - 1)),
    }));
    sortStopsInPlace();
    editor.selStop = editor.stops[0].id;
    showToast('Randomised!', 'info', 1500);
}

function invert() {
    pushUndo();
    editor.stops = editor.stops.map(stop => {
        const c = editor.palette[stop.ci] ?? editor.palette[0];
        const { h, s, l } = toHSL(c.r, c.g, c.b);
        const compRgb = hslToRgb63((h + 0.5) % 1.0, s, l);
        return { ...stop, ci: findNearest(compRgb, editor.palette, 'rgb') };
    });
    showToast('Colours inverted', 'info', 1500);
}

function isTyping(e) {
    const tag = e.target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
}
export async function onKeyDown(e){
    if (isTyping(e)) return;

    if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        randomise();
    }  

    if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        invert();
    }
}

onMount(async () => window.addEventListener('keydown', onKeyDown));
onDestroy(() => window.removeEventListener('keydown', onKeyDown));

</script>

<div class="al-card-header">
    <h3 class="al-card-title">Gradient editor</h3>
    <div style="display:flex;gap:6px;align-items:center">
        <label class:al-btn-blue={editor.antiRepeat === true} class="al-btn" title="Minimise repeated colours">
            <input type="checkbox" bind:checked={editor.antiRepeat} style="display:none" />♤
        </label>
        <button class="al-icon-btn" disabled={!canUndo} onclick={onUndo}   title="Undo (Ctrl+Z)">↩</button>
        <button class="al-icon-btn" disabled={!canRedo} onclick={onRedo}   title="Redo (Ctrl+Y)">↪</button>
        <button class="al-icon-btn" onclick={reverse}   title="Reverse gradient">⇄</button>
        <button class="al-icon-btn" onclick={invert}    title="Invert colours">⊕</button>
        <button class="al-icon-btn" onclick={randomise} title="Randomise stops">⚄</button>
    </div>
</div>

<p class="al-hint-text">
    Click bar to add stop · drag marker to move · select stop then click swatch to recolour
</p>

<!-- gradient bar -->
<div id="grad-bar">
    <div id="grad-bar-inner" style="background:{gradBarCss}"></div>
    <div id="grad-bar-repeats">
        {#if editor.antiRepeat}
            {#each repeats as i}
                <div class="al-repeat-tick"
                     style="left:{(i / gr.length * 100)}%"
                     title="Steps {i}→{i+1} repeat">
                </div>
            {/each}
        {/if}
    </div>
</div>

<!-- stop markers track -->
<div id="stops-track" bind:this={stopsTrack} onmousedown={onTrackMousedown}>
    {#each editor.stops as stop (stop.id)}
        {@const c = editor.palette[stop.ci] ?? editor.palette[0]}
        <div
            class="al-stop-mk {stop.id === editor.selStop ? 'selected' : ''}"
            data-id={stop.id}
            style="left:{stop.pos * 100}%; --tc:{toHex(c.r, c.g, c.b)}"
            title="Stop: palette #{stop.ci} @ {Math.round(stop.pos * 100)}%"
        >
            <div class="al-tri"></div>
            <div class="al-body"></div>
        </div>
    {/each}
</div>

<!-- selected stop info -->
{#if selectedStop}
    {@const c = editor.palette[selectedStop.ci] ?? editor.palette[0]}
    <div class="al-stop-info">
        <div class="al-stop-dot" style="background:{toHex(c.r, c.g, c.b)}"></div>
        <span class="al-dim">Stop</span>
        <input
            class="al-num-input"
            type="number" min="0" max="100" step="1"
            value={Math.round(selectedStop.pos * 100)}
            onchange={setPosFromInput}
            title="Position 0–100%"
        />
        <span class="al-dim">%</span>
        <button class="al-btn al-btn-danger" onclick={deleteStop}>Delete</button>
        <span class="al-dim" style="margin-left:auto;font-size:11px">
            Palette #{selectedStop.ci}
        </span>
    </div>
{/if}

<!-- repeat warning -->
<div class="al-warning"
     style="display:{editor.antiRepeat && repeats.length ? 'flex' : 'none'}">
    <span>⚠</span>
    <span>
        Consecutive repeated colours at step{repeats.length > 1 ? 's' : ''}
        {repeats.map(i => `${i}→${i+1}`).join(', ')}.
        Try fewer steps, more stops, or a different algorithm.
    </span>
    <button class="al-btn al-btn-sm al-btn-warning"
        id="repeat-autofix-btn"
        style="margin-left:auto;white-space:nowrap"
    >Auto-fix</button>
</div>
