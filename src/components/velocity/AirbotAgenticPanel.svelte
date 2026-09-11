<!-- src/components/velocity/AirbotAgenticPanel.svelte -->
<!--
    airbot agentic panel
    reads live editor state and applies ai generated action sets
    directly via window.Aerolux.* api calls

    server lifecycle lives exclusively in AirbotPanel.svelte
    this panel subscribes to the shared llamaServer store, so when
    AirbotPanel starts the server, this panel activates immediately
    without any polling

    two modes:
      single: prompt → one action set → applied to editor right away
      batch: prompt → N named variations → result cards, bulk export
-->
<script>
import { onMount, onDestroy } from 'svelte';
import { invoke }             from '@tauri-apps/api/core';
import { listen }             from '@tauri-apps/api/event';

import { editor }             from '../../stores/velocity.svelte.js';
import { llamaServer }        from '../../stores/llama-server.svelte.js';

import { toHex }              from '../../lib/aerolux/palette.js';
import { showToast }          from '../../lib/aerolux/toast.js';
import { playSound }          from '../../lib/aerolux/sound.js';
import { buildGradient }      from '../../lib/aerolux/gradient.js';
import { gradToText, downloadText } from '../../lib/aerolux/utils.js';
import { AGENTIC_GRAMMAR, AGENTIC_BATCH_GRAMMAR }
    from '../../lib/aerolux/airbot-grammars.js';

// derived readiness ─────────────────────────────────────────────────

const serverReady  = $derived(llamaServer.ready);
const serverBusy   = $derived(llamaServer.busy);

// generation state ──────────────────────────────────────────────────

let prompt       = $state('');
let isBatch      = $state(false);
let batchCount   = $state(5);
let generating   = $state(false);
let generationId = null;

let streamText   = $state('');
let tps          = $state('—');
let tokenCount   = $state('');
let statusMsg    = $state('');
let results      = $state([]);

// tauri event unsubscribers
let tokenUnlisten  = null;
let doneUnlisten   = null;
let errorUnlisten  = null;

onDestroy(() => {
    if (tokenUnlisten)  { tokenUnlisten();  tokenUnlisten  = null; }
    if (doneUnlisten)   { doneUnlisten();   doneUnlisten   = null; }
    if (errorUnlisten)  { errorUnlisten();  errorUnlisten  = null; }
});

// placeholder rotation ──────────────────────────────────────────────

const PLACEHOLDERS = [
    'Make this cooler and shift it toward blue',
    'Add a warm amber stop in the middle',
    'Flip to HSL path, longest direction',
    'Generate 6 hue-rotated variations of this pattern',
    'Make it more vivid and push the easing to S-curve',
    'Shorten to 8 steps and make it feel warmer',
    'Swap the start and end colours',
    'Add a white tint at 20% strength',
    'Change algorithm to perceptual LAB',
    'Give this gradient a deep ocean feel',
    'Make it feel warmer, more like sunset fire',
    'Push the saturation up and shorten to 8 steps',
];

let phIdx        = $state(0);
let phFading     = $state(false);
let inputFocused = $state(false);
let phTimer      = null;

onMount(() => {
    phTimer = setInterval(() => {
        if (inputFocused || prompt) return;
        phFading = true;
        setTimeout(() => {
            phIdx    = (phIdx + 1) % PLACEHOLDERS.length;
            phFading = false;
        }, 280);
    }, 4000);
});
onDestroy(() => clearInterval(phTimer));

const placeholder = $derived(PLACEHOLDERS[phIdx]);

// current editor state → context object for the prompt ──────────────

function buildCurrentState() {
    const api   = window.Aerolux;
    const state = api?.read?.getState?.() ?? {
        stops:     editor.stops,
        algorithm: editor.algorithm,
        easing:    editor.easing,
        hslDir:    editor.hslDir,
        steps:     editor.steps,
        tint:      editor.tint,
        nextId:    editor.nextId,
    };

    return {
        steps:      state.steps,
        algorithm:  state.algorithm,
        easing:     state.easing,
        hslDir:     state.hslDir,
        stops: [...(state.stops ?? [])]
            .sort((a, b) => a.pos - b.pos)
            .map(s => {
                const c = editor.palette[s.ci] ?? editor.palette[0];
                return {
                    pos:        Math.round(s.pos * 100) / 100,
                    paletteIdx: s.ci,
                    hex:        toHex(c.r, c.g, c.b),
                };
            }),
        paletteSize: editor.palette.length,
        tint: (state.tint?.ci ?? null) != null
            ? { paletteIdx: state.tint.ci, strength: state.tint.str }
            : null,
    };
}

