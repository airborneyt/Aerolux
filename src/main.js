import { mount, onMount } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import App from './App.svelte';
import './app.css';
import './lib/aerolux/aerolux-init.svelte.js'
import { loadSettings, settings } from './stores/settings.svelte.js';
import { initHaptics } from './lib/aerolux/haptics.js';
import { audio } from './lib/aerolux/audio/index.js';
import './lib/aerolux/audio/sfx/catalog.js';
import './lib/aerolux/audio/ost/catalog.js'
import { applyTheme } from './stores/theme.svelte.js';
import { applyMotion } from './stores/motion.svelte.js';
import { loadRecents } from './stores/projects.svelte.js';
import { initMenuBridge } from './lib/aerolux/menu-bridge.svelte.js';
import { initWindowTitle } from './lib/aerolux/window-title.svelte.js';
import { markSessionStart, initCrashRecovery, startAutosaveWatcher } from './lib/aerolux/crash-recovery.svelte.js';
import { checkForUpdate } from './stores/updater.svelte.js';
import { initialiseDiscordActivity, setDiscordContext } from './lib/aerolux/discord.js';

await markSessionStart();
await loadSettings();
setDiscordContext('home');
await initialiseDiscordActivity(settings.activity.enabled);
await initHaptics();
applyTheme();
applyMotion();
audio.init();
await loadRecents();
initMenuBridge();

const app = mount(App, { target: document.getElementById('app') });
initWindowTitle();

await initCrashRecovery();
startAutosaveWatcher();

checkForUpdate({ promptIfNew: true }).catch(() => {});

invoke('check_vibrancy').then(ok => {
    if (!ok) document.body.classList.add('no-transparency');
}).catch(() => {
    document.body.classList.add('no-transparency');
});

export default app;
