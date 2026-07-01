// src/lib/aerolux/airbot-panel.js
// generative gradient creation and agentic editor control
// handles WebLLM model lifecycle, generation, and result UI
//
// call initAirbotPanel(callbacks) once after the DOM is ready

import JSZip from 'jszip';
import { settingsStore } from './store.js';
import {
  AI_MODEL,
  AI_SYSTEM_PROMPT,
  PLACEHOLDER_EXAMPLES,
  colorToNearestPalette,
  downloadSingleAiGradient,
} from './airbot.js';
import { buildGradient } from './gradient.js';
import { gradToText, safeFilename, downloadText } from './utils.js';

// module state ──────────────────────────────────────────────────────

let aiEngine   = null;
let aiLoading  = false;
let aiAborted  = false;
let aiResults  = [];

let phIdx      = 0;
let phTimer    = null;
let agentPhIdx = 0;
let agentPhTimer = null;

const AGENT_PLACEHOLDER_EXAMPLES = [
  'Make this cooler and shift it toward blue',
  'Add a warm amber stop in the middle',
  'Flip to HSL path, longest direction',
  'Generate 6 hue-rotated variations of this pattern',
  'Make it more vivid and push the easing to S-curve',
  'Shorten to 8 steps and make it feel warmer',
  'Swap the start and end colours',
  'Add a white tint at 20% strength',
  'Change algorithm to perceptual LAB',
];

const VALID_EASINGS = [
  'linear','easeIn','easeOut','sCurve','cubicIn','cubicOut',
  'sineIn','sineOut','sineBoth','expoIn','expoOut','bounce','elastic'
];

// init ──────────────────────────────────────────────────────────────

/**
 * callbacks:
 *   getPalette()                     → palette array
 *   toHex(r,g,b)                     → hex string
 *   getEditorState()                 → { stops, steps, algorithm, easing, hslDir,
 *                                        hueShift, tint, envelope, antiRepeat, selStop, nextId }
 *   applyEditorState(partialState)   → void, merges partial state into editor vars
 *   pushUndo()                       → void
 *   syncUiToState()                  → void
 *   renderAll()                      → void
 *   showToast(msg, type, duration)   → void
 *   playSound(name)                  → void
 */
