// src/lib/aerolux/midi-panel.js
// WebMIDI device connection, SysEx gradient sending, lightshow
// injection, and live Launchpad animation
// call initMidiPanel(callbacks) once at app startup
// returns sendGradientMidi() and onGradientChanged()

// this file currently uses the old implementation from midi.js
// it will soon be rewritten to use the new implementation from midi-layout.js

import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  parseMidiFile,
  detectGradient,
  injectGradient,
  buildAnimFrame,
  playLightshow,
  NOTE_TO_CELL,
  CELL_TO_NOTE,
  noteName,
  CONNECT_LIGHTSHOW,
} from './midi.js';

// module state ──────────────────────────────────────────────────────

let midiEnabled       = false;
let midiOutput        = null;

let loadedMidiBytes   = null;
let parsedMidiData    = null;
let detectedGradVels  = [];
let injectedMidiBytes = null;

let lpLiveTimer       = null;
let lpAnimFrame       = 0;
let lpAnimSpeed       = 200;

let lpSpeedMode   = 'ms';   // 'ms' | 'bpm'
let lpBpm         = 120;
let lpSubdivision = 1;      // beats: 4=bar, 2=half, 1=quarter, 0.5=eighth
let lpTapTimes    = [];     // last 4 tap timestamps

// init ──────────────────────────────────────────────────────────────

/**
 * initialise the MIDI panel. call once after the DOM is ready
 *
 * callbacks:
 *   getGradResult()  → gradResult array from the editor
 *   getPalette()     → palette array from the editor
 *   toHex(r,g,b)     → hex string, from palette.js
 *   showToast(msg, type, duration)
 *   playSound(name)
 */
