<!-- src/components/velocity/AirbotPanel.svelte -->
<!-- 
    generative airbot
    describe a theme, get gradient result cards.  
    owns server lifecycle UI. this is where agentic panel gets activated too
-->
<script>
import { onMount, onDestroy } from 'svelte';
import { invoke }             from '@tauri-apps/api/core';
import { listen }             from '@tauri-apps/api/event';
import { open }               from '@tauri-apps/plugin-dialog';
import { readFile }           from '@tauri-apps/plugin-fs';

import { editor }             from '../../stores/velocity.svelte.js';
import { pushUndo }           from '../../stores/velocityActions.svelte.js';
import { setLlamaStatus, initLlamaServerStore } from '../../stores/llama-server.svelte.js';

import { toHex }              from '../../lib/aerolux/palette.js';
import { showToast }          from '../../lib/aerolux/toast.js';
import { playSound }          from '../../lib/aerolux/sound.js';
import { runCompatCheck, isAccelerationAvailable } from '../../lib/aerolux/compat.js';
import { colorToNearestPalette } from '../../lib/aerolux/airbot.js';
import { buildGradient }      from '../../lib/aerolux/gradient.js';
import { gradToText, safeFilename, downloadText } from '../../lib/aerolux/utils.js';
import { GENERATIVE_GRAMMAR } from '../../lib/aerolux/airbot-grammars.js';
import StatusPill             from '../shared/StatusPill.svelte';

// server status ─────────────────────────────────────────────────────
// 'idle' | 'downloading-binary' | 'downloading-model' | 'starting'
// | 'ready' | 'error'
let serverStatus     = $state('idle');
let serverStatusText = $state('Not started');
let downloadProgress = $state({ binary: 0, model: 0, mmproj: 0 });
let paths            = $state({ binary_path: null, model_path: null, mmproj_path: null });

// Wrapper — every serverStatus mutation also propagates to the shared
// store so AirbotAgenticPanel reacts without polling.
function setStatus(s) {
    serverStatus = s;
    setLlamaStatus(s);
}

// image attachment ──────────────────────────────────────────────────
// when set, the image is included in the user message as a multimodal
// content array. mmproj must be loaded (paths.mmproj_path non-null)
// for the model to actually process it; we warn if not.
let attachedImage = $state(null);
// { dataUrl: string, mimeType: string, filename: string, preview: string }

async function pickImage() {
    try {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'Image', extensions: ['png','jpg','jpeg','webp','gif'] }],
        });
        if (!selected) return;

        const bytes    = await readFile(selected);
        const ext      = selected.split('.').pop().toLowerCase();
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                       : ext === 'png'  ? 'image/png'
                       : ext === 'webp' ? 'image/webp'
                       : ext === 'gif'  ? 'image/gif'
                       : 'image/png';

        // convert Uint8Array → base64
        const b64 = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
        const dataUrl = `data:${mimeType};base64,${b64}`;

        attachedImage = {
            dataUrl,
            mimeType,
            filename: selected.split('/').pop() ?? selected.split('\\').pop() ?? 'image',
            preview:  dataUrl,
        };

        if (!paths.mmproj_path) {
            showToast('Image attached. Note: vision projector (mmproj) was not found. The model may ignore the image.', 'warning', 6000);
        } else {
            showToast('Image attached', 'success', 1500);
        }
    } catch (e) {
        showToast('Could not load image: ' + e, 'error');
    }
}

function clearImage() {
    attachedImage = null;
}

// generation state ──────────────────────────────────────────────────
let generating   = $state(false);
let streamText   = $state('');
let currentGenId = $state('');
let tps          = $state(null);
let tokenCount   = $state(0);
let genStart     = 0;

// results ───────────────────────────────────────────────────────────
let results = $state([]);

// prompt / options ──────────────────────────────────────────────────
let prompt         = $state('');
let count          = $state(1);
let stopsOverride  = $state('');
let lengthOverride = $state('');

