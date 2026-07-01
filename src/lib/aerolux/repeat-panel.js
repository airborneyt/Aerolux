// src/lib/aerolux/repeat-panel.js
// repeat warning auto-fix
// call initRepeatPanel(callbacks) once after the DOM is ready

import { buildGradient } from './gradient.js';

/**
 * callbacks:
 *   getPalette()         — () => palette array
 *   getLabCache()        — () => labCache array (may be null)
 *   getEditorState()     — () => { stops, algorithm, easing, hslDir, steps,
 *                                   hueShift, tint, envelope, antiRepeat }
 *   setAlgorithm(a)      — (string) => void  — update the algorithm variable
 *   setSteps(n)          — (number) => void  — update the steps variable
 *   getGradResult()      — () => gradResult array (already built)
 *   pushUndo()           — () => void
 *   updateUndoButtons()  — () => void
 *   syncUiToState()      — () => void
 *   renderAll()          — () => void
 *   showToast(msg, type, duration) — fn
 */
export function initRepeatPanel({
  getPalette,
  getLabCache,
  getEditorState,
  setAlgorithm,
  setSteps,
  getGradResult,
  pushUndo,
  updateUndoButtons,
  syncUiToState,
  renderAll,
  showToast,
}) {

  const ALGO_ORDER = ['lab', 'vivid', 'hsl', 'rgb', 'stepped'];

  function _countRepeats(result) {
    let n = 0;
    for (let i = 1; i < result.length; i++)
      if (result[i].velocity === result[i-1].velocity) n++;
    return n;
  }

  function _tryBuild(state, palette, labCache, algo, stepCount) {
    return buildGradient(
      state.stops, palette,
      algo      ?? state.algorithm,
      state.easing,
      stepCount ?? state.steps,
      state.tint, state.envelope, state.antiRepeat,
      state.hueShift, state.satMult, state.hslDir,
      labCache
    );
  }

  document.getElementById('repeat-autofix-btn')?.addEventListener('click', () => {
    const palette  = getPalette();
    const labCache = getLabCache();
    const state    = getEditorState();

    const currentRepeats = _countRepeats(getGradResult());
    if (!currentRepeats) return;

    // step 1: try other algorithms ──────────────────────────────────
    const candidates = ALGO_ORDER.filter(a => a !== state.algorithm);

    let bestAlgo  = null;
    let bestCount = currentRepeats;

    for (const algo of candidates) {
      const n = _countRepeats(_tryBuild(state, palette, labCache, algo));
      if (n < bestCount) {
        bestCount = n;
        bestAlgo  = algo;
        if (n === 0) break;
      }
    }

    if (bestAlgo) {
      pushUndo();
      updateUndoButtons();
      setAlgorithm(bestAlgo);
      syncUiToState();
      renderAll();
      if (bestCount === 0) {
        showToast(`Repeats resolved. Switched to ${bestAlgo}`, 'success');
      } else {
        showToast(`Switched to ${bestAlgo}. ${bestCount} repeat${bestCount > 1 ? 's' : ''} remain`, 'warning', 3500);
      }
      return;
    }

    // step 2: reduce steps until clean ──────────────────────────────
    const MIN_STEPS = 2;
    if (state.steps <= MIN_STEPS) {
      showToast('Could not resolve. Try adding more colour stops', 'warning', 4000);
      return;
    }

    let trialSteps = state.steps - 1;
    while (trialSteps >= MIN_STEPS) {
      if (_countRepeats(_tryBuild(state, palette, labCache, null, trialSteps)) === 0) break;
      trialSteps--;
    }

    if (trialSteps < MIN_STEPS) {
      showToast('Could not resolve. Try adding more colour stops', 'warning', 4000);
      return;
    }

    pushUndo();
    updateUndoButtons();
    setSteps(trialSteps);
    syncUiToState();
    renderAll();
    showToast(`Repeats resolved. Reduced to ${trialSteps} steps`, 'success');
  });
}