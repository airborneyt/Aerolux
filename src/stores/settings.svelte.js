// src/stores/settings.svelte.js
import { settingsStore } from "../lib/aerolux/store.js";

export const settings = $state({
  theme: {
    mode: "dark",
    accentH: null
  },
  editor: {
    customPalette: null
  },
  motion: {
    tier: "motion-full"
  },
  ai: {
    model: "Qwen3-8B-q4f16_1-MLC"
  },
  vram: null,
  constants: {
    defaultEditor: null,
    maxRecentProjects: 200,
  },
  sound: {
    master: 1.0,
    ui: 1.0,
    ost: 1.0
  },
  paths: {
    lastProjectDir: null,
  },
});

export async function loadSettings() {
  // 1. manually hydrate each known top-level key
  const theme = await settingsStore.get("theme");
  const motion = await settingsStore.get("motion");
  const editor = await settingsStore.get("editor");
  const ai = await settingsStore.get("ai");
  const vram = await settingsStore.get("vram");
  const constants = await settingsStore.get("constants");
  const sound = await settingsStore.get("sound");
  const paths = await settingsStore.get("paths");

  if (theme) settings.theme = theme;
  if (motion) settings.motion = motion;
  if (editor) settings.editor = editor;
  if (ai) settings.ai = ai;
  if (vram !== null && vram !== undefined) settings.vram = vram;
  if (constants) settings.constants = constants;
  if (sound) settings.sound = sound;
  if (paths) settings.paths = paths;

  // 2. persist changes if required by LazyStore implementation
  await settingsStore.save?.();

  return settings;
}

export async function saveSetting(path, value) {
  const parts = path.split(".");
  const root = parts[0];

  let target = settings;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!target[key] || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target = target[key];
  }

  target[parts[parts.length - 1]] = value;

  await settingsStore.set(root, settings[root]);
  await settingsStore.save?.();

  return value;
}