const PLACEHOLDERS = [
    'Desert at sunset, warm oranges and deep reds, 16 steps',
    'Deep ocean, dark teals fading to black, 12 steps',
    'Northern lights, greens and purples across a dark sky',
    'Neon city at night, electric blues and hot pinks',
    'Autumn forest, burnt oranges yellows and russet browns',
    'Snowstorm, cold whites and steel greys, 8 steps',
    'Cherry blossom, soft pinks into pale white, vivid algorithm',
    'Deep space, navy black with violet and cyan nebulae',
];
let phIdx        = $state(0);
let phVisible    = $state(true);
let phTimer      = null;
let inputFocused = $state(false);

onMount(() => {
    phTimer = setInterval(() => {
        if (inputFocused || prompt) return;
        phVisible = false;
        setTimeout(() => {
            phIdx    = (phIdx + 1) % PLACEHOLDERS.length;
            phVisible = true;
        }, 300);
    }, 4000);
});
onDestroy(() => clearInterval(phTimer));

const placeholder = $derived(PLACEHOLDERS[phIdx]);

// system prompt ─────────────────────────────────────────────────────
// todo: improve this and make it more detailed for better edits

function buildSystemPrompt(hasImage) {
    const imageNote = hasImage
        ? '\nAn image has been provided. Extract its dominant colours and mood to inform the gradient. Map the key colours to palette stops.'
        : '';
    return `/nothink
you are a JSON API. your entire response must be a single JSON object and nothing else. no words, notes, or explanation, only the JSON object itself, starting with { and ending with }.${imageNote}

Output this exact structure:
{
  "name": "string",
  "description": "string",
  "stops": [
    {"pos": 0.0, "r": 0, "g": 0, "b": 0},
    {"pos": 1.0, "r": 0, "g": 0, "b": 0}
  ],
  "length": 8,
  "algorithm": "rgb | lab | hsl | vivid | stepped",
  "hslDir": "shortest | longest",
  "easing": "linear | easeIn | easeOut | sCurve | cubicIn | cubicOut | sineIn | sineOut | sineBoth | expoIn | expoOut | bounce | elastic"
}

Rules:
- name: short gradient name, plain text
- description: one sentence, plain text
- stops: 2–8 entries, first pos must be 0.0, last must be 1.0
- r g b: integers 0–255
- length: integer 2–32
- algorithm: exactly one of: rgb lab hsl vivid stepped
- easing: exactly one of the listed values
- Output ONLY the JSON object. First character is {. Last character is }.

Algorithm advantages:
- rgb: simple and fast, but may produce muddy results
- lab: perceptually uniform, good for smooth gradients
- hsl: intuitive colour wheel control, great for rainbows
- vivid: maximises colourfulness
- stepped: hard colour bands, ideal for pixel art styles

Notes:
- if hsl is chosen, it travels the entire wheel between EVERY stop. this can lead to messy gradients if there are more than 2 stops.
- you must avoid colour repetition as much as possible. dont generate gradients based only on the prompt, also consider what the final output would be like.
- choosing any easing other than linear will lead to colour repetitions.
- stepped will repeat the colour of a stop until the next stop is reached. if you are using stepped, try to keep the length equal to the number of stops.`;
}

// build user message content ────────────────────────────────────────
// returns a string for text-only, or a content array for multimodal

function buildUserContent(userPrompt, image) {
    if (!image) return userPrompt;
    return [
        { type: 'text',      text: userPrompt },
        { type: 'image_url', image_url: { url: image.dataUrl } },
    ];
}

// event listeners ───────────────────────────────────────────────────
let unlistenToken, unlistenDone, unlistenError, unlistenProgress, unlistenReady, unlistenFailed;

