// src/lib/aerolux/kinetic/kinetic-state.js
// ============================================================================
// KINETIC ENGINE: UNDO/REDO TRACKER
//
// this is the kinetic equivalent for the undo/redo stack and session history
// since velocity and kinetic are not interchangeable, both editors' history
// have to be treated separately.
//
// usage:
//   const kineticState = createU
// ============================================================================

const MAX_UNDO    = 40;
const MAX_HISTORY = 12;

/**
 * @param {{ getSnapshot: () => *, applySnapshot: (snap:*) => void, afterRestore?: () => void }} config
 */
export function createUndoEngine({ 
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

    function pushUndo() {
        undoStack.push(getSnapshot());
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack = [];
    }

    function undo() {
        if (!undoStack.length) {
            onToast('Nothing to undo', 'info', 1200);
            return;
        }
        redoStack.push(getSnapshot());
        applySnapshot(undoStack.pop());
        afterRestore?.();
        onToast('Undone', 'info', 1000);
    }

    function redo() {
        if (!redoStack.length) {
            onToast('Nothing to redo', 'info', 1200);
            return false;
        }
        undoStack.push(getSnapshot());
        applySnapshot(redoStack.pop());
        afterRestore?.();
        onToast('Redone', 'info', 1000);
        return true;
    }

    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }

    // session history ––––––––––––––––––––––––––––––––––––––––––––––

    function pushHistory(entry) {
        history.unshift(entry);
        if (history.length > MAX_HISTORY) history.pop();
        onHistoryChange([...history]);
    }

    function clearHistory() {
        history = [];
        onHistoryChange?.([]);
    }

    // Loading or creating a project starts a new editing session. Clear all
    // undoable state as well as the visible session history in one operation.
    function clear() {
        undoStack = [];
        redoStack = [];
        history = [];
        onHistoryChange?.([]);
        onStackChange?.();
    }

    function getHistory() {
        return [...history];
    }

    // public API –––––––––––––––––––––––––––––––––––––––––––––––––––

    return { 
        pushUndo, 
        undo, 
        redo, 
        canUndo, 
        canRedo, 
        pushHistory,
        clearHistory,
        clear,
        getHistory, 
    };
}
