<script>
  import GradientRefControl from "./GradientRefControl.svelte";
  import PaletteColourControl from "./PaletteColourControl.svelte";

let activeControl = $state('colour');

const controls = [
    { id: 'colour', label: 'Colour' },
    { id: 'gradient', label: 'Gradient' },
];
</script>
<!-- src/components/studio/controls/ColourOrGradient.svelte -->
<!-- 
    switches between colour control or gradient control
-->

{#each controls as c}
<button 
    class="al-btn {activeControl === c.id ? 'active' : ''}"
    onclick={() => activeControl = c.id}
>
    {c.label}
</button>
{/each}

{#if activeControl === 'colour'}
<PaletteColourControl />
{/if}
{#if activeControl === 'gradient'}
<GradientRefControl />
{/if}