// system prompts ────────────────────────────────────────────────────
// todo: edit this to include more detail for more accurate edits

function buildSinglePrompt(cs) {
    return `/nothink
You are an agentic gradient editor. Output ONLY: {"actions":[...],"string"}

Actions available:
- {"action":"setStops","stops":[{"pos":0.0,"paletteIdx":1},...]}  2–32 stops, pos 0.0–1.0, must include pos 0.0 and pos 1.0
- {"action":"setAlgorithm","value":"rgb|lab|hsl|vivid|stepped"}
- {"action":"setHslDir","value":"shortest|longest"}
- {"action":"setEasing","value":"linear|easeIn|easeOut|sCurve|cubicIn|cubicOut|sineIn|sineOut|sineBoth|expoIn|expoOut|bounce|elastic"}
- {"action":"setSteps","value":2-32}
- {"action":"setTint","paletteIdx":1,"strength":50}
- {"action":"clearTint"}

palette: 128 entries (index 0–127).
- index 0 is invalid. Never use 0 in setStops or setTint.
- index 1–7 white→black fade. index 1 brightest.
- index 8–67 deep colours in hue groups of 4 (red, orange, yellow, green, blue, purple, rose…).
- index 68–127 pastel variants of the same hue pattern.

current state: ${JSON.stringify(cs)}`;
}

function buildBatchPrompt(cs, n) {
    return `/nothink
You are an agentic gradient editor. Generate ${n} distinct, creative variations.
Output ONLY: {"variations":[{"name":"string","actions":[...]}],"string"}

Actions: setStops (2–32 stops, pos 0–1, paletteIdx 1–127), setAlgorithm (rgb|lab|hsl|vivid|stepped),
setHslDir (shortest|longest), setEasing (linear|easeIn|easeOut|sCurve|cubicIn|cubicOut|sineIn|
sineOut|sineBoth|expoIn|expoOut|bounce|elastic), setSteps (2–32), setTint (paletteIdx 1–127,
strength 0–100), clearTint.

palette: 128 entries. Index 0 invalid. 1–7 grey. 8–67 deep colours. 68–127 pastels.
Make each variation meaningfully different. Vary hues, algorithm, easing, and length.

current state: ${JSON.stringify(cs)}`;
}

// action executor ───────────────────────────────────────────────────

function applyActions(actions) {
    const api = window.Aerolux;
    if (!api) { showToast('Editor API not ready', 'error'); return false; }

    for (const act of actions) {
        try {
            switch (act.action) {
                case 'setStops': {
                    if (!Array.isArray(act.stops) || act.stops.length < 2) break;
                    const nextId = api.read.getState()?.nextId ?? 100;
                    const stops  = act.stops.map((s, i) => ({
                        id:  nextId + i,
                        pos: Math.max(0, Math.min(1, parseFloat(s.pos) || 0)),
                        ci:  Math.max(1, Math.min(127, Math.round(s.paletteIdx) || 1)),
                    }));
                    stops[0].pos = 0;
                    stops[stops.length - 1].pos = 1;
                    api.gradient.setStops(stops);
                    break;
                }
                case 'setAlgorithm':
                    if (['rgb','lab','hsl','vivid','stepped'].includes(act.value))
                        api.gradient.setAlgorithm(act.value);
                    break;
                case 'setHslDir':
                    if (['shortest','longest'].includes(act.value))
                        api.gradient.setHslDir(act.value);
                    break;
                case 'setEasing': {
                    const valid = ['linear','easeIn','easeOut','sCurve','cubicIn','cubicOut',
                                   'sineIn','sineOut','sineBoth','expoIn','expoOut','bounce','elastic'];
                    if (valid.includes(act.value)) api.gradient.setEasing(act.value);
                    break;
                }
                case 'setSteps':
                    api.gradient.setSteps(Math.max(2, Math.min(16, Math.round(act.value) || 8)));
                    break;
                case 'setTint':
                    if (!act.paletteIdx || act.paletteIdx < 1) {
                        api.gradient.clearTint();
                    } else {
                        api.gradient.setTint(
                            Math.max(1, Math.min(127, Math.round(act.paletteIdx))),
                            Math.max(0, Math.min(100, Math.round(act.strength ?? 50))),
                            null,
                        );
                    }
                    break;
                case 'clearTint':
                    api.gradient.clearTint();
                    break;
                default:
                    console.warn('[Airbot agentic] Unknown action:', act.action);
            }
        } catch (err) {
            console.warn('[Airbot agentic] Action failed:', act, err);
        }
    }
    return true;
}

