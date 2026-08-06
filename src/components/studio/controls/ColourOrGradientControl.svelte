<!-- src/components/studio/controls/ColourOrGradientControl.svelte -->
<!--
    colour controls for generator and simulation nodes

    value shape:
        { mode: 'palette', index: number }
        { mode: 'gradient', gradientId: 'current' | <presetId>, cycleMode: 'synced' | 'perTrigger', cycleTicks: number }

    modes:
        'synced'        = the whole device cycles through the gradient together based on absolute time (a pad that lights up mid-cycle joins other pads)
        'perTrigger'    = each pad's own cycle restarts whenever that pad is fired. this has two extra modes on its own:
                            - 'linked' = a pixel renders its gradient only for as long as it is lit. the gradient can get cut off mid-cycle in this
                            - 'full' = a pixel renders its gradient entirely, regardless of how long it is supposed to stay on
-->
<script>
import { onMount } from 'svelte';
import { editor } from '../../../stores/velocity.svelte.js';
import { toHex } from '../../../lib/aerolux/palette.js';
import { availableGradients, registerGradient } from '../../../stores/kinetic.svelte.js';
import { loadPresets } from '../../../lib/aerolux/presets.js';

let {
    label    = 'Colour',
    value    = { mode: 'palette', index: 1 },
    hint     = '',
    onchange = () => {},
} = $props();

const mode = $derived(value?.mode ?? 'palette');

function setMode(m) {
    if (m === mode) return;
    if (m === 'palette') {
        onchange({ mode: 'palette', index: value?.index ?? 1 });
    } else {
        onchange({
            mode: 'gradient',
            gradientId: value?.gradientId ?? 'current',
            cycleMode: value?.cycleMode ?? 'synced',
            cycleTicks: value?.cycleTicks ?? 96,
            holdMode: value?.holdMode ?? 'linked',
        });
    }
}

// palette mode: 16x8 grid ––––––––––––––––––––––––––––––––––––––––––
function indexAt(col, rfb) {
    return Math.floor(col / 4) * 32 + rfb * 4 + (col % 4);
}
const paletteGrid = $derived.by(() => {
    const grid = [];
    for (let cssRow = 0; cssRow < 8; cssRow++) {
        const row = [];
        for (let col = 0; col < 16; col++) {
            const idx = indexAt(col, 7 - cssRow);
            const c   = editor.palette[idx];
            row.push({ idx, hex: c ? toHex(c.r, c.g, c.b) : '#000' });
        }
        grid.push(row);
    }
    return grid;
});
const selectedHex = $derived.by(() => {
    if (mode !== 'palette') return '#000';
    const c = editor.palette[value?.index ?? 1];
    return c ? toHex(c.r, c.g, c.b) : '#000';
});
function pickPaletteIndex(idx) {
    if (idx === 0) return;
    onchange({ mode: 'palette', index: idx });
}

// gradient mode ––––––––––––––––––––––––––––––––––––––––––––––––––––
let localPresets = $state([]);

function registerPresetGradient(preset) {
    if (!preset?.meta?.velocities) return;
    registerGradient(preset.id, preset.meta.velocities.map((v, i) => ({ step: i, velocity: v })));
}

onMount(async () => {
    localPresets = await loadPresets();
    for (const preset of localPresets) registerPresetGradient(preset);

    if (value?.mode === 'gradient' && value.gradientId && value.gradientId !== 'current') {
        const match = localPresets.find(p => p.id === value.gradientId);
        if (match) registerPresetGradient(match);
    }
});

const gradientList = $derived.by(() => [
    { id: 'current', label: 'Current gradient (live)' },
    ...localPresets.map(preset => ({ id: preset.id, label: preset.name ?? preset.id })),
]);

const selectedGradient = $derived.by(() => {
    if (mode !== 'gradient') return null;
    const gradientId = value?.gradientId ?? 'current';
    if (gradientId === 'current') return availableGradients.map.get('current');
    const preset = localPresets.find(p => p.id === gradientId);
    if (preset?.meta?.velocities) {
        return preset.meta.velocities.map((v, i) => ({ step: i, velocity: v }));
    }
    return availableGradients.map.get(gradientId);
});

function patchGradientValue(patch) {
    if (patch.gradientId && patch.gradientId !== 'current') {
        const preset = localPresets.find(p => p.id === patch.gradientId);
        if (preset) registerPresetGradient(preset);
    }
    onchange({
        mode: 'gradient',
        gradientId: value?.gradientId ?? 'current',
        cycleMode: value?.cycleMode ?? 'synced',
        cycleTicks: value?.cycleTicks ?? 96,
        holdMode: value?.holdMode ?? 'linked',
        ...patch,
    });
}

const cycleMode = $derived(value?.cycleMode ?? 'synced');
const holdMode  = $derived(value?.holdMode ?? 'linked');
</script>

