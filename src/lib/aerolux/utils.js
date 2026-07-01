// src/lib/aerolux/utils.js
// these are small utility functions used throughout Aerolux.

import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

export function gradToText(result) {
  return result.map(g => `${g.step}, ${g.velocity};`).join('\n');
}

export function safeFilename(name) {
  return name.replace(/[^a-z0-9_\-]/gi, '_').replace(/__+/g, '_').toLowerCase();
}

// create a temporary <a> element and triggers a file download in the browser (now window)
export async function downloadText(text, filename) {
  // open a native save dialog pre-filled with the suggested filename
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });

  // if user cancelled the dialog, do nothing
  if (!path) return;

  await writeTextFile(path, text);
}