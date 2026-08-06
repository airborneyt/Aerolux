// src/lib/aerolux/kinetic/kinetic-state.js
// ============================================================================
// KINETIC ENGINE: UNDO/REDO TRACKER
// generic, headless snapshot/restore stack. this file only
// knows how to push/pop snapshots via caller-supplied getSnapshot/
// applySnapshot and has zero knowledge of what a "node" or "device" is.
// ============================================================================

const MAX_UNDO = 40;

/**
 * @param {{ getSnapshot: () => *, applySnapshot: (snap:*) => void, afterRestore?: () => void }} config
 */
export function createUndoEngine({ getSnapshot, applySnapshot, afterRestore }) {
    let undoStack = [];
    let redoStack = [];

    function pushUndo() {
        undoStack.push(getSnapshot());
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack = [];
    }

    function undo() {
        if (!undoStack.length) return false;
        const current = getSnapshot();
        const prev = undoStack.pop();
        redoStack.push(current);
        applySnapshot(prev);
        afterRestore?.();
        return true;
    }

    function redo() {
        if (!redoStack.length) return false;
        const current = getSnapshot();
        const next = redoStack.pop();
        undoStack.push(current);
        applySnapshot(next);
        afterRestore?.();
        return true;
    }

    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }
    function clear() { undoStack = []; redoStack = []; }

    return { pushUndo, undo, redo, canUndo, canRedo, clear };
}