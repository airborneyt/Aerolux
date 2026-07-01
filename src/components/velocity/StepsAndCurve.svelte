<!-- src/components/velocity/StepsAndCurve.svelte -->
<!-- handles step value and also brightness envelopes -->
<script>
import { editor } from '../../stores/velocity.svelte.js';

const easings = [
    { value: 'linear',   label: 'Linear' },
    { value: 'easeIn',   label: 'Ease in' },
    { value: 'easeOut',  label: 'Ease out' },
    { value: 'sCurve',   label: 'S-curve' },
    { value: 'cubicIn',  label: 'Cubic in' },
    { value: 'cubicOut', label: 'Cubic out' },
    { value: 'sineIn',   label: 'Sine in' },
    { value: 'sineOut',  label: 'Sine out' },
    { value: 'sineBoth', label: 'Sine both' },
    { value: 'expoIn',   label: 'Expo in' },
    { value: 'expoOut',  label: 'Expo out' },
    { value: 'bounce',   label: 'Bounce' },
    { value: 'elastic',  label: 'Elastic' },
];

const envShapes = [
    { value: 'none',      label: 'None' },
    { value: 'fade_in',   label: 'Fade in' },
    { value: 'fade_out',  label: 'Fade out' },
    { value: 'fade_both', label: 'Both ends' },
    { value: 'bell',      label: 'Bell' },
    { value: 'valley',    label: 'Valley' },
];

const showAttack  = $derived(['fade_in', 'fade_both'].includes(editor.envelope.shape));
const showRelease = $derived(['fade_out', 'fade_both'].includes(editor.envelope.shape));
const showSliders = $derived(editor.envelope.shape !== 'none');
</script>

<div class="al-card al-settings-card">
    <p class="al-label">Steps <span class="al-dim">(max 16)</span></p>
    <div class="al-range-row">
        <input type="range" min="2" max="16" step="1" bind:value={editor.steps} />
        <span class="al-val">{editor.steps}</span>
    </div>

    <p class="al-label" style="margin-top:10px">Curve</p>
    <div class="al-pill-group">
        {#each easings as e}
            <button
                class="al-pill {editor.easing === e.value ? 'active' : ''}"
                onclick={() => editor.easing = e.value}
            >{e.label}</button>
        {/each}
    </div>

    <p class="al-label">Brightness envelope</p>
    <div class="al-pill-group" style="margin-bottom:10px">
        {#each envShapes as s}
            <button
                class="al-pill {editor.envelope.shape === s.value ? 'active' : ''}"
                onclick={() => editor.envelope.shape = s.value}
            >{s.label}</button>
        {/each}
    </div>

    {#if showSliders}
        {#if showAttack}
            <div class="al-range-row" style="margin-bottom:6px">
                <span class="al-label" style="margin:0;min-width:52px">Attack</span>
                <input type="range" min="0" max="100" step="1"
                    value={Math.round(editor.envelope.attack * 100)}
                    oninput={e => editor.envelope.attack = parseInt(e.target.value) / 100} />
                <span class="al-val">{Math.round(editor.envelope.attack * 100)}%</span>
            </div>
        {/if}
        {#if showRelease}
            <div class="al-range-row" style="margin-bottom:6px">
                <span class="al-label" style="margin:0;min-width:52px">Release</span>
                <input type="range" min="0" max="100" step="1"
                    value={Math.round(editor.envelope.release * 100)}
                    oninput={e => editor.envelope.release = parseInt(e.target.value) / 100} />
                <span class="al-val">{Math.round(editor.envelope.release * 100)}%</span>
            </div>
        {/if}
        <div class="al-range-row">
            <span class="al-label" style="margin:0;min-width:52px">Floor</span>
            <input type="range" min="0" max="100" step="1"
                value={Math.round(editor.envelope.floor * 100)}
                oninput={e => editor.envelope.floor = parseInt(e.target.value) / 100} />
            <span class="al-val">{Math.round(editor.envelope.floor * 100)}%</span>
        </div>
    {/if}
</div>