// src/lib/aerolux/import-panel.js
// import modal: drag-and-drop, file reading, and gradient loading
// call initImportPanel(callbacks) once after the DOM is ready

import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { parseImportedGradient } from './import-logic.js';

export function initImportPanel({
  getPaletteLength,   // () => number
  onImportConfirmed,  // ({ stops, steps, nextId }) => void
  showToast,          // (msg, type, duration) => void
}) {
  const importModal     = document.getElementById('import-modal');
  const importDropzone  = document.getElementById('import-dropzone');
  const importFileInput = document.getElementById('import-file-input');
  const importStatus    = document.getElementById('import-status');
  const importConfirm   = document.getElementById('import-confirm-btn');

  let pendingImportStops = null;
  let pendingImportSteps = null;
  let pendingNextId      = null;

  // open / close ────────────────────────────────────────────────────

  function open() { importModal.classList.add('open'); }

  function close() {
    importModal.classList.remove('open');
    pendingImportStops = null;
    pendingImportSteps = null;
    pendingNextId      = null;
    importStatus.textContent = '';
    importStatus.style.color = '';
    importConfirm.disabled   = true;
    importFileInput.value    = '';
  }

  document.getElementById('import-btn')?.addEventListener('click', open);
  document.getElementById('import-close')?.addEventListener('click', close);
  document.getElementById('import-cancel-btn')?.addEventListener('click', close);
  importModal.addEventListener('click', e => { if (e.target === importModal) close(); });

  // file picking ────────────────────────────────────────────────────

  document.getElementById('import-browse-btn').addEventListener('click', e => {
    e.stopPropagation();
    importFileInput.click();
  });

  importDropzone.addEventListener('click', async () => {
    const path = await open({
      multiple: false,
      filters: [{ extensions: ['txt'] }],
    });
    if (!path) return; // user cancelled
    
    try {
      const text = await readTextFile(path);
      _handleText(text); // same logic as before, just renamed from _handleFile
    } catch (err) {
      importStatus.textContent = '✗ Could not read file: ' + err.message;
      importStatus.style.color = 'var(--al-red)';
      importConfirm.disabled = true;
    }
  });

  // drag and drop ───────────────────────────────────────────────────

  importDropzone.addEventListener('dragover', e => {
    e.preventDefault();
    importDropzone.style.borderColor = 'var(--color-primary-blue)';
    importDropzone.style.background  = 'var(--al-blue-bg)';
  });

  importDropzone.addEventListener('dragleave', () => {
    importDropzone.style.borderColor = 'var(--al-border2)';
    importDropzone.style.background  = 'transparent';
  });

  importDropzone.addEventListener('drop', e => {
    e.preventDefault();
    importDropzone.style.borderColor = 'var(--al-border2)';
    importDropzone.style.background  = 'transparent';
    const file = e.dataTransfer.files[0];
    if (file) _handleFile(file);
  });

  // file reading ────────────────────────────────────────────────────

  function _handleText(text) {
    try {
      const result = parseImportedGradient(text, getPaletteLength(), 0);
      pendingImportStops = result.stops;
      pendingImportSteps = result.steps;
      pendingNextId      = result.nextId;
      importStatus.textContent = `✓ ${result.stops.length} stops detected`;
      importStatus.style.color = 'var(--al-green)';
      importConfirm.disabled   = false;
    } catch (error) {
      importStatus.textContent = '✗ ' + error.message;
      importStatus.style.color = 'var(--al-red)';
      importConfirm.disabled   = true;
      pendingImportStops = null;
      pendingImportSteps = null;
      pendingNextId      = null;
    }
  }

  // confirm ─────────────────────────────────────────────────────────

  importConfirm.addEventListener('click', () => {
    if (!pendingImportStops) return;
    onImportConfirmed({
      stops:  pendingImportStops,
      steps:  Math.max(2, Math.min(16, pendingImportSteps)),
      nextId: pendingNextId,
    });
    showToast('Gradient imported', 'success');
    close();
  });
}