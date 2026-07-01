// src/lib/aerolux/history-panel.js
// velocity's session history panel: render, restore, clear.
// call initHistoryPanel(callbacks)
// returns { render(entries) }

export function initHistoryPanel({
  getPalette,         // () => palette array
  toHex,              // (r,g,b) => string
  onRestore,          // (entry) => void  : called when user clicks a history item
  clearHistory,       // () => void       : from editorState
  showToast,          // (msg, type, duration) => void
}) {

  document.getElementById('history-clear-btn')?.addEventListener('click', () => {
    clearHistory();
    showToast('History cleared', 'info', 1500);
  });

  // render ──────────────────────────────────────────────────────────

  function render(entries) {
    const palette = getPalette();
    const list    = document.getElementById('history-list');
    if (!entries.length) {
      list.innerHTML = '<p class="al-hint-text" style="padding:4px">No history yet. Export a gradient to add it here</p>';
      return;
    }
    list.innerHTML = '';
    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'al-hist-item';
      item.title     = `Restore · ${new Date(entry.ts).toLocaleTimeString()}`;

      const bar = document.createElement('div');
      bar.className = 'al-hist-bar';
      entry.result.forEach(({ velocity }) => {
        const c   = palette[velocity] || palette[0];
        const seg = document.createElement('div');
        seg.style.background = toHex(c.r, c.g, c.b);
        bar.appendChild(seg);
      });

      const ts = document.createElement('span');
      ts.className   = 'al-hist-ts';
      ts.textContent = new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      item.appendChild(bar);
      item.appendChild(ts);
      item.addEventListener('click', () => onRestore(entry));
      list.appendChild(item);
    });
  }

  return { render };
}