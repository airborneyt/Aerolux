// src/lib/aerolux/project-io.js
// tauri-backed file I/O for .alx project files.
// wraps @tauri-apps/plugin-fs and @tauri-apps/plugin-dialog directly
// no custom rust commands needed. backup-before-overwrite is handled
// here in js since it's just an extra read/write pair.

import {
  readTextFile,
  writeTextFile,
  exists,
  remove,
} from '@tauri-apps/plugin-fs';
import { open, save } from '@tauri-apps/plugin-dialog';

const FILTERS = [{ name: 'Aerolux Project', extensions: ['alx'] }];

// dialogs ───────────────────────────────────────────────────────────

/**
 * opens a native file picker for an existing .alx file.
 * @param {string|null} defaultDir  directory to start the dialog in
 * @returns {Promise<string|null>} chosen path, or null if cancelled
 */
export async function pickOpenPath(defaultDir = null) {
  const result = await open({
    multiple: false,
    filters: FILTERS,
    ...(defaultDir ? { defaultPath: defaultDir } : {}),
  });
  // plugin-dialog returns string | string[] | null depending on version/config
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}

/**
 * opens a native save picker for a new/relocated .alx file.
 * @param {string} defaultName  suggested filename, without extension
 * @param {string|null} defaultDir  directory to start the dialog in
 * @returns {Promise<string|null>} chosen path, or null if cancelled
 */
export async function pickSavePath(defaultName = 'My Project', defaultDir = null) {
  const suggestedPath = defaultDir
    ? `${defaultDir}/${defaultName}.alx`
    : `${defaultName}.alx`;
  const result = await save({
    defaultPath: suggestedPath,
    filters: FILTERS,
  });
  return result ?? null;
}

// raw read/write ────────────────────────────────────────────────────

/**
 * reads and parses a .alx file from an absolute path.
 * throws if the file is missing, unreadable, or not valid JSON.
 */
export async function readProjectFile(path) {
  const text = await readTextFile(path);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`"${path}" is not a valid Aerolux project file (malformed JSON).`);
  }
  if (!parsed.aerolux) {
    throw new Error(`"${path}" does not look like an Aerolux project file.`);
  }
  return parsed;
}

/**
 * writes a project object to an absolute path as formatted JSON.
 * if a file already exists at this path, it is backed up to
 * "<path>.bak" first (best-effort. backup failure does not block save).
 */
export async function writeProjectFile(path, projectData) {
  await backupIfExists(path);
  const json = JSON.stringify(projectData, null, 2);
  await writeTextFile(path, json);
}

async function backupIfExists(path) {
  try {
    const fileExists = await exists(path);
    if (!fileExists) return;
    const current = await readTextFile(path);
    await writeTextFile(`${path}.bak`, current);
  } catch (err) {
    // backups are best-effort. never block a save because of one.
    console.warn('Project backup failed (continuing with save):', err);
  }
}

/**
 * checks whether a path still exists on disk. used to detect a
 * recent project entry whose file has been moved/deleted, and for
 * kinetic clip relinking.
 */
export async function pathExists(path) {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

/**
 * deletes the .bak sibling for a path, if present. optional cleanup
 * not called automatically, exposed for a future "clear backups" action.
 */
export async function removeBackup(path) {
  try {
    if (await exists(`${path}.bak`)) await remove(`${path}.bak`);
  } catch (err) {
    console.warn('Could not remove backup file:', err);
  }
}

// filename / dirname helpers ────────────────────────────────────────

export function basenameFromPath(path) {
  const parts = path.split(/[\\/]/);
  const file = parts[parts.length - 1] ?? path;
  return file.replace(/\.alx$/i, '');
}

/**
 * returns the directory portion of a path, for persisting as
 * settings.paths.lastProjectDir. handles both / and \ separators.
 */
export function dirnameFromPath(path) {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx === -1) return null;
  return path.slice(0, idx);
}