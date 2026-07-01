// src/stores/editorActions.svelte.js
import { createEditorState } from '../lib/aerolux/velocity-state.js';
import { showToast } from '../lib/aerolux/toast.js';
import { editor } from './velocity.svelte.js';

// snapshot ──────────────────────────────────────────────────────────

function snapState() {
    return {
        stops:      JSON.parse(JSON.stringify(editor.stops)),
        steps:      editor.steps,
        algorithm:  editor.algorithm,
        easing:     editor.easing,
        hslDir:     editor.hslDir,
        hueShift:   editor.hueShift,
        antiRepeat: editor.antiRepeat,
        tint:       { ...editor.tint },
        envelope:   { ...editor.envelope },
        selStop:    editor.selStop,
        nextId:     editor.nextId,
    };
}

function applyState(s) {
    editor.stops      = JSON.parse(JSON.stringify(s.stops));
    editor.steps      = s.steps;
    editor.algorithm  = s.algorithm;
    editor.easing     = s.easing;
    editor.hslDir     = s.hslDir;
    editor.hueShift   = s.hueShift ?? 0;
    editor.antiRepeat = s.antiRepeat;
    editor.tint       = { ...s.tint };
    editor.envelope   = { ...s.envelope };
    editor.selStop    = s.selStop;
    editor.nextId     = s.nextId;
}

// reactive state ────────────────────────────────────────────────────

export const historyEntries = $state({ list: [] });
export const undoState      = $state({ canUndo: false, canRedo: false });

// editorState singleton ─────────────────────────────────────────────

const _es = createEditorState({
    getSnapshot:     snapState,
    applySnapshot:   applyState,
    afterRestore:    () => {},
    onToast:         showToast,
    onHistoryChange: entries => { historyEntries.list = [...entries]; },
    onStackChange:   () => {
        undoState.canUndo = _es.canUndo();
        undoState.canRedo = _es.canRedo();
    },
});

// exports ───────────────────────────────────────────────────────────

export function pushUndo()         { _es.pushUndo(); }
export function undo()             { _es.undo(); }
export function redo()             { _es.redo(); }
export function pushHistory(entry) { _es.pushHistory(entry); }
export function clearHistory()     { _es.clearHistory(); }