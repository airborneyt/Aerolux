<!-- src/components/velocity/TintPanel.svelte -->
<!-- handles tint swatch picking, tint slider and tint fade -->
<script>
import { editor } from '../../stores/velocity.svelte.js';
import { toHex } from '../../lib/aerolux/palette.js';
import { showToast } from '../../lib/aerolux/toast.js';

const tintColour = $derived(
    editor.tint.ci !== null
        ? toHex(
            (editor.palette[editor.tint.ci] ?? editor.palette[0]).r,
            (editor.palette[editor.tint.ci] ?? editor.palette[0]).g,
            (editor.palette[editor.tint.ci] ?? editor.palette[0]).b
          )
        : 'rgba(255,255,255,0.05)'
);

const tintLabel = $derived(
    editor.tint.ci !== null ? `#${editor.tint.ci} ${tintColour}` : 'None'
);

const fades = [
    { value: 'none',   label: 'None' },
    { value: 'in',     label: 'In' },
    { value: 'out',    label: 'Out' },
    { value: 'centre', label: 'Centre' },
];

function clearTint() {
    if (editor.tint.ci !== null) {
        editor.tint.ci   = null;
        editor.tint.fade = null;
        editor.pickingTint = false;
        showToast('Tint cleared', 'info', 1500)
    } else {
        showToast('Nothing to clear', 'info' , 1500)
    }
    
}
</script>

<div class="al-card al-settings-card">
    <p class="al-label">Tint</p>
    <div class="al-range-row">
        <input type="range" min="0" max="100" step="1" bind:value={editor.tint.str} />
        <span class="al-val">{editor.tint.str}%</span>
    </div>
    <div class="al-tint-row">
        <div class="al-colour-dot" style="background:{tintColour}"></div>
        <button
            class="al-btn {editor.pickingTint ? 'al-btn-amber' : ''}"
            onclick={() => editor.pickingTint = !editor.pickingTint}
        >{editor.pickingTint ? 'Cancel' : 'Pick'}</button>
        <button class="al-btn" onclick={clearTint}>Clear</button>
        <span class="al-dim">{tintLabel}</span>
    </div>
    {#if editor.pickingTint}
        <p class="al-hint-text al-amber">↑ Click any palette swatch</p>
    {/if}
    <p class="al-label" style="margin-top:10px">Fade</p>
    <div class="al-pill-group">
        {#each fades as f}
            <button
                class="al-pill {(editor.tint.fade ?? 'none') === f.value ? 'active' : ''}"
                onclick={() => editor.tint.fade = f.value === 'none' ? null : f.value}
            >{f.label}</button>
        {/each}
    </div>
</div>