// simulate actions (for batch preview bars, no live edits) ──────────
// api must be declared before use

function simulateActions(actions) {
    const api   = window.Aerolux;
    const state = api?.read?.getState?.() ?? {
        stops:     editor.stops,
        algorithm: editor.algorithm,
        easing:    editor.easing,
        hslDir:    editor.hslDir,
        steps:     editor.steps,
        tint:      editor.tint,
        nextId:    100,
    };

    let stops     = (state.stops ?? editor.stops).map(s => ({ ...s }));
    let algorithm = state.algorithm ?? editor.algorithm;
    let easing    = state.easing    ?? editor.easing;
    let hslDir    = state.hslDir    ?? editor.hslDir;
    let steps     = state.steps     ?? editor.steps;
    let tint      = { ...(state.tint ?? editor.tint) };
    let idCtr     = (state.nextId   ?? 100) + 100;

    for (const act of actions) {
        try {
            switch (act.action) {
                case 'setStops': {
                    if (!Array.isArray(act.stops) || act.stops.length < 2) break;
                    stops = act.stops.map((s, i) => ({
                        id:  idCtr + i,
                        pos: Math.max(0, Math.min(1, parseFloat(s.pos) || 0)),
                        ci:  Math.max(1, Math.min(127, Math.round(s.paletteIdx) || 1)),
                    }));
                    stops[0].pos = 0;
                    stops[stops.length - 1].pos = 1;
                    idCtr += act.stops.length;
                    break;
                }
                case 'setAlgorithm':  algorithm = act.value; break;
                case 'setHslDir':     hslDir    = act.value; break;
                case 'setEasing':     easing    = act.value; break;
                case 'setSteps':      steps = Math.max(2, Math.min(16, Math.round(act.value) || 8)); break;
                case 'setTint':
                    tint = act.paletteIdx > 0
                        ? { ci:   Math.max(1, Math.min(127, Math.round(act.paletteIdx))),
                            str:  Math.max(0, Math.min(100, Math.round(act.strength ?? 50))),
                            fade: null }
                        : { ci: null, str: 0, fade: null };
                    break;
                case 'clearTint':
                    tint = { ci: null, str: 0, fade: null };
                    break;
            }
        } catch {}
    }

    return buildGradient(
        stops, editor.palette,
        algorithm, easing, steps, tint,
        { shape: 'none', attack: 0.2, release: 0.2, floor: 0 },
        true, 0, hslDir,
    );
}

// stream setup ──────────────────────────────────────────────────────

let tokenBuffer = '';
let tokenStart  = 0;
let tokensSeen  = 0;

function resetStream() {
    tokenBuffer = ''; tokenStart = 0; tokensSeen = 0;
    streamText = ''; tps = '—'; tokenCount = '';
}

async function subscribeEvents() {
    if (tokenUnlisten)  { tokenUnlisten();  tokenUnlisten  = null; }
    if (doneUnlisten)   { doneUnlisten();   doneUnlisten   = null; }
    if (errorUnlisten)  { errorUnlisten();  errorUnlisten  = null; }

    // llama_chat.rs emits TokenEvent { generation_id, delta, done }
    // the field is `delta`, not `token`
    tokenUnlisten = await listen('llama:token', ({ payload }) => {
        if (payload.generation_id !== generationId) return;
        if (payload.done) return;
        tokenBuffer += payload.delta;
        tokensSeen++;
        if (tokensSeen === 1) tokenStart = performance.now();
        if (tokensSeen % 5 === 0) {
            const elapsed = (performance.now() - tokenStart) / 1000;
            tps        = elapsed > 0 ? (tokensSeen / elapsed).toFixed(1) : '—';
            tokenCount = `${tokensSeen} tok`;
        }
        streamText = tokenBuffer;
    });

    doneUnlisten = await listen('llama:generation-done', ({ payload }) => {
        if (payload.generation_id !== generationId) return;
        if (tokensSeen > 0) {
            const e = (performance.now() - tokenStart) / 1000;
            tps        = e > 0 ? (tokensSeen / e).toFixed(1) : '—';
            tokenCount = `${tokensSeen} tok`;
        }
        handleDone(tokenBuffer);
    });

    errorUnlisten = await listen('llama:generation-error', ({ payload }) => {
        if (payload.generation_id !== generationId) return;
        finishGenerating();
        statusMsg = 'Error: ' + (payload.error ?? 'Unknown');
        showToast('Airbot generation failed', 'error', 4000);
    });
}

