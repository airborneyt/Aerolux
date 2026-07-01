// src/lib/aerolux/share-panel.js
// URL and QR (defunct) sharing panel
// call initSharePanel(callbacks) once after the DOM is ready

import { encodeState, decodeState, buildShareUrl, getShareParam, cleanShareUrl } from './share.js';

/**
 * callbacks:
 *   getPalette()                — () => palette array
 *   getEditorState()            — () => { stops, algorithm, easing, hslDir,
 *                                          steps, hueShift, tint, envelope }
 *   applyEditorState(partial)   — (partial) => void
 *   pushUndo()                  — () => void
 *   updateUndoButtons()         — () => void
 *   syncUiToState()             — () => void
 *   renderAll()                 — () => void
 *   showToast(msg, type, dur)   — fn
 */
export function initSharePanel({
  getPalette,
  getEditorState,
  applyEditorState,
  pushUndo,
  updateUndoButtons,
  syncUiToState,
  renderAll,
  showToast,
}) {

  // share button: copy link + show QR ───────────────────────────────

  let qrVisible = false;

  document.getElementById('share-btn')?.addEventListener('click', () => {
    const state   = getEditorState();
    const encoded = encodeState(state);
    const url     = buildShareUrl(encoded);

    // copy to clipboard immediately
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link copied to clipboard', 'success', 2000);
    }).catch(() => {
      showToast('Could not copy. Clipboard access denied', 'warning', 3000);
    });

    // toggle QR panel
    const qrWrap = document.getElementById('share-qr-wrap');
    if (!qrWrap) return;

    if (qrVisible) {
      qrWrap.style.display = 'none';
      qrVisible = false;
      return;
    }

    // render QR
    const qrEl = document.getElementById('share-qr');
    qrEl.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrEl, {
        text:         url,
        width:        148,
        height:       148,
        colorDark:    '#ffffff',
        colorLight:   '#13152a',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } else {
      qrEl.textContent = '(QR unavailable — CDN may be blocked)';
      qrEl.style.cssText = 'font-size:11px;opacity:0.5;padding:8px';
    }

    qrWrap.style.display = 'flex';
    qrVisible = true;
  });

  document.getElementById('share-qr-close')?.addEventListener('click', () => {
    document.getElementById('share-qr-wrap').style.display = 'none';
    qrVisible = false;
  });

  document.getElementById('share-copy-link-btn')?.addEventListener('click', () => {
  const state   = getEditorState();
  const encoded = encodeState(state);
  const url     = buildShareUrl(encoded);
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied to clipboard', 'success', 2000);
  }).catch(() => {
    showToast('Could not copy — clipboard access denied', 'warning', 3000);
  });
});

  // on-load URL restore ─────────────────────────────────────────────

  const encoded = getShareParam();
  if (!encoded) return;

  const palette = getPalette();
  const decoded = decodeState(encoded, palette.length);
  cleanShareUrl();

  if (!decoded) {
    showToast('Shared link could not be decoded', 'warning', 4000);
    return;
  }

  // apply immediately
  pushUndo();
  updateUndoButtons();
  applyEditorState({
    stops:     decoded.stops,
    algorithm: decoded.algorithm,
    easing:    decoded.easing,
    hslDir:    decoded.hslDir,
    steps:     decoded.steps,
    hueShift:  decoded.hueShift,
    tint:      { ...decoded.tint },
    envelope:  { ...decoded.envelope },
    selStop:   decoded.selStop,
    nextId:    decoded.nextId,
  });
  syncUiToState();
  renderAll();
  showToast('Imported from shared link', 'success', 3000);
}