// src/stores/kineticUiSignals.svelte.js
// ============================================================================
// KINETIC ENGINE: EPHEMERAL UI SIGNALS
// cross-component coordination for interactions that need to reach
// across sibling boundaries in KineticPage.svelte's layout (NodeMenu,
// NodeGraph, and NodeInspector).
//
// neither of these is real graph/project data, which is why they live 
// here rather than in kinetic.svelte.js.
//
// drag-from-menu (nodeDragGhost) –––––––––––––––––––––––––––––––––––
// not implemented with the native HTML5 Drag and Drop API
// (draggable="true" + dragstart/dragover/drop). i suspect Tauri's 
// webview intercepts OS-level drag-and-drop at the window level and swallows 
// drop events before they reach the DOM. eitherway the previous HTML5
// method did not work, so this is what is used instead.
// every other drag interaction already in this codebase (NodeGraph's own
// node dragging, StageModal's device dragging, KnobControl, SplinePoints
// Control) uses plain pointerdown/pointermove/pointerup instead, for
// this reason.
//
// NodeGraph.svelte owns the coordinate math (pan/zoom/screenToGraph)
// needed to know where a drop actually lands, so it registers itself here
// as the current drop handler on mount; NodeMenu.svelte calls it directly
// with final screen coordinates on pointerup, rather than duplicating that
// math or routing through a second window-level listener (which would
// create listener-ordering ambiguity with NodeMenu's own pointerup
// cleanup).
//
// ============================================================================

export const nodeDragGhost = $state({
    active: false,
    nodeId: null,
    label:  '',
    icon:   '',
    x:      0,
    y:      0,
});

let dropHandler = null;
// called by NodeGraph.svelte on mount
export function registerDropHandler(fn) { dropHandler = fn; }
export function unregisterDropHandler(fn) { if (dropHandler === fn) dropHandler = null; }

export function startNodeDrag(nodeId, def, x, y) {
    nodeDragGhost.active = true;
    nodeDragGhost.nodeId = nodeId;
    nodeDragGhost.label  = def?.label ?? nodeId;
    nodeDragGhost.icon   = def?.icon ?? '';
    nodeDragGhost.x      = x;
    nodeDragGhost.y      = y;
}

export function updateNodeDrag(x, y) {
    if (!nodeDragGhost.active) return;
    nodeDragGhost.x = x;
    nodeDragGhost.y = y;
}

/**
    ends the drag. if it was actually active (past the move threshold; see
    NodeMenu.svelte) and a drop handler is currently registered, hands it
    the final screen coordinates so NodeGraph can decide for itself whether
    that point landed on its own canvas.
*/
export function endNodeDrag(clientX, clientY) {
    if (nodeDragGhost.active && dropHandler) {
        dropHandler(nodeDragGhost.nodeId, clientX, clientY);
    }
    nodeDragGhost.active = false;
    nodeDragGhost.nodeId = null;
}

let renameRequestHandler = null;
/** Called by NodeInspector.svelte on mount. */
export function registerRenameRequestHandler(fn) { renameRequestHandler = fn; }
export function unregisterRenameRequestHandler(fn) { if (renameRequestHandler === fn) renameRequestHandler = null; }

/**
    asks whichever NodeInspector is currently mounted to enter inline-rename
    mode for `instanceId`. a simple, one-shot signal rather than something
    that could re-trigger itself.

@param {string} instanceId
*/
export function requestRename(instanceId) {
    renameRequestHandler?.(instanceId);
}

// curve reveal –––––––––––––––––––––––––––––––––––––––––––––––––––––
 
let curveRevealHandler = null;
export function registerCurveRevealHandler(fn) { curveRevealHandler = fn; }
export function unregisterCurveRevealHandler(fn) { if (curveRevealHandler === fn) curveRevealHandler = null; }
 
/**
    asks whichever SplinePanel is currently mounted to make `paramKey` on
    `instanceId` the visible, active (editable) curve.

@param {string} instanceId
@param {string} paramKey
*/
export function requestCurveReveal(instanceId, paramKey) {
    curveRevealHandler?.({ instanceId, paramKey });
}