// parse response ────────────────────────────────────────────────────

function cleanJson(raw) {
    return raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*/gi, '')
        .replace(/^[^{]*/, '')
        .replace(/}[^}]*$/, '}')
        .trim();
}

function parseResponse(raw) {
    const cleaned = cleanJson(raw);
    try { return JSON.parse(cleaned); }
    catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
        throw new Error('Response was not valid JSON');
    }
}

// generation done ───────────────────────────────────────────────────

function handleDone(raw) {
    try {
        const data = parseResponse(raw);

        if (isBatch) {
            if (!Array.isArray(data.variations) || !data.variations.length)
                throw new Error('No variations in response');

            results = data.variations.map(v => {
                let gr = [];
                try { gr = simulateActions(v.actions ?? []); } catch {}
                return { name: v.name ?? 'Variation', actions: v.actions ?? [], gradResult: gr };
            });

            statusMsg = `${results.length} variation${results.length !== 1 ? 's' : ''} ready.`
                + ('');
            showToast(`Batch done — ${results.length} variations`, 'success');
            playSound('aiGenerateSuccess');

        } else {
            if (!Array.isArray(data.actions) || !data.actions.length)
                throw new Error('No actions in response');

            const ok = applyActions(data.actions);
            if (ok) {
                statusMsg   = 'Done';
                showToast('Gradient updated by Airbot', 'success');
                playSound('aiGenerateSuccess');
            }
        }
    } catch (err) {
        statusMsg = 'Parse error: ' + err.message;
        showToast('Could not parse Airbot response', 'error', 4000);
        console.error('[Airbot agentic] Parse error:', err, '\nRaw:', raw);
    } finally {
        finishGenerating();
    }
}

function finishGenerating() {
    generating   = false;
    generationId = null;
}

// run ───────────────────────────────────────────────────────────────

async function run() {
    if (!serverReady) { showToast('Start Airbot from the Airbot panel first', 'warning'); return; }
    if (!prompt.trim()) { showToast('Describe what you want first', 'warning'); return; }
    if (generating) return;

    const currentState = buildCurrentState();

    generating   = true;
    results      = [];
    statusMsg    = isBatch ? `Generating ${batchCount} variations…` : 'Thinking…';
    resetStream();

    generationId = String(Date.now());
    await subscribeEvents();

    const sysPrompt = isBatch
        ? buildBatchPrompt(currentState, batchCount)
        : buildSinglePrompt(currentState);

    try {
        await invoke('llama_generate', {
            request: {
                generation_id: generationId,
                messages: [
                    { role: 'user', content: sysPrompt + '\n\nUser request: ' + prompt.trim() },
                ],
                temperature: 0.55,
                max_tokens:  isBatch ? 900 : 500,
                grammar:     isBatch ? AGENTIC_BATCH_GRAMMAR : AGENTIC_GRAMMAR,
            },
        });
    } catch (err) {
        finishGenerating();
        statusMsg = 'Could not start generation: ' + err;
        showToast('Generation failed: ' + err, 'error', 5000);
    }
}

// abort ─────────────────────────────────────────────────────────────

async function abort() {
    if (!generationId) return;
    try { await invoke('llama_abort_generation', { generationId }); } catch {}
    finishGenerating();
    statusMsg = 'Stopped';
    showToast('Stopped', 'warning', 1200);
}

// variation actions ─────────────────────────────────────────────────

function loadVariation(result) {
    if (applyActions(result.actions))
        showToast(`"${result.name}" loaded`, 'success');
}

function downloadVariation(result) {
    if (!result.gradResult?.length) { showToast('No gradient to download', 'warning'); return; }
    const text = gradToText(result.gradResult);
    const slug = result.name.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
    const vels = result.gradResult.map(g => g.velocity).join('_');
    downloadText(text, `${slug}_${vels}`);
    playSound('exportSuccess');
}

