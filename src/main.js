import { mount } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import App from './App.svelte';
import './app.css';
import './lib/aerolux/aerolux-init.svelte.js'
import { loadSettings } from './stores/settings.svelte.js';
import { applyTheme } from './stores/theme.svelte.js';
import { applyMotion } from './stores/motion.svelte.js';
import { loadRecents } from './stores/projects.svelte.js';
import { initMenuBridge } from './lib/aerolux/menu-bridge.svelte.js';
import { initWindowTitle } from './lib/aerolux/window-title.svelte.js';
import { markSessionStart, initCrashRecovery, startAutosaveWatcher } from './lib/aerolux/crash-recovery.svelte.js';

await markSessionStart();
await loadSettings();
applyTheme();
applyMotion();
await loadRecents();
initMenuBridge();

const app = mount(App, { target: document.getElementById('app') });
initWindowTitle();

await initCrashRecovery();
startAutosaveWatcher();

invoke('check_vibrancy').then(ok => {
    if (!ok) document.body.classList.add('no-vibrancy');
}).catch(() => {
    document.body.classList.add('no-vibrancy');
});

export default app;