export function initAirbotPanel({
  getPalette,
  toHex,
  getEditorState,
  applyEditorState,
  pushUndo,
  syncUiToState,
  renderAll,
  showToast,
  playSound,
}) {

  // status helpers ──────────────────────────────────────────────────

  function setAiStatus(state, text) {
    document.getElementById('ai-dot').className = 'al-status-dot' + (state ? ' ' + state : '');
    document.getElementById('ai-status-text').textContent = text;
  }

  function setAiControlsEnabled(on) {
    ['ai-gen-btn','ai-prompt','ai-count','ai-stops','ai-length'].forEach(id => {
      const el = document.getElementById(id); if (el) el.disabled = !on;
    });
  }

  // model lifecycle ─────────────────────────────────────────────────

  async function loadAiModel() {
    if (aiLoading || aiEngine) return;
    aiLoading = true;
    document.getElementById('ai-load-btn').disabled = true;
    document.getElementById('ai-progress-wrap').style.display = 'block';
    setAiStatus('busy', 'Loading model…');
    showToast('Loading Qwen 3 8B. First load will take some time.', 'info', 8000);
    try {
      const webllm = await import('https://esm.run/@mlc-ai/web-llm');
      aiEngine = await webllm.CreateMLCEngine(AI_MODEL, {
        initProgressCallback: (report) => {
          const pct = Math.round((report.progress || 0) * 100);
          document.getElementById('ai-progress-bar').style.width = pct + '%';
          document.getElementById('ai-progress-pct').textContent = pct + '%';
          setAiStatus('busy', report.text || 'Loading…');
          if (pct === 0) playSound('aiDownloading');
        }
      });
      document.getElementById('ai-progress-wrap').style.display = 'none';
      setAiStatus('ok', 'Qwen 3 8B ready');
      setAiControlsEnabled(true);
      document.getElementById('ai-load-btn').textContent = 'Model loaded';
      document.getElementById('ai-load-btn').disabled    = true;
      document.getElementById('ai-unload-btn').style.display = 'inline-flex';
      document.getElementById('ai-delete-btn').style.display = 'inline-flex';
      showToast('AI model loaded', 'success');
      playSound('aiLoadSuccess');
    } catch (err) {
      setAiStatus('error', 'Failed: ' + err.message);
      document.getElementById('ai-load-btn').disabled    = false;
      document.getElementById('ai-load-btn').textContent = 'Retry';
      document.getElementById('ai-progress-wrap').style.display = 'none';
      showToast('Model load failed: WebGPU required', 'error', 5000);
      aiEngine = null;
    }
    aiLoading = false;
  }

  async function unloadModel() {
    if (!aiEngine) return;
    const btn = document.getElementById('ai-unload-btn');
    btn.disabled = true; btn.textContent = 'Unloading…';
    try {
      await aiEngine.unload();
      aiEngine = null;
      setAiControlsEnabled(false);
      setAiStatus('', 'Unloaded · cache intact · click Load to reload instantly');
      document.getElementById('ai-load-btn').disabled    = false;
      document.getElementById('ai-load-btn').textContent = 'Load model';
      btn.style.display = 'none';
      document.getElementById('ai-delete-btn').style.display = 'none';
      showToast('Model unloaded from memory', 'info');
    } catch (err) {
      showToast('Unload failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Unload';
    }
  }

  async function deleteModelCache() {
    const btn = document.getElementById('ai-delete-btn');
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k.toLowerCase().includes('webllm') || k.toLowerCase().includes('mlc'))
            .map(k => caches.delete(k))
      );
      const dbs = await indexedDB.databases?.() ?? [];
      await Promise.all(
        dbs.filter(db => db.name && (db.name.toLowerCase().includes('webllm') || db.name.toLowerCase().includes('mlc')))
           .map(db => new Promise((res, rej) => {
             const r = indexedDB.deleteDatabase(db.name);
             r.onsuccess = res; r.onerror = rej;
           }))
      );
      aiEngine = null;
      setAiControlsEnabled(false);
      setAiStatus('', 'Cache deleted · click Load model to re-download');
      document.getElementById('ai-load-btn').disabled    = false;
      document.getElementById('ai-load-btn').textContent = 'Load model';
      btn.style.display = 'none';
      document.getElementById('ai-unload-btn').style.display = 'none';
      showToast('Model cache deleted', 'success');
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Delete cache';
    }
  }

  // generative gradient ─────────────────────────────────────────────

  function renderAiResultCard(result, idx, container) {
    const palette = getPalette();
    const card = document.createElement('div');
    card.className = 'al-ai-card';

    const bar = document.createElement('div'); bar.className = 'al-ai-bar';
    result.velocities.forEach(({ velocity }) => {
      const c = palette[velocity] || palette[0];
      const seg = document.createElement('div'); seg.style.background = toHex(c.r, c.g, c.b);
      bar.appendChild(seg);
    });

    const name = document.createElement('div'); name.className = 'al-ai-name'; name.textContent = result.name;
    const desc = document.createElement('div'); desc.className = 'al-ai-desc'; desc.textContent = result.description;
    const btns = document.createElement('div'); btns.className = 'al-ai-btns';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'al-btn'; loadBtn.textContent = 'Load into editor';
    loadBtn.addEventListener('click', () => {
      loadAiResultIntoEditor(result);
      showToast(`"${result.name}" loaded`, 'success');
    });

    const dlBtn = document.createElement('button');
    dlBtn.className = 'al-btn al-btn-green'; dlBtn.textContent = '⬇ Download';
    dlBtn.addEventListener('click', () => {
      const { text, filename } = downloadSingleAiGradient(result, result.name);
      downloadText(text, filename);
      showToast(`Exporting "${result.name}"…`, 'info');
      playSound('exportSuccess');
    });

    btns.appendChild(loadBtn); btns.appendChild(dlBtn);
    card.appendChild(bar); card.appendChild(name); card.appendChild(desc); card.appendChild(btns);
    container.appendChild(card);
  }

  function loadAiResultIntoEditor(result) {
    const palette = getPalette();
    const { hslDir } = getEditorState();
    pushUndo();
    const newStops = result._agentStops
      ? JSON.parse(JSON.stringify(result._agentStops))
      : result.stops.map((s, i) => ({
          id: i, pos: s.pos,
          ci: colorToNearestPalette(s.r, s.g, s.b, palette),
        }));
    applyEditorState({
      stops:     newStops,
      algorithm: result.algorithm || 'rgb',
      easing:    result.easing    || 'linear',
      hslDir:    result.hslDir    || hslDir,
      tint:      result.tint ? { ...result.tint } : undefined,
      selStop:   newStops[0].id,
      nextId:    Math.max(...newStops.map(s => s.id)) + 1,
    });
    syncUiToState();
    renderAll();
  }

  async function generateGradient(prompt, count = 1) {
    if (!aiEngine) { showToast('Load the model first', 'warning'); return; }
    const palette = getPalette();
    const { tint, envelope, antiRepeat, hueShift, hslDir } = getEditorState();

    const genBtn    = document.getElementById('ai-gen-btn');
    const abortBtn  = document.getElementById('ai-abort-btn');
    const streamWrap = document.getElementById('ai-stream-wrap');
    const streamTxt = document.getElementById('ai-stream-text');
    const streamCt  = document.getElementById('ai-stream-count');
    const tpsEl     = document.getElementById('ai-tps');
    const tokenEl   = document.getElementById('ai-token-count');
    const resList   = document.getElementById('ai-results-list');
    const resDiv    = document.getElementById('ai-results');

    aiAborted = false; aiResults = [];
    resList.innerHTML = '';
    resDiv.style.display = 'block';
    genBtn.disabled = true; genBtn.textContent = 'Generating…';
    abortBtn.style.display = 'inline-flex';
    streamWrap.style.display = 'block'; streamTxt.textContent = '';
    document.getElementById('ai-bulk-btn').style.display = 'none';
    showToast('Generating gradient…', 'info', 2000);
    playSound('aiGenerating');

    const stopsOverride  = document.getElementById('ai-stops').value.trim();
    const lengthOverride = document.getElementById('ai-length').value.trim();

    for (let i = 0; i < count; i++) {
      if (aiAborted) { showToast('Generation stopped', 'warning'); break; }
      streamCt.textContent = count > 1 ? `(${i+1} of ${count})` : '';
      streamTxt.textContent = ''; tpsEl.textContent = '—'; tokenEl.textContent = '';

      const constraints = [];
      if (stopsOverride)  constraints.push(`Use exactly ${stopsOverride} colour stops.`);
      if (lengthOverride) constraints.push(`Set length to exactly ${lengthOverride}.`);
      const userPrompt = [
        ...constraints,
        count > 1 ? `${prompt} (variation ${i+1}, make it distinct)` : prompt
      ].join(' ');

      let accumulated = '', tokensSeen = 0, genStart = 0;
      try {
        const stream = await aiEngine.chat.completions.create({
          messages: [{ role: 'system', content: AI_SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
          temperature: Math.min(1.0, 0.4 + i * 0.05),
          max_tokens:  600,
          stream:      true,
        });

        for await (const chunk of stream) {
          if (aiAborted) {
            if (typeof aiEngine.interruptGenerate === 'function') aiEngine.interruptGenerate();
            break;
          }
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            accumulated += delta; tokensSeen++;
            if (tokensSeen === 1) genStart = performance.now();
            if (tokensSeen % 5 === 0) {
              const elapsed = (performance.now() - genStart) / 1000;
              tpsEl.textContent  = elapsed > 0 ? (tokensSeen / elapsed).toFixed(1) : '—';
              tokenEl.textContent = `${tokensSeen} tok`;
            }
            streamTxt.textContent = accumulated;
            streamTxt.scrollTop   = streamTxt.scrollHeight;
          }
        }
        if (aiAborted) break;

        if (tokensSeen > 0) {
          const e = (performance.now() - genStart) / 1000;
          tpsEl.textContent  = e > 0 ? (tokensSeen / e).toFixed(1) : '—';
          tokenEl.textContent = `${tokensSeen} tok`;
        }

        let cleaned = accumulated
          .replace(/<think>[\s\S]*?<\/think>/i, '')
          .replace(/<think>[\s\S]*/i, '')
          .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
          .replace(/^[^{]*/, '').replace(/}[^}]*$/, '}')
          .trim();
        cleaned = cleaned
          .replace(/"([rgb])"\s*:\s*(?:<[^>]*>|[a-zA-Z_][a-zA-Z0-9_]*)/g, '"$1":0')
          .replace(/<[^>]*>/g, '0');

        let data;
        try { data = JSON.parse(cleaned); }
        catch (_) {
          const sm = cleaned.match(/"stops"\s*:\s*(\[[\s\S]*?\])/);
          if (sm) {
            data = { name: `Gradient ${i+1}`, description: '', stops: JSON.parse(sm[1]), algorithm: 'rgb', easing: 'linear' };
          } else throw new Error('Model output not parseable');
        }

        if (!data.stops || data.stops.length < 2) throw new Error('Fewer than 2 stops');
        data.stops = data.stops.map(s => ({
          pos: Math.max(0, Math.min(1, parseFloat(s.pos) || 0)),
          r:   Math.max(0, Math.min(255, Math.round(parseFloat(s.r) || 0))),
          g:   Math.max(0, Math.min(255, Math.round(parseFloat(s.g) || 0))),
          b:   Math.max(0, Math.min(255, Math.round(parseFloat(s.b) || 0))),
        }));
        data.stops.sort((a, b) => a.pos - b.pos);
        data.stops[0].pos = 0; data.stops[data.stops.length-1].pos = 1;
        if (!['rgb','lab','hsl','vivid','stepped'].includes(data.algorithm)) data.algorithm = 'rgb';
        if (!VALID_EASINGS.includes(data.easing)) data.easing = 'linear';

        const gradLen  = lengthOverride ? parseInt(lengthOverride) : Math.max(2, Math.min(16, parseInt(data.length) || 16));
        const aiStops  = data.stops.map((s, idx) => ({
          id: idx, pos: s.pos, ci: colorToNearestPalette(s.r, s.g, s.b, palette),
        }));
        const vels = buildGradient(
          aiStops, palette, data.algorithm || 'rgb', data.easing || 'linear',
          gradLen, tint, envelope, antiRepeat, hueShift, hslDir
        );

        const result = {
          name: data.name || `Gradient ${i+1}`,
          description: data.description || '',
          stops: data.stops,
          algorithm: data.algorithm,
          easing: data.easing,
          velocities: vels,
        };
        aiResults.push(result);
        renderAiResultCard(result, aiResults.length - 1, resList);
        if (count > 1) showToast(`Gradient ${i+1} of ${count} done`, 'success', 1500);

      } catch (err) {
        if (!aiAborted) {
          console.warn('AI error:', err);
          showToast(`Generation ${i+1} failed: ${err.message}`, 'error', 4000);
          streamTxt.textContent += `\n\n⚠ Parse error: ${err.message}`;
          playSound('aiGenerateFail');
        }
      }
    }

    genBtn.disabled = false; genBtn.textContent = 'Generate';
    abortBtn.style.display = 'none';
    setTimeout(() => { if (!aiAborted) streamWrap.style.display = 'none'; }, 3000);

    if (aiResults.length > 0 && !aiAborted) {
      showToast(`Generated ${aiResults.length} gradient${aiResults.length > 1 ? 's' : ''}`, 'success');
      playSound('aiGenerateSuccess');
      const bulkBtn = document.getElementById('ai-bulk-btn');
      bulkBtn.style.display = aiResults.length > 1 ? 'inline-flex' : 'none';
      bulkBtn.disabled = false;
    }
  }

  async function bulkExportAi() {
    if (!aiResults.length) return;
    showToast(`Exporting ${aiResults.length} gradients…`, 'info');
    const zip = new JSZip();
    aiResults.forEach(r => {
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

  // agentic action executor ─────────────────────────────────────────

  function applyAgentActions(actions) {
    const palette = getPalette();
    const state   = getEditorState();
    let newStops     = JSON.parse(JSON.stringify(state.stops));
    let newAlgorithm = state.algorithm;
    let newEasing    = state.easing;
    let newHslDir    = state.hslDir;
    let newSteps     = state.steps;
    let newTint      = { ...state.tint };
    let newId        = state.nextId;

    for (const act of actions) {
      try {
        if (act.action === 'setStops') {
          if (!Array.isArray(act.stops) || act.stops.length < 2) continue;
          newStops = act.stops.map(s => ({
            id:  newId++,
            pos: Math.max(0, Math.min(1, parseFloat(s.pos) || 0)),
            ci:  Math.max(0, Math.min(palette.length-1, Math.round(s.paletteIdx) || 0)),
          }));
          newStops.sort((a, b) => a.pos - b.pos);
          newStops[0].pos = 0;
          newStops[newStops.length-1].pos = 1;
        }
        else if (act.action === 'setAlgorithm') {
          if (['rgb','lab','hsl','vivid','stepped'].includes(act.value)) newAlgorithm = act.value;
        }
        else if (act.action === 'setEasing') {
          if (VALID_EASINGS.includes(act.value)) newEasing = act.value;
        }
        else if (act.action === 'setHslDir') {
          if (['shortest','longest'].includes(act.value)) newHslDir = act.value;
        }
        else if (act.action === 'setSteps') {
          newSteps = Math.max(2, Math.min(16, Math.round(act.value) || 16));
        }
        else if (act.action === 'setTint') {
    const idx = Math.max(0, Math.min(palette.length - 1, Math.round(act.paletteIdx) || 0));
    if (idx === 0) {
        // palette index 0 is invalid — treat as clearTint
        newTint = { ci: null, str: 0 };
    } else {
        newTint = {
            ci:  idx,
            str: Math.max(0, Math.min(100, Math.round(act.strength) || 0)),
        };
    }
}
        else if (act.action === 'clearTint') {
          newTint = { ci: null, str: 0 };
        }
      } catch (e) { console.warn('Agent action failed:', act, e); }
    }

    return {
      stops:     newStops,
      algorithm: newAlgorithm,
      easing:    newEasing,
      hslDir:    newHslDir,
      steps:     newSteps,
      tint:      newTint,
      nextId:    newId,
    };
  }

  // generative AI event listeners ───────────────────────────────────

  document.getElementById('ai-load-btn').addEventListener('click', loadAiModel);
  document.getElementById('ai-unload-btn').addEventListener('click', unloadModel);
  document.getElementById('ai-delete-btn').addEventListener('click', deleteModelCache);

  document.getElementById('ai-gen-btn').addEventListener('click', () => {
    const prompt = document.getElementById('ai-prompt').value.trim();
    const count  = parseInt(document.getElementById('ai-count').value) || 1;
    if (!prompt) { showToast('Enter a theme first', 'warning'); return; }
    generateGradient(prompt, count);
  });

  document.getElementById('ai-abort-btn').addEventListener('click', () => {
    aiAborted = true;
    if (aiEngine && typeof aiEngine.interruptGenerate === 'function') aiEngine.interruptGenerate();
    document.getElementById('ai-abort-btn').style.display = 'none';
    document.getElementById('ai-gen-btn').disabled    = false;
    document.getElementById('ai-gen-btn').textContent = 'Generate';
  });

  document.getElementById('ai-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('ai-gen-btn').click();
  });

  document.getElementById('ai-bulk-btn').addEventListener('click', bulkExportAi);

  document.getElementById('ai-clear-results-btn').addEventListener('click', () => {
    aiResults = [];
    document.getElementById('ai-results-list').innerHTML = '';
    document.getElementById('ai-results').style.display  = 'none';
    document.getElementById('ai-bulk-btn').style.display = 'none';
    document.getElementById('ai-stream-wrap').style.display = 'none';
    document.getElementById('ai-tps').textContent          = '—';
    document.getElementById('ai-token-count').textContent  = '';
    showToast('Results cleared', 'info', 1500);
  });

  document.getElementById('ai-vram-reset-btn').addEventListener('click', async () => {
    await settingsStore.delete('aerolux_vram');
    document.getElementById('ai-vram-reset-btn').style.display = 'none';
    document.getElementById('ai-compat-box').style.display     = 'none';
    showToast('VRAM cleared. Run compatibility check again to re-enter', 'info', 3000);
  });

  // generative placeholder rotation
(function startPlaceholders() {
    if (phTimer) clearInterval(phTimer);
    const input = document.getElementById('ai-prompt');
    input.placeholder = PLACEHOLDER_EXAMPLES[0];
    phTimer = setInterval(() => {
        if (document.activeElement === input) return;
        input.placeholder = '';
        setTimeout(() => {
            phIdx = (phIdx + 1) % PLACEHOLDER_EXAMPLES.length;
            input.placeholder = PLACEHOLDER_EXAMPLES[phIdx];
        }, 300);
    }, 4000);
})();

  // agentic AI event listeners ──────────────────────────────────────

  document.getElementById('auto-ai-prompt-input').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const btn = document.getElementById('auto-ai-run-btn');
    if (!btn.disabled) btn.click();
  });

  document.getElementById('auto-ai-multi').addEventListener('change', e => {
    document.getElementById('auto-ai-batch-count').style.display =
      e.target.checked ? 'inline-block' : 'none';
  });

  document.getElementById('auto-ai-run-btn').addEventListener('click', async () => {
    if (!aiEngine) { showToast('Load the AI model first', 'warning'); return; }
    const prompt  = document.getElementById('auto-ai-prompt-input').value.trim();
    const isBatch = document.getElementById('auto-ai-multi').checked;
    const batchN  = parseInt(document.getElementById('auto-ai-batch-count').value) || 5;
    if (!prompt) { showToast('Describe what you want', 'warning'); return; }

    const palette   = getPalette();
    const state     = getEditorState();

    const btn       = document.getElementById('auto-ai-run-btn');
    const stopBtn   = document.getElementById('auto-ai-abort-btn');
    const status    = document.getElementById('auto-ai-status');
    const streamWrap = document.getElementById('auto-ai-stream-wrap');
    const streamEl  = document.getElementById('auto-ai-stream');
    const tpsEl     = document.getElementById('auto-ai-tps');
    const tokEl     = document.getElementById('auto-ai-tokens');

    let abortAuto = false;
    btn.disabled = true; btn.textContent = 'Running…';
    stopBtn.style.display = 'inline-flex';
    streamWrap.style.display = 'block'; streamEl.textContent = '';
    tpsEl.textContent = '—'; tokEl.textContent = '';

    stopBtn.onclick = () => {
      abortAuto = true;
      if (aiEngine && typeof aiEngine.interruptGenerate === 'function') aiEngine.interruptGenerate();
      stopBtn.style.display = 'none';
      btn.disabled = false; btn.textContent = 'Run with AI';
      showToast('Stopped', 'warning', 1500);
    };

    const currentState = {
      steps: state.steps, algorithm: state.algorithm,
      easing: state.easing, hslDir: state.hslDir,
      stops: [...state.stops].sort((a,b) => a.pos-b.pos).map(s => {
        const c = palette[s.ci] || palette[0];
        return { pos: Math.round(s.pos*100)/100, paletteIdx: s.ci, hex: toHex(c.r,c.g,c.b) };
      }),
      paletteSize: palette.length,
      tint: state.tint.ci !== null ? { paletteIdx: state.tint.ci, strength: state.tint.str } : null,
    };

    const agentSys = `/nothink
you are an agentic gradient editor. output ONLY: {"actions":[...],"explanation":"string"}
actions available:
  - {"action":"setStops","stops":[{"pos":0.0,"paletteIdx":0},...]}  2–16 stops, pos 0.0–1.0, must include 0.0 and 1.0
  - {"action":"setAlgorithm","value":"rgb|lab|hsl|vivid|stepped"}
  - {"action":"setHslDir","value":"shortest|longest"}
  - {"action":"setEasing","value":"linear|easeIn|easeOut|sCurve|cubicIn|cubicOut|sineIn|sineOut|sineBoth|expoIn|expoOut|bounce|elastic"}
  - {"action":"setSteps","value":2-16}
  - {"action":"setTint","paletteIdx":0,"strength":50}
  - {"action":"clearTint"}
palette: ${palette.length} entries (index 0–${palette.length-1}).
palette information:
  - index 0 is invalid.
  - index 1 to 7 is a fade of white, index 1 brightest, index 7 black.
  - index 8-11 deep red, 12-15 orange, 16-19 yellow — pattern continues to index 64-67 (rose).
  - index 68+ are pastel variants of the same pattern.
current state: ${JSON.stringify(currentState)}`;

    const batchSys = `/nothink
you are an agentic gradient editor. Generate ${batchN} distinct variations.
output ONLY: {"variations":[{"name":"string","actions":[...]}],"explanation":"string"}
same action types as: setStops (2–16 stops, pos 0–1, paletteIdx 0–${palette.length-1}),
setAlgorithm (rgb|lab|hsl|vivid|stepped), setHslDir (shortest|longest),
setEasing (linear|easeIn|easeOut|sCurve|cubicIn|cubicOut|sineIn|sineOut|sineBoth|expoIn|expoOut|bounce|elastic), setSteps (2–16),
setTint (paletteIdx, strength 0–100), clearTint.
palette information:
  - index 0 invalid. 1–7 white→black. 8–67 deep colours in groups of 4. 68+ pastels.
current state: ${JSON.stringify(currentState)}`;

    let accumulated = '', tokensSeen = 0, genStart = 0;
    status.textContent = isBatch ? `Generating ${batchN} variations…` : 'Thinking…';

    try {
      const stream = await aiEngine.chat.completions.create({
        messages: [
          { role: 'system', content: isBatch ? batchSys : agentSys },
          { role: 'user',   content: prompt },
        ],
        temperature: 0.5,
        max_tokens:  600,
        stream:      true,
      });

      for await (const chunk of stream) {
        if (abortAuto) break;
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          accumulated += delta; tokensSeen++;
          if (tokensSeen === 1) genStart = performance.now();
          if (tokensSeen % 5 === 0) {
            const el = (performance.now() - genStart) / 1000;
            tpsEl.textContent = el > 0 ? (tokensSeen / el).toFixed(1) : '—';
            tokEl.textContent = `${tokensSeen} tok`;
          }
          streamEl.textContent = accumulated;
          streamEl.scrollTop   = streamEl.scrollHeight;
        }
      }

      if (abortAuto) throw new Error('aborted');

      if (tokensSeen > 0) {
        const e = (performance.now() - genStart) / 1000;
        tpsEl.textContent = e > 0 ? (tokensSeen / e).toFixed(1) : '—';
        tokEl.textContent = `${tokensSeen} tok`;
      }

      let raw = accumulated
        .replace(/<think>[\s\S]*?<\/think>/i, '')
        .replace(/^[^{]*/, '').replace(/}[^}]*$/, '}').trim();
      const data = JSON.parse(raw);

      if (isBatch) {
        if (!data.variations || !Array.isArray(data.variations))
          throw new Error('No variations in response');

        const previewDiv = document.getElementById('auto-ai-preview');
        previewDiv.style.display = 'block';
        previewDiv.innerHTML = '<p class="al-label" style="margin-bottom:6px">Generated variations</p>';
        aiResults = [];
        document.getElementById('ai-results-list').innerHTML = '';
        document.getElementById('ai-results').style.display  = 'block';

        for (const variation of data.variations) {
          const tempState = applyAgentActions(variation.actions);
          if (!tempState) continue;
          const freshState = getEditorState();
          const result = buildGradient(
            tempState.stops, palette, tempState.algorithm, tempState.easing,
            tempState.steps, tempState.tint, freshState.envelope,
            freshState.antiRepeat, freshState.hueShift, tempState.hslDir
          );
          aiResults.push({
            name:        variation.name || 'Variation',
            description: `${tempState.algorithm} · ${tempState.easing} · ${tempState.steps} steps`,
            velocities:  result,
            _agentStops: tempState.stops,
            algorithm:   tempState.algorithm,
            easing:      tempState.easing,
            hslDir:      tempState.hslDir,
            tint:        tempState.tint,
          });
          renderAiResultCard(aiResults[aiResults.length-1], aiResults.length-1,
            document.getElementById('ai-results-list'));
        }

        if (aiResults.length > 1) {
          document.getElementById('ai-bulk-btn').style.display = 'inline-flex';
          document.getElementById('ai-bulk-btn').disabled = false;
        }
        status.textContent = `${aiResults.length} variation(s) ready. ${data.explanation || ''}`;
        showToast(`Batch done. ${aiResults.length} variations`, 'success');

      } else {
        if (!data.actions || !Array.isArray(data.actions))
          throw new Error('No actions in response');
        pushUndo();
        const applied = applyAgentActions(data.actions);
        if (applied) {
          applyEditorState({
            stops:     applied.stops,
            algorithm: applied.algorithm,
            easing:    applied.easing,
            steps:     applied.steps,
            hslDir:    applied.hslDir,
            tint:      applied.tint,
            selStop:   applied.stops[0].id,
            nextId:    applied.nextId,
          });
          syncUiToState();
          renderAll();
        }
        status.textContent = data.explanation || 'Done';
        showToast('Gradient updated by AI', 'success');
        playSound('aiGenerateSuccess');
      }

    } catch (err) {
      if (err.message !== 'aborted') {
        status.textContent = 'Failed: ' + err.message;
        showToast('AI agent error: ' + err.message, 'error', 5000);
        console.error(err);
      }
    }

    btn.disabled = false; btn.textContent = 'Run with AI';
    stopBtn.style.display = 'none';
    setTimeout(() => { streamWrap.style.display = 'none'; }, 4000);
  });

  // agentic placeholder rotation
(function startAgentPlaceholders() {
    if (agentPhTimer) clearInterval(agentPhTimer);
    const input = document.getElementById('auto-ai-prompt-input');
    if (!input) return;
    input.placeholder = AGENT_PLACEHOLDER_EXAMPLES[0];
    agentPhTimer = setInterval(() => {
        if (document.activeElement === input) return;
        input.placeholder = '';
        setTimeout(() => {
            agentPhIdx = (agentPhIdx + 1) % AGENT_PLACEHOLDER_EXAMPLES.length;
            input.placeholder = AGENT_PLACEHOLDER_EXAMPLES[agentPhIdx];
        }, 300);
    }, 4000);
})();

  // public API ──────────────────────────────────────────────────────

  return {
    isModelLoaded: () => aiEngine !== null,
    destroy() {
      clearInterval(phTimer);
      clearInterval(agentPhTimer);
      phTimer = null;
      agentPhTimer = null;
    },
  };
}