<!-- src/components/shared/ThemeToggle.svelte -->
<script>
import { theme, getResolvedAccentH, setMode, setAccentH, resetAccent } from '../../stores/theme.svelte.js';

const icons  = { dark: '🌙', light: '☀️', system: '⚙' };
const labels = { dark: 'Dark', light: 'Light', system: 'Auto' };
const modes  = ['dark', 'light', 'system'];

let { compact = false } = $props();

function cycleMode() {
    const i = modes.indexOf(theme.mode);
    setMode(modes[(i + 1) % modes.length]);
}

let showPicker = $state(false);

// Live preview while dragging slider
let draftH = $state(getResolvedAccentH());
$effect(() => { draftH = getResolvedAccentH(); });

function onHueInput(e) {
    draftH = parseInt(e.target.value);
    document.documentElement.style.setProperty('--accent-h', String(draftH));
}

async function onHueCommit(e) {
    await setAccentH(parseInt(e.target.value));
}
</script>

{#if compact}

{:else}
<div class="ttw">
    <button class="al-btn ttw-mode" style="margin: 4px;"
        onclick={cycleMode}
        title="Theme: {labels[theme.mode]}"
    >{icons[theme.mode]}</button>

    <button
        class="ttw-dot"
        style="background: hsl({draftH},88%,58%);
               box-shadow: 0 0 8px hsl({draftH},80%,55%,0.5);"
        onclick={() => showPicker = !showPicker}
        title="Accent colour"
    ></button>

    {#if showPicker}
        <!-- click-away overlay -->
        <div class="ttw-backdrop" onclick={() => showPicker = false}></div>

        <div class="ttw-picker">
            <p class="al-label" style="margin-bottom: 8px">Accent colour</p>

            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px">
                <div class="ttw-preview"
                    style="background:hsl({draftH},88%,58%);
                           box-shadow:0 0 10px hsl({draftH},80%,55%,0.5)">
                </div>
                <span class="al-mono" style="color:var(--color-text-secondary)">
                    {draftH}°
                </span>
            </div>

            <input
                type="range"
                min="0" max="359" step="1"
                value={draftH}
                class="al-hue-slider"
                style="width:100%"
                oninput={onHueInput}
                onchange={onHueCommit}
            />

            {#if theme.accentH !== null}
                <button class="al-btn al-btn-ghost"
                    style="margin-top:8px;width:100%;font-size:11px"
                    onclick={resetAccent}
                >Reset to default</button>
            {/if}
        </div>
    {/if}
</div>
{/if}

<style>
.ttw { position:relative; display:flex; align-items:center; gap:6px; }

.ttw-mode { width:32px; padding:0; font-size:15px; }

.ttw-dot {
    width:18px; height:18px; border-radius:999px;
    border:2px solid rgba(255,255,255,0.25);
    cursor:pointer; flex-shrink:0;
    transition:transform 0.15s ease, box-shadow 0.15s ease;
}
.ttw-dot:hover { transform:scale(1.2); }

.ttw-backdrop {
    position:fixed; inset:0; z-index:190;
}

.ttw-picker {
    position:       absolute;
    top:            calc(100% + 10px);
    right:          0;
    width:          220px;
    padding:        14px;
    background:     var(--color-glass-modal);
    backdrop-filter:        blur(16px) saturate(1.4);
    -webkit-backdrop-filter:blur(16px) saturate(1.4);
    border:         1px solid var(--color-border-bright);
    border-radius:  var(--radius-lg);
    box-shadow:     var(--shadow-modal);
    z-index:        200;
    animation:      al-slide-up 0.15s ease both;
}

.ttw-preview {
    width:28px; height:28px; border-radius:999px;
    border:2px solid rgba(255,255,255,0.3);
    flex-shrink:0; transition:background 0.08s, box-shadow 0.08s;
}
</style>