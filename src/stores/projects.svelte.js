// src/stores/projects.svelte.js
// orchestration layer for .alx project files. ties together:
//   - project-velocity.js / project-kinetic.js (serialization)
//   - project-io.js (Tauri file I/O, dialogs)
//   - recents.json (Tauri store, via recentsStore below)
//   - settings.svelte.js (lastProjectDir, maxRecentProjects)
//   - editor.svelte.js (the live Velocity state being saved/loaded)
//   - aerolux-init.svelte.js's emitter (dirty tracking)

import { LazyStore } from '@tauri-apps/plugin-store';
import { editor } from './velocity.svelte.js';
import { emitter } from '../lib/aerolux/aerolux-init.svelte.js';
import { settings, saveSetting } from './settings.svelte.js';
import { navigate } from './router.svelte.js';
import { showToast } from '../lib/aerolux/toast.js';
import {
  defaultVelocityState,
  serializeVelocityState,
  deserializeVelocityState,
  isValidVelocityState,
} from '../lib/aerolux/project-velocity.js';
import { buildVelocityThumbnail } from '../lib/aerolux/project-thumbnail.js';
import {
  pickOpenPath,
  pickSavePath,
  readProjectFile,
  writeProjectFile,
  basenameFromPath,
  dirnameFromPath,
} from '../lib/aerolux/project-io.js';

const recentsStore = new LazyStore('recents.json');
const RECENTS_KEY = 'recents';

// store ─────────────────────────────────────────────────────────────

export const projects = $state({
  currentPath:      null,
  currentType:      null,   // 'velocity' | 'kinetic' | null
  currentName:      'Untitled',
  currentCreatedAt: null,    // preserved across re-saves; set on new/open
  isDirty:          false,
  recents:          [],      // hydrated by loadRecents()
});

// dirty tracking ────────────────────────────────────────────────────
// subscribes once to the shared emitter. any meaningful Velocity edit
// fires 'gradient:change', which is enough to mark the project dirty.
//
// if no project is open yet when this fires, the edit itself implies
// intent to start one. aerolux-init.svelte.js only emits this event
// when state has genuinely diverged from its initial snapshot, so a
// truly untouched app never reaches this branch. we silently stand up
// an implicit Velocity project (no toast, no modal, it should feel
// invisible) rather than letting the edit vanish into an untracked
// limbo with nothing to save, recover, or warn about on quit.
//
// Kinetic will emit its own 'kinetic:change' once its API exists
// that subscription gets added alongside Kinetic save/load, with the
// same implicit-project behaviour.

emitter.on('gradient:change', () => {
  if (projects.currentType === null) {
    projects.currentType      = 'velocity';
    projects.currentPath      = null;
    projects.currentName      = 'Untitled';
    projects.currentCreatedAt = null;
  }

  if (projects.currentType === 'velocity' || projects.currentType === 'kinetic') {
    projects.isDirty = true;
  }
});

// recents ───────────────────────────────────────────────────────────

export async function loadRecents() {
  const list = await recentsStore.get(RECENTS_KEY);
  projects.recents = Array.isArray(list) ? list : [];
  return projects.recents;
}

async function persistRecents() {
  await recentsStore.set(RECENTS_KEY, projects.recents);
  await recentsStore.save?.();
}

/**
 * adds or updates a recents entry for the given path, then evicts the
 * oldest unpinned entries beyond the configured soft cap.
 */
async function upsertRecent({ path, name, type, thumbnail, touchModified }) {
  const now = Date.now();
  const existingIdx = projects.recents.findIndex(r => r.path === path);

  const base = existingIdx !== -1
    ? projects.recents[existingIdx]
    : { path, name, type, thumbnail, modifiedAt: now, lastOpenedAt: now, pinned: false };

  const entry = {
    ...base,
    name,
    type,
    thumbnail,
    lastOpenedAt: now,
    modifiedAt: touchModified ? now : base.modifiedAt,
  };

  const next = existingIdx !== -1
    ? projects.recents.toSpliced(existingIdx, 1, entry)
    : [entry, ...projects.recents];

  projects.recents = evictOverCap(next);
  await persistRecents();
}

function evictOverCap(list) {
  const cap = settings.constants?.maxRecentProjects ?? 200;
  if (list.length <= cap) return list;

  const pinned   = list.filter(r => r.pinned);
  const unpinned = list.filter(r => !r.pinned)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  const keepUnpinned = unpinned.slice(0, Math.max(0, cap - pinned.length));
  // re-merge in original relative order rather than re-sorting here
  // display-side sorting is the caller's responsibility.
  const keepPaths = new Set([...pinned.map(r => r.path), ...keepUnpinned.map(r => r.path)]);
  return list.filter(r => keepPaths.has(r.path));
}