onMount(async () => {
    // initialise shared store
    // idempotent, safe to call here even if another component calls it too
    await initLlamaServerStore();

    try { paths = await invoke('get_llama_paths'); } catch {}

    unlistenProgress = await listen('llama:download-progress', ({ payload }) => {
        if (payload.target === 'binary') downloadProgress.binary = payload.percent;
        if (payload.target === 'model')  downloadProgress.model  = payload.percent;
        if (payload.target === 'mmproj') downloadProgress.mmproj = payload.percent;
    });

    // server lifecycle. update local UI AND shared store via setStatus()
    unlistenReady = await listen('llama:server-ready', () => {
        serverStatus     = 'ready';
        serverStatusText = 'Airbot ready';
        showToast('Airbot ready', 'success');
        playSound('aiLoadSuccess');
    });
    unlistenFailed = await listen('llama:server-failed', ({ payload }) => {
        serverStatus     = 'error';
        serverStatusText = 'Failed to start: ' + (payload?.reason ?? payload?.error ?? 'unknown error');
        showToast('Airbot failed to start', 'error');
    });

    unlistenToken = await listen('llama:token', ({ payload }) => {
        if (payload.generation_id !== currentGenId) return;
        if (payload.done) return;
        streamText += payload.delta;
        tokenCount++;
        if (tokenCount === 1) genStart = performance.now();
        if (tokenCount % 5 === 0) {
            const elapsed = (performance.now() - genStart) / 1000;
            tps = elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : null;
        }
    });

    unlistenDone = await listen('llama:generation-done', ({ payload }) => {
        if (payload.generation_id !== currentGenId) return;
        handleGenerationComplete(payload.full_text, payload.finish_reason);
    });

    unlistenError = await listen('llama:generation-error', ({ payload }) => {
        if (payload.generation_id !== currentGenId) return;
        showToast('Generation failed: ' + payload.error, 'error');
        generating = false;
        playSound('aiGenerateFail');
    });
});

onDestroy(() => {
    unlistenToken?.();
    unlistenDone?.();
    unlistenError?.();
    unlistenProgress?.();
    unlistenReady?.();
    unlistenFailed?.();
    clearInterval(phTimer);
});

// server lifecycle ──────────────────────────────────────────────────

async function ensureDownloaded() {
    paths = await invoke('get_llama_paths');

    if (!paths.binary_path) {
        const ok = await isAccelerationAvailable();
        if (!ok) {
            showToast('Hardware acceleration required for Airbot', 'error', 5000);
            return false;
        }
        setStatus('downloading-binary');
        serverStatusText = 'Downloading Airbot engine…';
        try {
            await invoke('download_llama_binary');
            paths = await invoke('get_llama_paths');
        } catch (e) {
            setStatus('error');
            serverStatusText = 'Download failed: ' + e;
            showToast('Binary download failed: ' + e, 'error');
            return false;
        }
    }

    if (!paths.model_path) {
        setStatus('downloading-model');
        serverStatusText = 'Downloading AI model (~5 GB)…';
        try {
            await invoke('download_llama_model');
            paths = await invoke('get_llama_paths');
        } catch (e) {
            setStatus('error');
            serverStatusText = 'Model download failed: ' + e;
            showToast('Model download failed: ' + e, 'error');
            return false;
        }
    }

    return true;
}

async function startAirbot() {
    const downloaded = await ensureDownloaded();
    if (!downloaded) return;

    setStatus('starting');
    serverStatusText = 'Starting Airbot…';
    try {
        await invoke('llama_start_server', {
            binaryPath:      paths.binary_path,
            modelPath:       paths.model_path,
            mmprojPath:      paths.mmproj_path,
            ctxSize:         4096,
            enableThinking:  false,
            reasoningBudget: 0,
        });
        // final status update comes via llama:server-ready / llama:server-failed events
    } catch (e) {
        setStatus('error');
        serverStatusText = 'Failed: ' + e;
        showToast('Failed to start Airbot: ' + e, 'error');
    }
}

