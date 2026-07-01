// src/lib/aerolux/menu-bridge.svelte.js
// listens for native menu events (file → new/open/save/save as) and
// app-exit-requested events from rust, routes them into projects.svelte.js,
// and owns the "unsaved changes?" confirmation flow shared by both.
//
// call initMenuBridge() once, near app startup (after loadRecents()).

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { exit } from '@tauri-apps/plugin-process';
import { navigate } from '../../stores/router.svelte.js';
import { projects, saveProject, saveProjectAs } from '../../stores/projects.svelte.js';
import { markCleanExit } from './crash-recovery.svelte.js';

// unsaved-changes modal state ───────────────────────────────────────
// a single shared piece of state any component can read to render the
// confirmation modal. keeping it here (rather than inside a component)
// means file → new, the home page's new button, and the OS exit event
// all reuse the exact same prompt and resolution logic.

export const unsavedPrompt = $state({
  open:    false,
  pending: null, // 'new' | 'open' | 'exit' | null — what triggered the prompt
});

let resolvePrompt = null;

/**
 * shows the unsaved-changes modal and resolves once the user picks
 * save / don't save / cancel. returns 'save' | 'discard' | 'cancel'.
 */
function askToSave(trigger) {
  return new Promise(resolve => {
    unsavedPrompt.pending = trigger;
    unsavedPrompt.open    = true;
    resolvePrompt = resolve;
  });
}

/**
 * called by the modal component's three buttons.
 */
export function resolveUnsavedPrompt(choice) {
  unsavedPrompt.open    = false;
  unsavedPrompt.pending = null;
  resolvePrompt?.(choice);
  resolvePrompt = null;
}

/**
 * runs the dirty-check gate before any action that would discard the
 * current project (new project, opening another, quitting). if the
 * project isn't dirty, resolves immediately with 'discard' so callers
 * don't need to special-case the clean state.
 */
async function guardUnsavedChanges(trigger) {
  if (!projects.isDirty) return 'discard';

  const choice = await askToSave(trigger);
  if (choice === 'save') {
    const ok = await saveProject();
    return ok ? 'discard' : 'cancel'; // save failed → treat as cancel
  }
  return choice; // 'discard' | 'cancel'
}

// menu bridge ───────────────────────────────────────────────────────

export function initMenuBridge() {
  listen('menu:new', async () => {
    const result = await guardUnsavedChanges('new');
    if (result === 'cancel') return;
    // HomePage reads router.intent on mount/update and opens the
    // type-selection modal when it sees 'newProject', then clears it.
    navigate('home', 'newProject');
  });

  listen('menu:open', async () => {
    const result = await guardUnsavedChanges('open');
    if (result === 'cancel') return;
    navigate('home', 'openProject');
  });

  listen('menu:save', () => {
    saveProject();
  });

  listen('menu:save-as', () => {
    saveProjectAs();
  });

  listen('app:exit-requested', async () => {
      const result = await guardUnsavedChanges('exit');
      if (result === 'cancel') return;
      await markCleanExit();
      await invoke('confirm_quit');
      await exit(0);
    });

  // keep the native save/save as menu items enabled only when a
  // project is actually open, mirroring projects.currentType.
  $effect.root(() => {
    $effect(() => {
      const hasProject = projects.currentType !== null;
      invoke('set_save_menu_enabled', { enabled: hasProject }).catch(() => {});
    });
  });
}