<!-- src/components/studio/controls/GradientRefControl.svelte -->
<!--
    Lets the user pick a gradient from those registered by the Velocity editor.
    Shows a colour bar preview of the selected gradient.
-->
<script>
import { onMount } from 'svelte';
import { availableGradients } from '../../../stores/kinetic.svelte.js';
import { loadPresets } from '../../../lib/aerolux/presets.js';
import { editor } from '../../../stores/velocity.svelte.js';
import { toHex } from '../../../lib/aerolux/palette.js';

let {
    label    = 'Gradient',
    value    = null,
    hint     = '',
    onchange = () => {},
} = $props();

let localPresets = $state([]);

const gradientList = $derived.by(() => [
    { id: 'current', label: 'Current gradient (live)' },

    ...localPresets.map(preset => ({
        id: preset.id,
        label: preset.name ?? preset.id
    }))
]);

const selectedGradient = $derived.by(() => {
    if (!value || value === 'current') {
        return availableGradients.map.get('current');
    }

    const preset = localPresets.find(p => p.id === value);

    if (preset?.meta?.velocities) {
        return preset.meta.velocities.map((v, i) => ({
            step: i,
            velocity: v
        }));
    }

    return availableGradients.map.get(value);
});

onMount(async () => {
    localPresets = await loadPresets();
});

</script>

<div class="grad-ref-wrap">
    <p class="al-label" style="margin-bottom:6px">{label}</p>

    <!-- Colour bar preview -->
    {#if selectedGradient?.length}
        <div class="grad-ref-bar" style="margin-bottom:6px">
            {#each selectedGradient as { velocity }}
                {@const c = editor.palette[velocity] ?? editor.palette[0]}
                <div style="flex:1;background:{toHex(c.r, c.g, c.b)}"></div>
            {/each}
        </div>
    {/if}

    <select class="al-select" value={value ?? 'current'}
        onchange={e => onchange(e.target.value === 'current' ? null : e.target.value)}>
        {#each gradientList as g}
            <option value={g.id}>{g.label}</option>
        {/each}
    </select>

    {#if hint}
        <p class="al-hint-text" style="margin-top:4px">{hint}</p>
    {/if}
</div>

<style>
.grad-ref-wrap { display: flex; flex-direction: column; gap: 4px; }
.grad-ref-bar {
    height:        20px;
    display:       flex;
    border-radius: var(--radius-xs);
    overflow:      hidden;
    border:        1px solid var(--color-border);
}
</style>