async function stopAirbot() {
    try {
        await invoke('llama_stop_server');
        setStatus('idle');
        serverStatusText = 'Stopped';
        showToast('Airbot stopped', 'info', 1500);
    } catch (e) {
        showToast('Failed to stop: ' + e, 'error');
    }
}

// generation ────────────────────────────────────────────────────────

async function generate() {
    if (serverStatus !== 'ready') { showToast('Start Airbot first', 'warning'); return; }
    if (!prompt.trim() && !attachedImage) { showToast('Enter a theme or attach an image first', 'warning'); return; }

    const n     = Math.max(1, Math.min(20, count));
    const image = attachedImage;

    for (let i = 0; i < n; i++) {
        if (!generating && i > 0) break;

        currentGenId = `gen-${Date.now()}-${i}`;
        streamText   = '';
        tokenCount   = 0;
        tps          = null;
        generating   = true;
        playSound('aiGenerating');

        const constraints = [];
        if (stopsOverride)  constraints.push(`Use exactly ${stopsOverride} colour stops.`);
        if (lengthOverride) constraints.push(`Set length to exactly ${lengthOverride}.`);
        const basePrompt = prompt.trim() || (image ? 'Generate a gradient inspired by the attached image.' : '');
        const userText   = [
            ...constraints,
            n > 1 ? `${basePrompt} (variation ${i + 1}, make it distinct)` : basePrompt,
        ].join(' ');

        const userContent = buildUserContent(userText, image);

        try {
            await invoke('llama_generate', {
                request: {
                    generation_id: currentGenId,
                    messages: [
                        { role: 'system', content: buildSystemPrompt(!!image) },
                        { role: 'user',   content: userContent },
                    ],
                    max_tokens:  600,
                    temperature: Math.min(1.0, 0.4 + i * 0.05),
                    json_schema: null,
                    grammar:     GENERATIVE_GRAMMAR,
                    stream:      true,
                },
            });

            // wait for this generation to finish before starting the next
            await new Promise(resolve => {
                const check = (payload) => payload.generation_id === currentGenId;
                Promise.race([
                    new Promise(r => listen('llama:generation-done',  ({ payload }) => { if (check(payload)) r(); })),
                    new Promise(r => listen('llama:generation-error', ({ payload }) => { if (check(payload)) r(); })),
                ]).then(resolve);
            });
        } catch (e) {
            showToast(`Generation ${i + 1} failed: ${e}`, 'error');
        }
    }

    generating = false;
    if (results.length > 0) playSound('aiGenerateSuccess');
}