export function initMidiPanel({
  getGradResult,
  getPalette,
  toHex,
  showToast,
  playSound,
}) {

  // SysEx helpers ───────────────────────────────────────────────────

  function buildSysexData() {
    const gradResult = getGradResult();
    const palette    = getPalette();
    const ledMap = new Map();
    for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) ledMap.set(r*10+c, [0,0,0]);
    gradResult.forEach(({step, velocity}) => {
      const c    = palette[velocity] || palette[0];
      const note = step < 8 ? 51+step : (step < 16 ? 41+(step-8) : -1);
      if (note >= 0) ledMap.set(note, [c.r, c.g, c.b]);
    });
    const pd = [];
    ledMap.forEach(([r,g,b], note) => pd.push(note, r, g, b));
    return [0xF0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0B, ...pd, 0xF7];
  }

  function setMidiStatus(state, text) {
    const dot = document.getElementById('midi-dot');
    const txt = document.getElementById('midi-status-text');
    dot.className = 'al-status-dot' + (state ? ' ' + state : '');
    txt.textContent = text;
  }

  function updateMidiButtons() {
    const ok = midiEnabled && midiOutput !== null;
    ['midi-prog-btn', 'midi-send-btn', 'midi-clear-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !ok;
    });
    const liveBtn = document.getElementById('lp-live-play-btn');
    if (liveBtn) liveBtn.disabled = !ok;
  }

  function updateMidiDeviceSelect() {
    const sel = document.getElementById('midi-device-select');
    sel.innerHTML = '';
    if (!midiEnabled || typeof WebMidi === 'undefined' || WebMidi.outputs.length === 0) {
      sel.innerHTML = '<option value="">no devices available</option>';
      sel.disabled = true; midiOutput = null; updateMidiButtons(); return;
    }
    WebMidi.outputs.forEach(out => {
      const opt = document.createElement('option');
      opt.value = out.id; opt.textContent = out.name;
      if (out.name.toLowerCase().includes('launchpad')) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.disabled = false;
    midiOutput = WebMidi.getOutputById(sel.value) || WebMidi.outputs[0] || null;
    updateMidiButtons();
  }

  function sendGradientMidi() {
    if (!midiEnabled || typeof WebMidi === 'undefined') return;
    const sel = document.getElementById('midi-device-select');
    const out = WebMidi.getOutputById(sel?.value);
    if (!out || !getGradResult().length) return;
    try { out.send(buildSysexData()); } catch (e) { console.warn('MIDI send error:', e); }
  }

  // event listeners ─────────────────────────────────────────────────

  document.getElementById('midi-connect-btn').addEventListener('click', () => {
    if (typeof WebMidi === 'undefined') {
      setMidiStatus('error', 'WebMIDI.js not loaded'); return;
    }
    if (midiEnabled) { updateMidiDeviceSelect(); return; }
    setMidiStatus('busy', 'Requesting MIDI access…');
    WebMidi.enable({ sysex: true }).then(() => {
      midiEnabled = true;
      document.getElementById('midi-connect-btn').textContent = 'Refresh';
      setMidiStatus('ok', `MIDI enabled, ${WebMidi.outputs.length} output(s)`);
      updateMidiDeviceSelect();
      WebMidi.addListener('connected', updateMidiDeviceSelect);
      WebMidi.addListener('disconnected', updateMidiDeviceSelect);
      playSound('midiSuccess');
      showToast('MIDI connected', 'success');
      setTimeout(() => { if (midiOutput) playLightshow(midiOutput, CONNECT_LIGHTSHOW); }, 200);
    }).catch(err => {
      setMidiStatus('error', `Access denied: ${err.message}`);
      playSound('midiFail');
      showToast('MIDI access denied', 'error');
    });
  });

  document.getElementById('midi-device-select').addEventListener('change', e => {
    midiOutput = (midiEnabled && typeof WebMidi !== 'undefined')
      ? WebMidi.getOutputById(e.target.value) || null : null;
    updateMidiButtons();
  });

  document.getElementById('midi-send-btn').addEventListener('click', () => {
    sendGradientMidi();
    showToast('Gradient sent to Launchpad', 'success', 1500);
  });

  document.getElementById('midi-clear-btn').addEventListener('click', () => {
    const sel = document.getElementById('midi-device-select');
    const out = midiEnabled && typeof WebMidi !== 'undefined'
      ? WebMidi.getOutputById(sel?.value) : null;
    if (!out) return;
    const pd = [];
    for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) pd.push(r*10+c, 0, 0, 0);
    out.send([0xF0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0B, ...pd, 0xF7]);
    showToast('Pads cleared', 'info', 1500);
  });

  // lightshow injection ─────────────────────────────────────────────

  // airborne's planning
  // file format: standard midi note on, velocity corresponds to palette colour index
  // layout: ableton live note mode where base note 36 (c2 must be offset to c1, so there is a row offset of 8 semitones)

  // different notes are at different gradient stages simultaneously, as in multiple velocities appear in the same tick as notes enter/exit the animation at staggered times

  // to tackle this, the new gradient must be injected using the first note on velocity of the original gradient. not the best idea due to pinch in certain animations which would cause the note lengths of the first note on's to be different, but it can be normalised
  //

  function renderDetectedGradBar(gradVels) {
    const palette = getPalette();
    const bar  = document.getElementById('midi-grad-bar');
    const info = document.getElementById('midi-grad-info');
    bar.innerHTML = '';
    gradVels.forEach(vel => {
      const c   = palette[vel] || palette[0];
      const seg = document.createElement('div');
      seg.style.cssText = `flex:1;background:${toHex(c.r, c.g, c.b)}`;
      seg.title = `Palette #${vel} — ${toHex(c.r, c.g, c.b)}`;
      bar.appendChild(seg);
    });
    info.textContent = `${gradVels.length} gradient steps: velocities [${gradVels.join(', ')}]`;
  }

  function renderMidiPadPreview(noteOns) {
    const palette = getPalette();
    const grid    = document.getElementById('midi-pad-grid');
    grid.innerHTML = '';
    const noteColor = {};
    for (const ev of noteOns) noteColor[ev.noteNum] = ev.velocity;

    for (let displayRow = 7; displayRow >= 0; displayRow--) {
      for (let col = 0; col < 8; col++) {
        const midi = CELL_TO_NOTE[`${displayRow}_${col}`];
        const vel  = noteColor[midi];
        const pad  = document.createElement('div');
        pad.style.cssText = [
          'aspect-ratio:1', 'border-radius:3px', 'transition:background 0.2s',
          col === 4 ? 'margin-left:1px' : '',
          `border:1px solid ${vel !== undefined ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)'}`,
        ].join(';');
        if (vel !== undefined) {
          const c = palette[vel] || palette[0];
          pad.style.background = toHex(c.r, c.g, c.b);
        } else {
          pad.style.background = '#111';
        }
        pad.title = midi !== undefined
          ? `${noteName(midi)} (MIDI ${midi})${vel !== undefined ? ` — vel/colour ${vel}` : ' — unused'}`
          : 'Out of range';
        grid.appendChild(pad);
      }
    }
  }

  document.getElementById('midi-load-btn').addEventListener('click', async () => {
    const path = await open({
        multiple: false,
        filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }],
    });
    if (!path) return;

    try {
        const bytes = await readFile(path);
        loadedMidiBytes  = bytes;
        parsedMidiData   = parseMidiFile(loadedMidiBytes);
        detectedGradVels = detectGradient(parsedMidiData.noteOns);
    } catch (err) {
        showToast('MIDI load error: ' + err.message, 'error');
    }
  });

  document.getElementById('midi-inject-btn').addEventListener('click', () => {
    if (!parsedMidiData || !detectedGradVels.length) return;
    try {
      injectedMidiBytes = injectGradient(
        loadedMidiBytes, parsedMidiData.noteOns, detectedGradVels, getGradResult()
      );
      document.getElementById('midi-export-mid-btn').disabled = false;
      const reparsed = parseMidiFile(injectedMidiBytes);
      renderMidiPadPreview(reparsed.noteOns);
      const newVels = detectGradient(reparsed.noteOns);
      renderDetectedGradBar(newVels);
      document.getElementById('midi-grad-info').textContent += ' ← injected from Aerolux';
      showToast('Gradient injected; preview updated', 'success');
      sendGradientMidi();
    } catch (err) {
      showToast('Inject failed: ' + err.message, 'error');
      console.error(err);
    }
  });

  document.getElementById('midi-export-mid-btn').addEventListener('click', async () => {
    if (!injectedMidiBytes) return;

    const defaultName = `Aerolux ${getGradResult().map(g => g.velocity).join(' ')}.mid`;
    const path = await save({
        defaultPath: defaultName,
        filters: [{ name: 'MIDI', extensions: ['mid'] }],
    });
    if (!path) return;

    await writeFile(path, injectedMidiBytes);
    showToast('MIDI exported', 'success');
    playSound('exportSuccess');
  });

  document.getElementById('midi-clear-mid-btn').addEventListener('click', () => {
    loadedMidiBytes = null; parsedMidiData = null;
    detectedGradVels = []; injectedMidiBytes = null;
    document.getElementById('midi-file-status').textContent     = 'No file loaded';
    document.getElementById('midi-inject-btn').disabled         = true;
    document.getElementById('midi-export-mid-btn').disabled     = true;
    document.getElementById('midi-clear-mid-btn').style.display = 'none';
    document.getElementById('midi-grad-preview').style.display  = 'none';
    document.getElementById('midi-pad-preview').style.display   = 'none';
    showToast('File cleared', 'info', 1500);
  });

  // live animation ──────────────────────────────────────────────────

  // basically plays the new gradient from aerolux dynamically instead of having it be static or fixed

  // trail model: at any frame F, pad at position P shows gradient step
  // (P + F) % gradLength | -> creating a moving wave across all 64 pads


  function _bpmToMs() {
    return Math.round((60000 / lpBpm) * lpSubdivision);
  }

  function sendAnimFrameToLaunchpad(frameIdx) {
    const sel = document.getElementById('midi-device-select');
    const out = (midiEnabled && typeof WebMidi !== 'undefined')
      ? WebMidi.getOutputById(sel?.value) : null;
    if (!out) return;
    const leds    = buildAnimFrame(frameIdx, getGradResult(), getPalette());
    const padData = leds.flatMap(({ note, r, g, b }) => [note, r, g, b]);
    try {
      out.send([0xF0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0B, ...padData, 0xF7]);
    } catch (e) { console.warn('LP anim send error:', e); }
  }

  function startLivePlay() {
    if (lpLiveTimer) return;
    const interval = lpSpeedMode === 'bpm' ? _bpmToMs() : lpAnimSpeed;
    lpAnimFrame = 0;
    sendAnimFrameToLaunchpad(lpAnimFrame++);
    lpLiveTimer = setInterval(() => {
      sendAnimFrameToLaunchpad(lpAnimFrame++);
    }, interval);
    document.getElementById('lp-live-play-btn').style.display = 'none';
    document.getElementById('lp-live-stop-btn').style.display = 'inline-flex';
    showToast('Playing on Launchpad', 'success', 1500);
  }

  function stopLivePlay() {
    clearInterval(lpLiveTimer); lpLiveTimer = null;
    document.getElementById('lp-live-play-btn').style.display = 'inline-flex';
    document.getElementById('lp-live-stop-btn').style.display = 'none';
    sendGradientMidi();
    showToast('Playback stopped', 'info', 1500);
  }

  document.getElementById('lp-live-play-btn').addEventListener('click', startLivePlay);
  document.getElementById('lp-live-stop-btn').addEventListener('click', stopLivePlay);

  // ── speed mode tabs ───────────────────────────────────────────────
