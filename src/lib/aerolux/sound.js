// src/lib/aerolux/sound.js
// sound module for aerolux
// manages ui interaction-based sound effects
// todo: major overhaul, migrate to rust?

const SOUND_FILES = {
  midiSuccess:       '/sounds/midi_success.mp3',
  midiFail:          '/sounds/midi_fail.mp3',
  aiDownloading:     '/sounds/ai_downloading.mp3',
  aiLoadSuccess:     '/sounds/ai_load_success.mp3',
  aiGenerating:      '/sounds/ai_generating.mp3',
  aiGenerateSuccess: '/sounds/ai_generate_success.mp3',
  aiGenerateFail:    '/sounds/ai_generate_fail.mp3',
  exportSuccess:     '/sounds/export_success.mp3',
  downloadSuccess:   '/sounds/download_success.mp3',
};

const SOUND_VOLUMES = {
  aiGenerating: 0.3,
};

const _cache = {};
let _ctx = null;

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

async function preload() {
  const c = getCtx();
  await Promise.all(Object.entries(SOUND_FILES).map(async ([name, url]) => {
    if (!url) return;
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      _cache[name] = await c.decodeAudioData(buf);
    } catch (e) { console.warn(`SoundSystem: could not load "${name}"`, e); }
  }));
}

export function playSound(name) {
  const buffer = _cache[name];
  if (!buffer) return;
  try {
    const c    = getCtx();
    const src  = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buffer;
    src.connect(gain);
    gain.connect(c.destination);
    gain.gain.setValueAtTime(
      SOUND_VOLUMES[name] !== undefined ? SOUND_VOLUMES[name] : 1.0,
      c.currentTime
    );
    src.start(c.currentTime);
  } catch (e) { console.warn('SoundSystem play error:', e); }
}

// call once at app startup. preloads all sounds on the user's first click
export function initSound() {
  document.addEventListener('click', preload, { once: true });
}