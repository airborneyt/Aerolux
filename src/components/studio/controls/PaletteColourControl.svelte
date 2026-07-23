<!-- src/components/studio/controls/PaletteColourControl.svelte -->
<script>
import { editor } from '../../../stores/velocity.svelte.js';
import { toHex } from '../../../lib/aerolux/palette.js';

let { label = 'Colour', value = 8, onchange = () => {} } = $props();

// build 16x8 grid matching the Velocity editor's indexAt layout
// indexAt(col, rowFromBottom) = Math.floor(col/4)*32 + rowFromBottom*4 + (col%4)
function indexAt(col, rfb) {
    return Math.floor(col / 4) * 32 + rfb * 4 + (col % 4);
}
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

const selectedHex = $derived.by(() => {
    const c = editor.palette[value];
    return c ? toHex(c.r, c.g, c.b) : '#000';
});
</script>

<div class="pcc-wrap">
    <div class="pcc-header">
        <p class="al-label" style="margin:0">{label}</p>
        <div class="pcc-preview">
            <div class="pcc-swatch" style="background:{selectedHex}"></div>
            <span class="pcc-idx">#{value}</span>
        </div>
    </div>
    <div class="pcc-grid">
        {#each grid as row}
            {#each row as cell}
                <button
                    class="pcc-pad {cell.idx === value ? 'selected' : ''} {cell.idx === 0 ? 'disabled' : ''}"
                    style="background:{cell.hex}"
                    onclick={() => { if (cell.idx !== 0) onchange(cell.idx); }}
                    title="Index {cell.idx} — {cell.hex}"
                    disabled={cell.idx === 0}
                ></button>
            {/each}
        {/each}
    </div>
</div>

<style>
.pcc-wrap   { display:flex; flex-direction:column; gap:6px; }
.pcc-header { display:flex; align-items:center; justify-content:space-between; }
.pcc-preview{ display:flex; align-items:center; gap:5px; }
.pcc-swatch { width:14px; height:14px; border-radius:3px; border:1px solid rgba(255,255,255,0.15); flex-shrink:0; }
.pcc-idx    { font-family:monospace; font-size:10px; color:var(--color-text-dim); }
.pcc-grid   { display:grid; grid-template-columns:repeat(16,1fr); gap:1.5px; }
.pcc-pad {
    aspect-ratio:1; border:none; border-radius:1.5px;
    cursor:pointer; padding:0; transition:transform 0.08s;
}
.pcc-pad:hover:not(.disabled) {
    transform:scale(1.35); z-index:2; position:relative;
    box-shadow:0 0 0 1.5px rgba(255,255,255,0.6);
}
.pcc-pad.selected { box-shadow:0 0 0 2px white; z-index:3; position:relative; transform:scale(1.2); }
.pcc-pad.disabled { opacity:0.15; cursor:not-allowed; }
</style>