<div class="cog-wrap">
    <div class="cog-header">
        <p class="al-label" style="margin:0">{label}</p>
        <div class="cog-mode-toggle">
            <button class="al-btn al-btn-sm {mode === 'palette' ? 'al-btn-blue' : ''}" onclick={() => setMode('palette')}>
                Colour
            </button>
            <button class="al-btn al-btn-sm {mode === 'gradient' ? 'al-btn-blue' : ''}" onclick={() => setMode('gradient')}>
                Gradient
            </button>
        </div>
    </div>

    {#if hint}<p class="al-hint-text" style="margin-bottom:6px">{hint}</p>{/if}

    {#if mode === 'palette'}
        <div class="cog-preview">
            <div class="cog-swatch" style="background:{selectedHex}"></div>
            <span class="cog-idx">#{value?.index ?? 8}</span>
        </div>
        <div class="cog-palette-grid">
            {#each paletteGrid as row}
                {#each row as cell}
                    <button
                        class="cog-pad {cell.idx === (value?.index ?? 8) ? 'selected' : ''} {cell.idx === 0 ? 'disabled' : ''}"
                        style="background:{cell.hex}"
                        onclick={() => pickPaletteIndex(cell.idx)}
                        title="Index {cell.idx} — {cell.hex}"
                        disabled={cell.idx === 0}
                    ></button>
                {/each}
            {/each}
        </div>
    {:else}
        {#if selectedGradient?.length}
            <div class="cog-grad-bar">
                {#each selectedGradient as { velocity }}
                    {@const c = editor.palette[velocity] ?? editor.palette[0]}
                    <div style="flex:1;background:{toHex(c.r, c.g, c.b)}"></div>
                {/each}
            </div>
        {:else}
            <p class="al-hint-text">No gradient data yet. Pick a source below.</p>
        {/if}

        <select class="al-select" value={value?.gradientId ?? 'current'} onchange={e => patchGradientValue({ gradientId: e.target.value })}>
            {#each gradientList as g}
                <option value={g.id}>{g.label}</option>
            {/each}
        </select>

        <div class="cog-cycle-row">
            <span class="al-dim" style="font-size:10px">Cycle</span>
            <div class="cog-cycle-toggle">
                <button
                    class="al-btn al-btn-sm {cycleMode === 'synced' ? 'al-btn-blue' : ''}"
                    onclick={() => patchGradientValue({ cycleMode: 'synced' })}
                    title="Every lit pad shows the same colour at the same moment, regardless of when each pad turned on."
                >Synced</button>
                <button
                    class="al-btn al-btn-sm {cycleMode === 'perTrigger' ? 'al-btn-blue' : ''}"
                    onclick={() => patchGradientValue({ cycleMode: 'perTrigger' })}
                    title="Each pad plays the gradient once, starting the instant that pad turns on."
                >Per-pad</button>
            </div>
        </div>
        <p class="al-hint-text" style="margin-top:-2px">
            {#if cycleMode === 'synced'}
                The whole device cycles through the gradient together. A pad that fires mid-cycle joins wherever the cycle currently is.
            {:else}
                Each pad replays the gradient once from the moment it fires, independent of every other pad.
            {/if}
        </p>

        <div class="cog-pos-row">
            <span class="al-dim" style="font-size:10px;width:72px">Cycle length</span>
            <input type="number" class="al-num-input" style="width:64px"
                value={value?.cycleTicks ?? 96} min="1" step="1"
                onchange={e => patchGradientValue({ cycleTicks: Math.max(1, Math.round(parseFloat(e.target.value))) })} />
            <span class="al-dim" style="font-size:10px">ticks</span>
        </div>

        {#if cycleMode === 'perTrigger'}
            <div class="cog-hold-row">
                <span class="al-dim" style="font-size:10px">When released</span>
                <div class="cog-cycle-toggle">
                    <button
                        class="al-btn al-btn-sm {holdMode === 'linked' ? 'al-btn-blue' : ''}"
                        onclick={() => patchGradientValue({ holdMode: 'linked' })}
                        title="Colour stops the instant the pad goes dark, even mid-gradient."
                    >Stop with pad</button>
                    <button
                        class="al-btn al-btn-sm {holdMode === 'full' ? 'al-btn-blue' : ''}"
                        onclick={() => patchGradientValue({ holdMode: 'full' })}
                        title="Once triggered, the gradient always plays to completion, even after the pad releases."
                    >Play full gradient</button>
                </div>
            </div>
            <p class="al-hint-text" style="margin-top:-2px">
                {#if holdMode === 'full'}
                    A brief tap still plays the whole gradient through to the end before going dark.
                {:else}
                    A brief tap only shows whatever part of the gradient overlapped with the pad being lit.
                {/if}
            </p>
        {/if}
    {/if}
</div>

<style>
.cog-wrap    { display: flex; flex-direction: column; gap: 6px; }
.cog-header  { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.cog-mode-toggle { display: flex; gap: 4px; }

.cog-preview { display: flex; align-items: center; gap: 6px; }
.cog-swatch  { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.15); flex-shrink: 0; }
.cog-idx     { font-family: monospace; font-size: 10px; color: var(--color-text-dim); }

.cog-palette-grid { display: grid; grid-template-columns: repeat(16, 1fr); gap: 1.5px; }
.cog-pad {
    aspect-ratio: 1; border: none; border-radius: 1.5px;
    cursor: pointer; padding: 0; transition: transform 0.08s;
}
.cog-pad:hover:not(.disabled) {
    transform: scale(1.35); z-index: 2; position: relative;
    box-shadow: 0 0 0 1.5px rgba(255,255,255,0.6);
}
.cog-pad.selected { box-shadow: 0 0 0 2px white; z-index: 3; position: relative; transform: scale(1.2); }
.cog-pad.disabled { opacity: 0.15; cursor: not-allowed; }

.cog-grad-bar {
    height: 18px; display: flex; border-radius: var(--radius-xs);
    overflow: hidden; border: 1px solid var(--color-border);
}
.cog-cycle-row, .cog-hold-row { display: flex; align-items: center; gap: 8px; }
.cog-cycle-toggle { display: flex; gap: 4px; }
.cog-pos-row       { display: flex; align-items: center; gap: 8px; }
</style>