document.querySelectorAll('#lp-speed-mode-tabs .al-stab').forEach(tab => {
  tab.addEventListener('click', () => {
    lpSpeedMode = tab.dataset.speedMode;
    document.querySelectorAll('#lp-speed-mode-tabs .al-stab')
      .forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('lp-speed-manual').style.display =
      lpSpeedMode === 'ms'  ? '' : 'none';
    document.getElementById('lp-speed-bpm').style.display =
      lpSpeedMode === 'bpm' ? 'flex' : 'none';
    if (lpLiveTimer) { stopLivePlay(); startLivePlay(); }
  });
});

// manual ms slider ──────────────────────────────────────────────────
document.getElementById('lp-anim-speed').addEventListener('input', e => {
  lpAnimSpeed = parseInt(e.target.value);
  document.getElementById('lp-anim-speed-val').textContent = lpAnimSpeed + 'ms';
  if (lpLiveTimer) { stopLivePlay(); startLivePlay(); }
});

// BPM input ─────────────────────────────────────────────────────────
function _syncBpmDisplay() {
  const ms = _bpmToMs();
  document.getElementById('lp-bpm-ms-val').textContent = ms + 'ms';
}

document.getElementById('lp-bpm').addEventListener('input', e => {
  const val = parseInt(e.target.value);
  if (isNaN(val) || val < 20 || val > 300) return;
  lpBpm = val;
  _syncBpmDisplay();
  if (lpLiveTimer) { stopLivePlay(); startLivePlay(); }
});

