<!-- src/components/velocity/PalettePanel.svelte -->
<!--
    renders the massive palette tab
    handles all the sort and filter methods too
-->
<script>
import { onMount } from 'svelte';
import { editor, gradResult } from '../../stores/velocity.svelte.js';
import { pushUndo, undoState } from '../../stores/velocityActions.svelte.js';
import { initPalettePanel } from '../../lib/aerolux/palette-panel.js';
import { toHex } from '../../lib/aerolux/palette.js';
import { showToast } from '../../lib/aerolux/toast.js';

let palettePanel = $state(null);

const canUndo = $derived(undoState.canUndo);
const canRedo = $derived(undoState.canRedo);

onMount(() => {
    palettePanel = initPalettePanel({
        getPalette:      () => editor.palette,
        getStops:        () => editor.stops,
        getSelStop:      () => editor.selStop,
        setSelStop:      (id) => { editor.selStop = id; },
        getStepCount:    () => editor.steps,
        getTint:         () => editor.tint,
        getGradResult:   () => gradResult(),
        isPickingTint:   () => editor.pickingTint,
        setPickingTint:  (v) => { editor.pickingTint = v; },
        getSortMode:     () => editor.sortMode,
        getSwatchOrder:  () => editor.swatchOrder,
        onSwatchSelected: (ci) => {
            pushUndo;
            const sel = editor.stops.find(s => s.id === editor.selStop);
            if (!sel) return;
            sel.ci = ci;
            const sorted = [...editor.stops].sort((a, b) => a.pos - b.pos);
            const curIdx = sorted.findIndex(s => s.id === editor.selStop);
            const next   = sorted[(curIdx + 1) % sorted.length];
            editor.selStop = next.id;
        },
        onTintColourPicked: (ci) => {
            pushUndo;
            editor.tint.ci     = ci;
            editor.pickingTint = false;
            showToast(`Tint set to palette #${ci}`, 'info', 1500);
        },
        onSwatchPickChanged: (newOrder) => {
            editor.swatchOrder = newOrder;
            palettePanel?.renderSwatchPickBar();
        },
    });
    palettePanel.renderDOM();
});

// re-render swatch highlights when relevant state changes
$effect(() => {
    const _dep = [
        editor.palette,
        editor.stops.map(s => s.ci).join(','),
        editor.selStop,
        editor.tint.ci,
        gradResult().map(g => g.velocity).join(','),
        editor.pickingTint,
        editor.swatchOrder.join(','),
    ];
    palettePanel?.render();
});

// full rebuild only when sort mode changes
$effect(() => {
    const _dep = editor.sortMode;
    palettePanel?.renderDOM();
});

const sortModes = [
    { value: 'original', label: 'Original' },
    { value: 'hue',      label: 'Hue' },
    { value: 'sat',      label: 'Sat' },
    { value: 'lum',      label: 'Lum' },
    { value: 'swatch',   label: 'Pick' },
];

// expose public API via bind:api
let { api = $bindable(null) } = $props();
$effect(() => {
    if (palettePanel) api = palettePanel;
});
</script>

<div class="al-card">
    <div class="al-card-header">
        <h3 class="al-card-title">Palette</h3>
        <div class="al-sort-tabs" id="sort-tabs">
            {#each sortModes as mode}
                <button
                    class="al-stab {editor.sortMode === mode.value ? 'active' : ''}"
                    onclick={() => editor.sortMode = mode.value}
                >{mode.label}</button>
            {/each}
        </div>
    </div>

    <!-- filter indicator, managed by palette-panel.js -->
    <div id="swpick-filter-indicator" style="display:none;align-items:center;gap:8px;
        padding:5px 8px;border-radius:7px;margin-bottom:6px;
        background:rgba(43,127,255,0.1);border:1px solid rgba(43,127,255,0.25)">
        <span class="al-dim" style="font-size:11px" id="swpick-filter-count"></span>
        <button class="al-btn al-btn-ghost" id="swpick-filter-clear"
            style="font-size:11px;padding:1px 7px;opacity:0.6;margin-left:auto">
            Clear filter
        </button>
    </div>

    <!-- swatch pick panel -->
    <div id="swpick-bar" style="display:{editor.sortMode === 'swatch' ? 'block' : 'none'}">

        <!-- quick-select: hue -->
        <p class="al-label" style="margin-bottom:5px">Hue</p>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
            {#each ['red','orange','yellow','green','blue','purple','pink'] as hue}
                <button class="al-btn al-btn-sm swpick-quick-btn"
                    data-type="hue" data-value={hue}
                >{hue.charAt(0).toUpperCase()+hue.slice(1)}</button>
            {/each}
        </div>

        <!-- quick-select: brightness -->
        <p class="al-label" style="margin-bottom:5px">Brightness</p>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
            {#each ['bright','muted','dim','dark'] as b}
                <button class="al-btn al-btn-sm swpick-quick-btn"
                    data-type="brightness" data-value={b}
                >{b.charAt(0).toUpperCase()+b.slice(1)}</button>
            {/each}
        </div>

        <!-- quick-select: region -->
        <!-- needs to be reworked to calculate actual regions to support custom palettes -->
        <p class="al-label" style="margin-bottom:5px">Region</p>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
            <button class="al-btn al-btn-sm swpick-quick-btn" data-type="region" data-value="deep">Deep (8–67)</button>
            <button class="al-btn al-btn-sm swpick-quick-btn" data-type="region" data-value="pastel">Pastel (68–127)</button>
            <button class="al-btn al-btn-sm swpick-quick-btn" data-type="region" data-value="grey">Grey (1–7)</button>
        </div>

        <!-- selected colours strip -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;margin-bottom:4px">
            <div class="al-swpick-strip" id="swpick-order"></div>
            <span class="al-dim" id="swpick-count" style="font-size:11px;white-space:nowrap">
                None selected. Click swatches or use quick-select
            </span>
        </div>
        <button class="al-link" id="swpick-clear">Clear all</button>
    </div>

    <!-- palette grid, rendered by palette-panel.js -->
    <div id="palette-grid"></div>

    <div class="al-palette-info">
        <span class="al-dim" id="palette-count"></span>
        <span class="al-dim" id="hover-info" style="margin-left:auto"></span>
    </div>
</div>