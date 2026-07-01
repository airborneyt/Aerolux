<!-- src/components/velocity/HueShiftRow.svelte -->
<!--
    hue shift row under the gradient editor in velocity
    controls the hue shift value
-->
<script>
import { editor } from '../../stores/velocity.svelte.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { pushUndo } from '../../stores/velocityActions.svelte.js';

function reset() {
    if (editor.hueShift !== 0) {
        pushUndo()
        editor.hueShift = 0;
        showToast('Hue shift reset', 'info', 1500);
    } else {
        showToast('Nothing to reset', 'info', 1500);
    }    
}
</script>

<div class="al-hue-row" style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
    <span class="al-label" style="margin:0;min-width:60px">Hue shift</span>
    <input type="range" min="0" max="360" step="1"
        bind:value={editor.hueShift} style="flex:1" />
    <span class="al-val">{editor.hueShift}°</span>
    <button class="al-btn" onclick={reset}
        style="padding:4px 8px;font-size:11px">Reset</button>
</div>