function handleGenerationComplete(fullText, finishReason) {
    if (finishReason === 'abort') {
        generating = false;
        showToast('Generation stopped', 'warning');
        return;
    }

    try {
        let cleaned = fullText
            .replace(/<think>[\s\S]*?<\/think>/i, '')
            .replace(/^[^{]*/, '').replace(/}[^}]*$/, '}')
            .trim();

        let data = JSON.parse(cleaned);

        if (!data.stops || data.stops.length < 2) throw new Error('Fewer than 2 stops');

        data.stops = data.stops.map(s => ({
            pos: Math.max(0, Math.min(1, parseFloat(s.pos) || 0)),
            r:   Math.max(0, Math.min(255, Math.round(parseFloat(s.r) || 0))),
            g:   Math.max(0, Math.min(255, Math.round(parseFloat(s.g) || 0))),
            b:   Math.max(0, Math.min(255, Math.round(parseFloat(s.b) || 0))),
        }));
        data.stops.sort((a, b) => a.pos - b.pos);
        data.stops[0].pos = 0;
        data.stops[data.stops.length - 1].pos = 1;

        const VALID_ALGOS   = ['rgb','lab','hsl','vivid','stepped'];
        const VALID_EASINGS = ['linear','easeIn','easeOut','sCurve','cubicIn','cubicOut',
                               'sineIn','sineOut','sineBoth','expoIn','expoOut','bounce','elastic'];
        if (!VALID_ALGOS.includes(data.algorithm))         data.algorithm = 'rgb';
        if (!VALID_EASINGS.includes(data.easing))          data.easing    = 'linear';
        if (!['shortest','longest'].includes(data.hslDir)) data.hslDir    = 'shortest';

        const gradLen = lengthOverride
            ? parseInt(lengthOverride)
            : Math.max(2, Math.min(32, parseInt(data.length) || 32));

        const aiStops = data.stops.map((s, idx) => ({
            id:  idx,
            pos: s.pos,
            ci:  colorToNearestPalette(s.r, s.g, s.b, editor.palette),
        }));

        const velocities = buildGradient(
            aiStops, editor.palette, data.algorithm, data.easing,
            gradLen, editor.tint, editor.envelope,
            editor.antiRepeat, editor.hueShift, data.hslDir
        );

        results = [...results, {
            id:          currentGenId,
            name:        data.name || `Gradient ${results.length + 1}`,
            description: data.description || '',
            stops:       data.stops,
            algorithm:   data.algorithm,
            easing:      data.easing,
            hslDir:      data.hslDir,
            velocities,
            _aiStops:    aiStops,
        }];

        showToast(count > 1 ? `Gradient ${results.length} of ${count} done` : 'Gradient generated', 'success', 1500);
    } catch (err) {
        showToast('Parse error: ' + err.message, 'error', 4000);
        console.warn('Generation parse error:', err, '\nRaw output:', fullText);
    }
}

function abort() {
    invoke('llama_abort_generation', { generationId: currentGenId }).catch(() => {});
    generating = false;
    showToast('Stopping…', 'info', 1000);
}

function loadResult(result) {
    pushUndo();
    const newStops = result._aiStops.map((s, i) => ({ ...s, id: editor.nextId + i }));
    editor.stops     = newStops;
    editor.algorithm = result.algorithm;
    editor.easing    = result.easing;
    editor.hslDir    = result.hslDir;
    editor.selStop   = newStops[0].id;
    editor.nextId   += newStops.length;
    showToast(`"${result.name}" loaded`, 'success');
}

function downloadResult(result) {
    const text = gradToText(result.velocities);
    const vels = result.velocities.map(v => v.velocity).join('_');
    downloadText(text, `${safeFilename(result.name)}_${vels}`);
    playSound('exportSuccess');
}