async function bulkExport() {
    if (!results.length) return;
    try {
        const JSZip = (await import('jszip')).default;
        const zip   = new JSZip();
        results.forEach(r => {
            if (!r.gradResult?.length) return;
            const text = gradToText(r.gradResult);
            const slug = r.name.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
            const vels = r.gradResult.map(g => g.velocity).join('_');
            zip.file(`${slug}_${vels}.txt`, text);
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const a    = Object.assign(document.createElement('a'), {
            href:     URL.createObjectURL(blob),
            download: `Airbot_agentic_${Date.now()}.zip`,
        });
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Bulk export complete', 'success');
        playSound('downloadSuccess');
    } catch (err) {
        showToast('Zip export failed: ' + err.message, 'error');
    }
}
</script>

<!-- server not-ready banner -->
{#if !serverReady}
    <div class="ag-banner" class:ag-banner--busy={serverBusy}>
        <span class="ag-banner-icon">{serverBusy ? '⏳' : '🤖'}</span>
        <div class="ag-banner-copy">
            <p class="ag-banner-title">
                {serverBusy ? 'Airbot is starting up…' : 'Airbot isn\'t running yet'}
            </p>
            <p class="ag-banner-desc">
                {#if serverBusy}
                    This panel will activate automatically once the server is ready.
                {:else}
                    Load the model from the <strong>Airbot</strong> panel at the bottom of
                    the screen. This panel activates automatically once it's ready.
                {/if}
            </p>
        </div>
        <div class="ag-dot-status" class:ag-dot-status--busy={serverBusy}></div>
    </div>
{/if}

<!-- main panel (greyed out while server offline) -->
<div class="ag-wrap" class:ag-wrap--offline={!serverReady}>

    <p class="al-hint-text" style="margin-bottom:10px">
        Describe a change. 
        Airbot edits the current gradient directly, rather than generating one from scratch.
    </p>

    <!-- prompt row -->
    <div class="al-prompt-row" style="margin-bottom:8px">
        <input
            class="al-text-input ag-prompt"
            type="text"
            bind:value={prompt}
            placeholder={placeholder}
            class:ag-ph-fade={phFading && !prompt}
            disabled={generating || !serverReady}
            autocomplete="off"
            onkeydown={e => { if (e.key === 'Enter' && !generating) run(); }}
            onfocus={() => inputFocused = true}
            onblur={()  => inputFocused = false}
        />
        {#if !generating}
            <button
                class="al-btn al-btn-blue"
                onclick={run}
                disabled={!serverReady || !prompt.trim()}
            >Run</button>
        {:else}
            <button class="al-btn al-btn-danger" onclick={abort}>✕ Stop</button>
        {/if}
    </div>

    <!-- mode + options row -->
    <div class="ag-opts">
        <label class="al-checkbox-label" style="font-size:12px;gap:6px">
            <input type="checkbox" bind:checked={isBatch} disabled={generating} />
            <span>Batch mode</span>
        </label>

        {#if isBatch}
            <div class="al-option-group">
                <span class="al-label" style="margin:0">Variations</span>
                <input
                    type="number" class="al-num-input"
                    bind:value={batchCount}
                    min="2" max="20" disabled={generating}
                    style="width:52px"
                />
            </div>
        {/if}

        {#if statusMsg}
            <span class="ag-status-text">{statusMsg}</span>
        {/if}
    </div>

    <!-- stream preview -->
    {#if generating || streamText}
        <div class="ag-stream">
            <div class="al-stream-header">
                <span class="al-label">{isBatch ? 'Generating variations' : 'Thinking'}</span>
                <div class="al-tps-badge">
                    <span>{tps}</span>
                    <span class="al-dim">tok/s</span>
                    {#if tokenCount}<span class="al-dim">{tokenCount}</span>{/if}
                </div>
            </div>
            <pre class="al-stream-pre">{streamText}</pre>
        </div>
    {/if}

    <!-- batch result cards -->
    {#if results.length}
        <div class="ag-results-header">
            <p class="al-label" style="margin:0">Variations ({results.length})</p>
            <div style="display:flex;gap:6px">
                <button class="al-btn al-btn-green al-btn-sm" onclick={bulkExport}>
                    ⬇ Bulk .zip
                </button>
                <button class="al-btn al-btn-sm" onclick={() => {
                    results = []; statusMsg = '';
                }}>Clear</button>
            </div>
        </div>

        <div class="ag-cards">
            {#each results as result, i (i)}
                <div class="ag-card">
                    <div class="ag-card-bar">
                        {#each result.gradResult as { velocity }}
                            {@const c = editor.palette[velocity] ?? editor.palette[0]}
                            <div style="background:{toHex(c.r, c.g, c.b)};flex:1"></div>
                        {/each}
                        {#if !result.gradResult?.length}
                            <div class="ag-card-bar-empty">No preview</div>
                        {/if}
                    </div>

                    <div class="ag-card-body">
                        <span class="ag-card-name">{result.name}</span>
                        <span class="ag-card-meta">{result.gradResult.length || '?'} steps</span>
                    </div>

                    <div class="ag-card-footer">
                        <button class="al-btn al-btn-sm al-btn-blue" onclick={() => loadVariation(result)}>
                            Load
                        </button>
                        <button class="al-btn al-btn-sm al-btn-green"
                            onclick={() => downloadVariation(result)}
                            disabled={!result.gradResult?.length}
                            title="Download as .txt"
                        >⬇</button>
                    </div>
                </div>
            {/each}
        </div>
    {/if}

</div>

<style>
/* not-ready banner */
.ag-banner {
    display:       flex;
    align-items:   flex-start;
    gap:           12px;
    padding:       14px 16px;
    border:        1px solid var(--color-border-bright);
    border-radius: var(--radius-lg);
    background:    var(--color-surface-1);
    margin-bottom: 12px;
    flex-wrap:     wrap;
}
.ag-banner--busy {
    border-color: var(--color-warning-border);
    background:   var(--color-warning-subtle);
}
.ag-banner-icon  { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
.ag-banner-copy  { flex: 1; min-width: 0; }
.ag-banner-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); margin-bottom: 3px; }
.ag-banner-desc  { font-size: var(--font-size-xs); color: var(--color-text-secondary); line-height: 1.55; }

.ag-dot-status {
    width: 8px; height: 8px;
    border-radius: var(--radius-full);
    background:    var(--color-text-dim);
    flex-shrink:   0;
    align-self:    center;
}
.ag-dot-status--busy {
    background: var(--color-warning);
    box-shadow: var(--glow-warning);
    animation:  al-pulse 1.2s ease-in-out infinite;
}

/* main panel */
.ag-wrap { transition: opacity var(--duration-base) var(--ease-smooth); }
.ag-wrap--offline { opacity: 0.35; pointer-events: none; user-select: none; }

.ag-prompt { flex: 1; min-width: 0; }
.ag-prompt.ag-ph-fade::placeholder { opacity: 0; transition: opacity 0.28s ease; }
.ag-prompt::placeholder            { transition: opacity 0.28s ease; }

.ag-opts {
    display: flex; align-items: center;
    gap: 12px; flex-wrap: wrap; margin-bottom: 10px;
}

.ag-status-text {
    font-size: var(--font-size-xs); color: var(--color-text-dim);
    flex: 1; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.ag-stream { margin-bottom: 10px; }

/* result cards */
.ag-results-header {
    display: flex; align-items: center;
    justify-content: space-between; gap: 8px;
    padding-top: 10px; border-top: 1px solid var(--color-border); margin-bottom: 8px;
}
.ag-cards { display: flex; flex-direction: column; gap: 8px; }

.ag-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden; background: var(--color-surface-0);
    transition: border-color var(--duration-fast) var(--ease-smooth),
                box-shadow   var(--duration-fast) var(--ease-smooth);
}
.ag-card:hover { border-color: var(--color-border-bright); box-shadow: var(--shadow-card); }

.ag-card-bar { height: 28px; display: flex; }
.ag-card-bar-empty {
    display: flex; align-items: center; justify-content: center; flex: 1;
    font-size: var(--font-size-2xs); color: var(--color-text-dim); background: var(--color-surface-1);
}
.ag-card-body { display: flex; align-items: baseline; gap: 8px; padding: 6px 12px 4px; }
.ag-card-name {
    font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold);
    flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ag-card-meta { font-size: var(--font-size-2xs); color: var(--color-text-dim); font-family: 'Geist Mono', monospace; flex-shrink: 0; }
.ag-card-footer { display: flex; align-items: center; gap: 6px; padding: 4px 12px 8px; }
</style>