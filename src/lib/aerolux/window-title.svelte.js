// window-title.svelte.js
// keeps the native window title in sync with the current project:
//   "Aerolux"                    = no project open
//   "Aerolux | My Project"       = project open, saved
//   "Aerolux | My Project •"     = project open, unsaved changes
//
// call initWindowTitle() once near app startup, after the window
// exists (i.e. after mount()), since it needs getCurrentWindow().

import { getCurrentWindow } from '@tauri-apps/api/window';
import { projects } from '../../stores/projects.svelte.js';

export function initWindowTitle() {
  const win = getCurrentWindow();

  $effect.root(() => {
    $effect(() => {
      const title = projects.activeEditor === null
        ? 'Aerolux'
        : `Aerolux | ${projects.currentName}${projects.isDirty ? ' •' : ''}`;

      win.setTitle(title).catch(err => {
        console.warn('Failed to set window title:', err);
      });
    });
  });
}
