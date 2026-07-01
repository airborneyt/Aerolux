// crash-recovery.svelte.js
// session marker + debounced autosave + startup recovery prompt
//
// session.json   — { cleanExit: boolean }
// autosave.json  — single-slot snapshot of the dirty project, or null
//
// call markSessionStart() as the very first thing in main.js, before
// anything else touches the filesystem. call markCleanExit() from the
// same place the app actually calls exit(0) (the menu bridge's
// 'app:exit-requested' handler, after a guardUnsavedChanges resolves
// to something other than 'cancel').
//
// call initCrashRecovery() once after loadSettings()/loadRecents(),
// before mount(). it checks for a stale autosave and exposes
// recoveryPrompt state for a modal to render, mirroring the
// unsavedPrompt pattern in menu-bridge.svelte.js.

import { LazyStore } from '@tauri-apps/plugin-store';
import { editor } from '../../stores/velocity.svelte.js';
import { navigate } from '../../stores/router.svelte.js';
import { projects } from '../../stores/projects.svelte.js';
import { emitter } from './aerolux-init.svelte.js';
import {
  serializeVelocityState,
  deserializeVelocityState,
} from './project-velocity.js';

const sessionStore  = new LazyStore('session.json');
const autosaveStore = new LazyStore('autosave.json');

const AUTOSAVE_DEBOUNCE_MS = 3000;

// recovery prompt state (component-facing) ──────────────────────────

export const recoveryPrompt = $state({
  open: false,
  data: null, // the recovered autosave payload, while the prompt is up
});

let resolveRecoveryChoice = null;

export function resolveRecoveryPrompt(choice) {
  recoveryPrompt.open = false;
  resolveRecoveryChoice?.(choice);
  resolveRecoveryChoice = null;
}

// session marker ────────────────────────────────────────────────────

/**
 * call first thing in main.js, before any other startup work. writes
 * cleanExit:false immediately. if the process dies before
 * markCleanExit() ever runs, this is what's left behind to detect.
 */
export async function markSessionStart() {
  await sessionStore.set('cleanExit', false);
  await sessionStore.save?.();
}

/**
 * call right before the app actually exits (after the unsaved-changes
 * guard has resolved to something other than 'cancel'). marks this
 * session as having ended cleanly, and clears any autosave. a clean
 * exit means either nothing was dirty, or the user explicitly chose
 * save/don't save, so there's nothing left to recover.
 */
export async function markCleanExit() {
  await sessionStore.set('cleanExit', true);
  await sessionStore.save?.();
  await clearAutosave();
}

async function wasCleanExit() {
  const val = await sessionStore.get('cleanExit');
  return val === true;
}

// autosave ──────────────────────────────────────────────────────────

let autosaveTimer = null;

function buildAutosavePayload() {
  if (projects.currentType === 'velocity') {
    return {
      type:         projects.currentType,
      name:         projects.currentName,
      originalPath: projects.currentPath,
      savedAt:      Date.now(),
      velocity:     serializeVelocityState(editor),
      kinetic:      buildKineticAutosavePayload(), // stub, see below
    };
  }
  if (projects.currentType === 'kinetic') {
    return {
      type:         'kinetic',
      name:         projects.currentName,
      originalPath: projects.currentPath,
      savedAt:      Date.now(),
      velocity:     null,
      kinetic:      buildKineticAutosavePayload(),
    };
  }
  return null;
}

// todo: replace with real kinetic.svelte.js serialisation once
// project-kinetic.js exists. 
function buildKineticAutosavePayload() {
  return null;
}

async function writeAutosave() {
  const payload = buildAutosavePayload();
  if (!payload) return;
  await autosaveStore.set('snapshot', payload);
  await autosaveStore.save?.();
}

export async function clearAutosave() {
  await autosaveStore.set('snapshot', null);
  await autosaveStore.save?.();
}

function scheduleAutosave() {
  if (!projects.isDirty) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(writeAutosave, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * wires the debounced autosave to the same change emitter that drives
 * dirty tracking in projects.svelte.js. call once, alongside
 * initCrashRecovery(). separated out so tests/tools can drive
 * autosave manually without needing the full recovery-prompt flow.
 */
export function startAutosaveWatcher() {
  emitter.on('gradient:change', scheduleAutosave);
  // manual save (success or otherwise) already clears the autosave
  // via markCleanExit's sibling path. see applyAutosave()/clearAutosave()
  // usage in projects.svelte.js's writeCurrentProjectTo if you want
  // autosave cleared on every successful save too, not just clean exit.
}

// apply a recovered snapshot into the live editor ───────────────────

function applyRecoveredVelocity(snapshot) {
  Object.assign(editor, deserializeVelocityState(snapshot.velocity));
  projects.currentPath      = null; // force save as. never silently overwrite the original file
  projects.currentType      = snapshot.type;
  projects.currentName      = snapshot.name ?? 'Recovered Project';
  projects.currentCreatedAt = Date.now();
  projects.isDirty          = true; // recovered work is, by definition, unsaved
}

// startup check ─────────────────────────────────────────────────────

/**
 * checks whether the previous session ended uncleanly and a usable
 * autosave exists. if so, opens recoveryPrompt and waits for the user
 * to choose via resolveRecoveryPrompt('restore' | 'discard'). resolves
 * once the choice has been fully applied (or immediately if there was
 * nothing to recover).
 */
export async function initCrashRecovery() {
  const cleanExit = await wasCleanExit();
  if (cleanExit) {
    await clearAutosave(); // belt-and-suspenders, should already be null
    return;
  }

  const snapshot = await autosaveStore.get('snapshot');
  if (!snapshot) return;

  // kinetic-only crashes currently have nothing recoverable
  // Remove this guard once kinetic autosave is real
  if (snapshot.type === 'kinetic' && !snapshot.kinetic) return;

  const choice = await new Promise(resolve => {
    recoveryPrompt.data = snapshot;
    recoveryPrompt.open = true;
    resolveRecoveryChoice = resolve;
  });

  if (choice === 'restore') {
    if (snapshot.type === 'velocity') {
      applyRecoveredVelocity(snapshot);
      navigate('velocity');
    }
    // kinetic restore: todo once project-kinetic.js exists.
    // when implemented, this should call navigate('kinetic') instead.
  }

  await clearAutosave();
}