document.getElementById('lp-subdivision').addEventListener('change', e => {
  lpSubdivision = parseFloat(e.target.value);
  _syncBpmDisplay();
  if (lpLiveTimer) { stopLivePlay(); startLivePlay(); }
});

// tap tempo ─────────────────────────────────────────────────────────
  document.getElementById('lp-tap-btn').addEventListener('click', () => {
    const now = performance.now();
    lpTapTimes.push(now);

    // keep only last 4 taps; discard sequence if gap > 3s (user paused)
    if (lpTapTimes.length > 1 &&
        now - lpTapTimes[lpTapTimes.length - 2] > 3000) {
      lpTapTimes = [now];
    }
    if (lpTapTimes.length > 4) lpTapTimes.shift();

    if (lpTapTimes.length < 2) {
      showToast('Tap again…', 'info', 800);
      return;
    }

    // average interval between taps
    let totalInterval = 0;
    for (let i = 1; i < lpTapTimes.length; i++)
      totalInterval += lpTapTimes[i] - lpTapTimes[i - 1];
    const avgInterval = totalInterval / (lpTapTimes.length - 1);
    const detectedBpm = Math.round(60000 / avgInterval);
    const clampedBpm  = Math.max(20, Math.min(300, detectedBpm));

    lpBpm = clampedBpm;
    document.getElementById('lp-bpm').value = clampedBpm;
    _syncBpmDisplay();
    if (lpLiveTimer) { stopLivePlay(); startLivePlay(); }
    showToast(`${clampedBpm} BPM`, 'info', 1200);
  });

  // public API ──────────────────────────────────────────────────────

  return {
    sendGradientMidi,
    onGradientChanged() {
      if (lpLiveTimer) {
        stopLivePlay();
        startLivePlay();
      }
    },
    isMidiEnabled: () => midiEnabled,
    getMidiOutput: () => midiOutput,
  };
}

