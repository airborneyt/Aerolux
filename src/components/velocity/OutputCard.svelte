<!-- src/components/velocity/OutputCard.svelte -->
<!--
    output card
    houses the final gradient output, saving and exporting
-->
<script>
import { editor, gradResult } from '../../stores/velocity.svelte.js';
import { pushHistory } from '../../stores/velocityActions.svelte.js';
import { toHex } from '../../lib/aerolux/palette.js';
import { gradToText, downloadText } from '../../lib/aerolux/utils.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { playSound } from '../../lib/aerolux/sound.js';
import GradientBar from '../shared/GradientBar.svelte';
import { encodeState, buildShareUrl } from '../../lib/aerolux/share.js';
import { onMount } from 'svelte';

let { onOpenPresets, saveGradient = null } = $props();

let presetNameOpen  = $state(false);
let presetNameValue = $state('');

// computed current result
const gr = $derived(gradResult());

const outText = $derived(
    gr.map(g => `${g.step}, ${g.velocity};`).join('\n')
);

function confirmSave() {
    if (!presetNameValue.trim()) { showToast('Add a name first', 'warning'); return; }
    if (saveGradient) {
        saveGradient(presetNameValue.trim());
    } else {
        showToast('Preset manager not ready yet. Open the preset browser first', 'warning', 4000);
    }
    presetNameOpen = false;
    presetNameValue = '';
}

async function handleExport() {
    const text     = gradToText(gr);
    const filename = gr.map(g => g.velocity).join(' ');
    await downloadText(text, filename);
    pushHistory({
        ts:        Date.now(),
        stops:     JSON.parse(JSON.stringify(editor.stops)),
        result:    [...gr],
        algorithm: editor.algorithm,
        easing:    editor.easing,
        steps:     editor.steps,
        hslDir:    editor.hslDir,
        hueShift:  editor.hueShift,
        tint:      { ...editor.tint },
        envelope:  { ...editor.envelope },
    });
    showToast('Gradient exported', 'success');
    playSound('exportSuccess');
}

function handleCopy() {
    navigator.clipboard.writeText(outText).then(() =>
        showToast('Copied to clipboard', 'success', 1500)
    );
}

function copyVelocity(vel) {
    navigator.clipboard.writeText(String(vel)).then(() =>
        showToast(`Copied velocity ${vel}`, 'info', 1500)
    );
}

function handleShare() {
    const state = {
        stops:    editor.stops,
        algorithm:editor.algorithm,
        easing:   editor.easing,
        hslDir:   editor.hslDir,
        steps:    editor.steps,
        hueShift: editor.hueShift,
        tint:     editor.tint,
        envelope: editor.envelope,
    };
    const encoded = encodeState(state);
    const url     = buildShareUrl(encoded);
    navigator.clipboard.writeText(url).then(() =>
        showToast('Link copied to clipboard', 'success', 2000)
    );
}
</script>

<div class="al-card">
    <div class="al-card-header">
        <h3 class="al-card-title">Output</h3>

        <div style="display:flex;gap:6px;margin-left:auto;position:relative">
            <button class="al-btn" onclick={() => presetNameOpen = !presetNameOpen}
                title="Save as preset">💾</button>
            <button class="al-btn" onclick={handleShare}
                title="Share gradient as URL">🔗 Share</button>
            <button class="al-btn" onclick={handleCopy}>Copy</button>
            <button class="al-btn al-btn-green" onclick={handleExport}>⬇ Export .txt</button>
        </div>
    </div>

    {#if presetNameOpen}
        <div class="al-pm-name-prompt open">
            <input
                type="text"
                class="al-text-input"
                placeholder="Name this preset…"
                maxlength="48"
                bind:value={presetNameValue}
                style="flex:1;min-width:0"
                onkeydown={e => {
                    if (e.key === 'Enter') confirmSave();
                    if (e.key === 'Escape') { presetNameOpen = false; presetNameValue = ''; }
                }}
            />
            <button class="al-btn al-btn-blue" onclick={confirmSave}>Save</button>
            <button class="al-btn" onclick={() => { presetNameOpen = false; presetNameValue = ''; }}>Cancel</button>
        </div>
    {/if}

    <!-- gradient bar. passes the array value instead of the function -->
    <GradientBar gradResult={gr} palette={editor.palette} height="28px" />

    <!-- velocity chips -->
    <div id="out-chips">
        {#each gr as { step, velocity }}
            <span class="al-chip"
                onclick={() => copyVelocity(velocity)}
                title="vel {velocity}"
            >{velocity}</span>
        {/each}
    </div>

    <div style="display:flex;width:100%">
        <textarea readonly spellcheck="false"
            style="width:100%;resize:none"
            rows={Math.min(gr.length, 8)}
        >{outText}</textarea>
    </div>

    <p class="al-hint-text" style="margin-top:4px">
        Click any chip to copy that velocity · Ctrl/Cmd +C copies all
    </p>
</div>