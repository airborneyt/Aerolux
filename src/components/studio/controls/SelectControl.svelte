<!-- src/components/studio/controls/SelectControl.svelte -->
<script>
let { label = '', value = '', options = [], hint = '', onchange = () => {} } = $props();
</script>

<div class="sel-wrap">
    <p class="al-label">{label}</p>
    {#if hint}<p class="al-hint-text" style="margin-bottom:6px">{hint}</p>{/if}
    <select class="al-select" value={value} onchange={e => onchange(e.target.value)}>
        {#each options as opt}
            <option value={opt.value}>{opt.label}</option>
        {/each}
    </select>
</div>

<style>
.sel-wrap { display: flex; flex-direction: column; gap: 4px; }
</style>