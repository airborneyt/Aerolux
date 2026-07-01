// src/lib/aerolux/store.js
// shared Tauri store instances for the whole app.
// import from here rather than creating new LazyStore instances elsewhere.

import { LazyStore } from '@tauri-apps/plugin-store';

// presets, deleted presets
export const presetsStore = new LazyStore('presets.json');

// app settings, including but not limited to:
// VRAM value, sort preferences, etc
export const settingsStore = new LazyStore('settings.json');