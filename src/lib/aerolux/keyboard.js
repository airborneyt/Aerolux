// src/lib/aerolux/keyboard.js
// velocity's keyboard shortcut handler.
// this will be converted to a global system once kinetic is complete
// call initKeyboardShortcuts(callbacks) once after the DOM is ready

export function initKeyboardShortcuts({
  undo,             // () => void
  redo,             // () => void
  focusSwatch,      // (idx: number) => void
  getHoveredSwatchIdx, // () => number
  getGridCols,      // () => number
  getSwatchEls,     // () => Element[]
  setPickingTint,   // (active: boolean) => void
  showToast,        // (msg, type, duration) => void
}) {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;

    // arrow key swatch navigation
    const typingInText = tag === 'TEXTAREA' ||
      (tag === 'INPUT' && ['ai-prompt','auto-ai-prompt-input'].includes(document.activeElement.id));

    if (!typingInText && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const cols     = getGridCols();
      const swatches = getSwatchEls();
      if (!swatches.length) return;
      const cur  = getHoveredSwatchIdx();
      let next   = cur;
      if (e.key === 'ArrowRight') next = cur + 1;
      if (e.key === 'ArrowLeft')  next = cur - 1;
      if (e.key === 'ArrowDown')  next = cur + cols;
      if (e.key === 'ArrowUp')    next = cur - cols;
      focusSwatch(next);
      return;
    }

    // enter to click keyboard-focused swatch
    if (!typingInText && e.key === 'Enter') {
      const swatches = getSwatchEls();
      const target   = swatches[getHoveredSwatchIdx()];
      if (target && !target.classList.contains('al-sw-disabled')) {
        e.preventDefault();
        target.click();
        return;
      }
    }

    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      document.getElementById('help-modal')?.classList.remove('open');
      setPickingTint(false);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); }
      if (e.key === 'c') {
        e.preventDefault();
        navigator.clipboard.writeText(document.getElementById('out-text').value);
        showToast('Copied to clipboard', 'success', 1500);
      }
    }

    if (e.key === 'r' || e.key === 'R') document.getElementById('randomise-btn')?.click();
    if (e.key === 'Delete')             document.getElementById('stop-del-btn')?.click();
  });
}