async function bulkExport() {
    if (!results.length) return;
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.esm.js')).default;
    const zip   = new JSZip();
    results.forEach(r => {
        const text = gradToText(r.velocities);
        const vels = r.velocities.map(v => v.velocity).join('_');
        zip.file(`${safeFilename(r.name)}_${vels}`, text);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `Airbot_${Date.now()}.zip`; a.click();
    URL.revokeObjectURL(url);
    showToast('Bulk export complete', 'success');
    playSound('downloadSuccess');
}

const statusDotState = $derived(
    serverStatus === 'ready'              ? 'ok'   :
    serverStatus === 'starting'           ||
    serverStatus === 'downloading-binary' ||
    serverStatus === 'downloading-model'  ? 'busy' :
    serverStatus === 'error'              ? 'error': ''
);
</script>

<div class="al-card-header">
    <h3 class="al-card-title">
        Airbot <span class="al-logo-sub">Generative</span>
    </h3>
    <StatusPill state={statusDotState} text={serverStatusText} />
</div>

<!-- server controls -->
<div class="al-ai-controls" style="margin-bottom:10px">
    <button class="al-btn" id="ai-compat-btn" onclick={runCompatCheck}>
        Compatibility check
    </button>

    {#if serverStatus === 'idle' || serverStatus === 'error'}
        <button class="al-btn al-btn-blue" onclick={startAirbot}>
            Start Airbot
        </button>
    {:else if serverStatus === 'ready'}
        <button class="al-btn" onclick={stopAirbot}>Stop</button>
    {:else}
        <button class="al-btn" disabled>
            {serverStatus === 'downloading-binary' ? 'Downloading engine…'
             : serverStatus === 'downloading-model' ? 'Downloading model…'
             : 'Starting…'}
        </button>
    {/if}
</div>

<!-- compat result box -->
<div class="al-compat-box" id="ai-compat-box" style="display:none">
    <div id="ai-compat-rows"></div>
    <div id="ai-compat-verdict"></div>
</div>

<!-- download progress -->
{#if serverStatus === 'downloading-binary' || serverStatus === 'downloading-model'}
    <div style="margin-bottom:12px">
        {#if serverStatus === 'downloading-binary'}
            <div class="al-progress-header">
                <span class="al-label">Engine</span>
                <span class="al-val">{downloadProgress.binary}%</span>
            </div>
            <div class="al-progress-track">
                <div class="al-progress-fill" style="width:{downloadProgress.binary}%"></div>
            </div>
        {/if}
        {#if serverStatus === 'downloading-model'}
            <div class="al-progress-header" style="margin-top:8px">
                <span class="al-label">Model</span>
                <span class="al-val">{downloadProgress.model}%</span>
            </div>
            <div class="al-progress-track">
                <div class="al-progress-fill" style="width:{downloadProgress.model}%"></div>
            </div>
            {#if downloadProgress.mmproj > 0}
                <div class="al-progress-header" style="margin-top:4px">
                    <span class="al-label">Projector</span>
                    <span class="al-val">{downloadProgress.mmproj}%</span>
                </div>
                <div class="al-progress-track">
                    <div class="al-progress-fill" style="width:{downloadProgress.mmproj}%"></div>
                </div>
            {/if}
        {/if}
    </div>
{/if}

<!-- image attachment -->
{#if attachedImage}
    <div class="ab-image-preview">
        <img src={attachedImage.preview} alt={attachedImage.filename} class="ab-image-thumb" />
        <div class="ab-image-meta">
            <span class="ab-image-name">{attachedImage.filename}</span>
            <span class="al-dim" style="font-size:10px">
                {paths.mmproj_path ? 'Vision ready' : '⚠ No mmproj'}
            </span>
        </div>
        <button class="al-btn al-btn-ghost ab-image-clear" onclick={clearImage}
            title="Remove image" disabled={generating}>×</button>
    </div>
{/if}

<!-- prompt row -->
<div class="al-prompt-row">
    <input
        class="al-text-input ag-prompt-input"
        type="text"
        placeholder={placeholder}
        bind:value={prompt}
        class:ag-ph-visible={!prompt && phVisible}
        disabled={serverStatus !== 'ready' || generating}
        onfocus={() => inputFocused = true}
        onblur={()  => inputFocused = false}
        onkeydown={e => e.key === 'Enter' && !generating && generate()}
    />
    <!-- image attach button -->
    <button
        class="al-btn ab-attach-btn"
        class:ab-attach-btn--active={!!attachedImage}
        onclick={pickImage}
        disabled={serverStatus !== 'ready' || generating}
        title={attachedImage ? 'Change image' : 'Attach image for colour extraction'}
    >🖼</button>

    {#if generating}
        <button class="al-btn al-btn-danger" onclick={abort}>✕ Stop</button>
    {:else}
        <button class="al-btn al-btn-blue"
            disabled={serverStatus !== 'ready'}
            onclick={generate}>
            Generate
        </button>
    {/if}
</div>

<!-- options -->
<div class="al-ai-options" style="margin-bottom:10px">
    <div class="al-option-group">
        <span class="al-label">Count</span>
        <input type="number" class="al-num-input"
            min="1" max="20" bind:value={count}
            disabled={serverStatus !== 'ready' || generating} />
    </div>
    <div class="al-option-group">
        <span class="al-label">Stops</span>
        <input type="number" class="al-num-input"
            min="2" max="8" placeholder="auto"
            bind:value={stopsOverride}
            disabled={serverStatus !== 'ready' || generating} />
    </div>
    <div class="al-option-group">
        <span class="al-label">Length</span>
        <input type="number" class="al-num-input"
            min="2" max="32" placeholder="auto"
            bind:value={lengthOverride}
            disabled={serverStatus !== 'ready' || generating} />
    </div>
</div>

<!-- stream preview -->
{#if generating && streamText}
    <div style="margin-bottom:8px">
        <div class="al-stream-header">
            <span class="al-label">Generating</span>
            <div class="al-tps-badge">
                <span>{tps ?? '—'}</span>
                <span class="al-dim">tok/s</span>
                <span class="al-dim">{tokenCount} tok</span>
            </div>
        </div>
        <pre class="al-stream-pre">{streamText}</pre>
    </div>
{/if}

<!-- results -->
{#if results.length}
    <div class="al-card-header" style="margin-top:12px">
        <p class="al-label" style="margin:0">Generated gradients</p>
        <div style="display:flex;gap:6px">
            {#if results.length > 1}
                <button class="al-btn al-btn-green" onclick={bulkExport}>
                    ⬇ Bulk .zip
                </button>
            {/if}
            <button class="al-btn" onclick={() => results = []}>Clear all</button>
        </div>
    </div>

    {#each results as result (result.id)}
        {@const palette = editor.palette}
        <div class="al-ai-card">
            <div class="al-ai-bar">
                {#each result.velocities as { velocity }}
                    {@const c = palette[velocity] ?? palette[0]}
                    <div style="background:{toHex(c.r, c.g, c.b)}"></div>
                {/each}
            </div>
            <div class="al-ai-name">{result.name}</div>
            <div class="al-ai-desc">{result.description}</div>
            <div class="al-ai-btns">
                <button class="al-btn" onclick={() => loadResult(result)}>
                    Load into editor
                </button>
                <button class="al-btn al-btn-green" onclick={() => downloadResult(result)}>
                    ⬇ Download
                </button>
            </div>
        </div>
    {/each}
{/if}

<style>
/* prompt input */
.ag-prompt-input { flex: 1; min-width: 0; }
.ag-prompt-input::placeholder { transition: opacity var(--duration-base) var(--ease-smooth); }
.ag-prompt-input:not(.ag-ph-visible)::placeholder { opacity: 0; }

/* image attach button */
.ab-attach-btn {
    flex-shrink: 0;
    font-size:   15px;
    padding:     0 10px;
}
.ab-attach-btn--active {
    background:   var(--color-accent-subtle)  !important;
    border-color: var(--color-accent-border)  !important;
    box-shadow:   var(--glow-accent)          !important;
}

/* image preview strip */
.ab-image-preview {
    display:       flex;
    align-items:   center;
    gap:           10px;
    padding:       8px 10px;
    margin-bottom: 8px;
    border:        1px solid var(--color-border-bright);
    border-radius: var(--radius-md);
    background:    var(--color-surface-1);
}
.ab-image-thumb {
    width:         48px;
    height:        48px;
    object-fit:    cover;
    border-radius: var(--radius-sm);
    border:        1px solid var(--color-border);
    flex-shrink:   0;
}
.ab-image-meta {
    display:        flex;
    flex-direction: column;
    gap:            3px;
    flex:           1;
    min-width:      0;
}
.ab-image-name {
    font-size:     var(--font-size-xs);
    font-weight:   var(--font-weight-medium);
    white-space:   nowrap;
    overflow:      hidden;
    text-overflow: ellipsis;
}
.ab-image-clear {
    flex-shrink: 0;
    font-size:   16px;
    padding:     0 8px;
    opacity:     0.5;
}
.ab-image-clear:hover { opacity: 1; }
</style>