// src/lib/aerolux/velocity-state.js
// velocity's undo/redo stack and session history, decoupled from editor globals
//
// usage:
//   const editorState = createEditorState({
//     getSnapshot,    // () => object : snapshot of full current state
//     applySnapshot,  // (snapshot) => void : restores state from snapshot
//     afterRestore,   // () => void : called after any undo/redo/history restore
//     onToast,        // (msg, type, duration) => void
//     onHistoryChange,// (entries[]) => void : called when history list changes
//   });
//
//   const { pushUndo, undo, redo, pushHistory, clearHistory, getHistory,
//           canUndo, canRedo } = editorState;

const MAX_UNDO    = 40;
const MAX_HISTORY = 12;

export function createEditorState({
  getSnapshot,
  applySnapshot,
  afterRestore,
  onToast,
  onHistoryChange,
  onStackChange,
}) {

  let undoStack = [];
  let redoStack = [];
  let history   = [];

  // undo / redo ─────────────────────────────────────────────────────

  function pushUndo() {
    undoStack.push(getSnapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    _notifyButtonState();
  }

  function undo() {
    if (!undoStack.length) {
      onToast('Nothing to undo', 'info', 1200);
      return;
    }
    redoStack.push(getSnapshot());
    applySnapshot(undoStack.pop());
    afterRestore();
    onToast('Undone', 'info', 1000);
    _notifyButtonState();
  }

  function redo() {
    if (!redoStack.length) {
      onToast('Nothing to redo', 'info', 1200);
      return;
    }
    undoStack.push(getSnapshot());
    applySnapshot(redoStack.pop());
    afterRestore();
    onToast('Redone', 'info', 1000);
    _notifyButtonState();
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  // called after every stack mutation to let velocity update the undo/redo button disabled states
  function _notifyButtonState() {
    if (typeof onStackChange === 'function') onStackChange();
  }

  // session history ─────────────────────────────────────────────────

  function pushHistory(entry) {
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.pop();
    onHistoryChange([...history]);
  }

  function clearHistory() {
    history = [];
    onHistoryChange([]);
  }

  function getHistory() {
    return [...history];
  }

  // public API ──────────────────────────────────────────────────────

  return {
    pushUndo,
    undo,
    redo,
    canUndo,
    canRedo,
    pushHistory,
    clearHistory,
    getHistory,
  };
}