export async function togglePinRecent(path) {
  const idx = projects.recents.findIndex(r => r.path === path);
  if (idx === -1) return;
  projects.recents = projects.recents.toSpliced(idx, 1, {
    ...projects.recents[idx],
    pinned: !projects.recents[idx].pinned,
  });
  await persistRecents();
}

export async function removeRecent(path) {
  projects.recents = projects.recents.filter(r => r.path !== path);
  await persistRecents();
}

// new project ───────────────────────────────────────────────────────

/**
 * resets relevant editor state and clears the current path so the
 * next save acts as a "save as". Velocity is fully implemented;
 * Kinetic is wired into the type system but their reset
 * logic is a stub until Kinetic save/load lands.
 */
export function newProject(type) {
  if (type === 'velocity') {
    Object.assign(editor, deserializeVelocityState(defaultVelocityState()));
  }
  if (type === 'kinetic') {
    // todo: reset kinetic.svelte.js state once it exists.
    // intentionally a no-op for now. type system support only.
  }

  projects.currentPath      = null;
  projects.currentType      = type;
  projects.currentName      = 'Untitled';
  projects.currentCreatedAt = null;
  projects.isDirty          = false;
}

// open ──────────────────────────────────────────────────────────────

export async function openProject() {
  const path = await pickOpenPath(settings.paths?.lastProjectDir ?? null);
  if (!path) return false;
  return loadProjectFromPath(path);
}

export async function loadRecentProject(path) {
  return loadProjectFromPath(path);
}

async function loadProjectFromPath(path) {
  let data;
  try {
    data = await readProjectFile(path);
  } catch (err) {
    showToast(err.message, 'error', 5000);
    // stale recents entry = file moved or deleted. surface but don't
    // auto-remove, the user may want to relink rather than lose history.
    return false;
  }

  if (data.type === 'velocity') {
    if (!isValidVelocityState(data.velocity)) {
      showToast('Project file is missing valid Velocity data.', 'error', 5000);
      return false;
    }
    Object.assign(editor, deserializeVelocityState(data.velocity));
  }

  if (data.type === 'kinetic') {
    // todo: apply kinetic state once kinetic.svelte.js + project-kinetic.js exist.
  }

  projects.currentPath      = path;
  projects.currentType      = data.type;
  projects.currentName      = data.name ?? basenameFromPath(path);
  projects.currentCreatedAt = data.createdAt ?? Date.now();
  projects.isDirty          = false;

  await upsertRecent({
    path,
    name:      projects.currentName,
    type:      data.type,
    thumbnail: data.thumbnail ?? null,
    touchModified: false,
  });

  const dir = dirnameFromPath(path);
  if (dir) await saveSetting('paths.lastProjectDir', dir);

  navigate(data.type === 'kinetic' ? 'kinetic' : 'velocity');
  showToast(`"${projects.currentName}" loaded`, 'success');
  return true;
}

// save ──────────────────────────────────────────────────────────────

export async function saveProject() {
  if (!projects.currentPath) return saveProjectAs();
  return writeCurrentProjectTo(projects.currentPath);
}

export async function saveProjectAs() {
  const path = await pickSavePath(projects.currentName, settings.paths?.lastProjectDir ?? null);
  if (!path) return false;
  return writeCurrentProjectTo(path);
}

async function writeCurrentProjectTo(path) {
  const name = basenameFromPath(path);
  const thumbnail = await buildThumbnailForCurrentProject();

  // first-ever save of a brand new project: stamp createdAt now and
  // keep it for the lifetime of the file. any subsequent save (even
  // to a different path via "save as") preserves the original value.
  if (projects.currentCreatedAt === null) {
    projects.currentCreatedAt = Date.now();
  }

  const data = {
    aerolux:    true,
    version:    1,
    type:       projects.currentType,
    name,
    createdAt:  projects.currentCreatedAt,
    modifiedAt: Date.now(),
    thumbnail,
    velocity: (projects.currentType === 'velocity')
      ? serializeVelocityState(editor)
      : null,
    kinetic: null, // todo: serialise kinetic state once it exists
  };

  try {
    await writeProjectFile(path, data);
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error', 6000);
    return false;
  }

  projects.currentPath = path;
  projects.currentName = name;
  projects.isDirty      = false;

  await upsertRecent({
    path,
    name,
    type:      projects.currentType,
    thumbnail,
    touchModified: true,
  });

  const dir = dirnameFromPath(path);
  if (dir) await saveSetting('paths.lastProjectDir', dir);

  showToast(`"${name}" saved`, 'success');
  return true;
}

async function buildThumbnailForCurrentProject() {
  if (projects.currentType === 'velocity') {
    return buildVelocityThumbnail(editor);
  }
  // 'kinetic' thumbnails land with Kinetic save/load.
  return null;
}