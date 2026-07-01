<!-- src/components/studio/controls/ToggleControl.svelte -->
<script>
let { label = '', value = false, hint = '', onchange = () => {} } = $props();
</script>

<div class="toggle-wrap">
    <div class="al-setting-label">{label}</div>
    {#if hint}<div class="al-hint-text" style="margin-bottom:6px">{hint}</div>{/if}
    <label class="al-toggle-wrap">
        <input type="checkbox"
            checked={value}
            onchange={e => onchange(e.target.checked)}
        />
        <span class="al-dim">{value ? 'On' : 'Off'}</span>
    </label>
</div>

<style>
.toggle-wrap { display: flex; flex-direction: column; gap: 4px; }
</style>