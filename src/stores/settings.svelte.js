// src/stores/settings.svelte.js
import { settingsStore } from "../lib/aerolux/store.js";

export const settings = $state({
  theme: {
    mode: "dark",
    accentH: null,
    transparency: true
  },
  motion: {
    tier: "motion-full"
  },
  activity: {
    enabled: true,
  },
  editor: {
    customPalette: null,
    velocitySteps: 16,
    velocityAlgorithm: 'rgb',
    velocityEasing: 'linear',
    kineticBpm: 120,
    kineticTimeDiv: 96,
    kineticDuration: 768,
    kineticDefaultOutput: true,
  },
  kinetic: {
    bpm: 120,
    duration: 768,
    timeDiv: 96,
  },
  vram: null,
  constants: {
    defaultEditor: null,
    maxRecentProjects: 200,
  },
  sound: {
    enabled: true,
    master: 1.0,
    ost: 0.5,
    sfx: 1.0,
    notifications: 1.0,
  },
  haptics: {
    enabled: true,
  },
  ost: {
    enabled: true,
    pack: "default",
  },
  paths: {
    lastProjectDir: null,
  },
  updates: { skippedVersion: null },
});

function defaultSettings() {
  return {
    theme: { mode: 'dark', accentH: null, transparency: true },
    motion: { tier: 'motion-full' },
    activity: { enabled: true },
    editor: {
      customPalette: null, velocitySteps: 16, velocityAlgorithm: 'rgb',
      velocityEasing: 'linear', kineticBpm: 120, kineticTimeDiv: 96,
      kineticDuration: 768, kineticDefaultOutput: true,
    },
    kinetic: { bpm: 120, duration: 768, timeDiv: 96 },
    vram: null,
    constants: { defaultEditor: null, maxRecentProjects: 200 },
    sound: { enabled: true, master: 1, ost: 0.5, sfx: 1, notifications: 1 },
    haptics: { enabled: true },
    ost: { enabled: true, pack: 'default' },
    paths: { lastProjectDir: null },
    updates: { skippedVersion: null },
  };
}

export async function resetSettings() {
  const defaults = defaultSettings();
  for (const key of Object.keys(defaults)) settings[key] = defaults[key];
  await Promise.all(Object.entries(defaults).map(([key, value]) => settingsStore.set(key, value)));
  await settingsStore.save?.();
  return settings;
}

export async function loadSettings() {
  // 1. manually hydrate each known top-level key
  const theme = await settingsStore.get("theme");
  const motion = await settingsStore.get("motion");
  const activity = await settingsStore.get("activity");
  const editor = await settingsStore.get("editor");
  const vram = await settingsStore.get("vram");
  const constants = await settingsStore.get("constants");
  const sound = await settingsStore.get("sound");
  const haptics = await settingsStore.get("haptics");
  const ost = await settingsStore.get("ost");
  const paths = await settingsStore.get("paths");
  const updates = await settingsStore.get("updates");

  if (theme) settings.theme = { ...settings.theme, ...theme };
  if (motion) settings.motion = { ...settings.motion, ...motion };
  if (activity) settings.activity = { ...settings.activity, ...activity };
  if (editor) settings.editor = { ...settings.editor, ...editor };
  if (vram !== null && vram !== undefined) settings.vram = vram;
  if (constants) settings.constants = { ...settings.constants, ...constants };
  if (sound) settings.sound = { ...settings.sound, ...sound };
  if (haptics) settings.haptics = { ...settings.haptics, ...haptics };
  if (ost) settings.ost = { ...settings.ost, ...ost };
  if (paths) settings.paths = { ...settings.paths, ...paths };
  if (updates) settings.updates = { ...settings.updates, ...updates };

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
