// src/lib/aerolux/aerolux-init.svelte.js
// this is the backdoor to the api and exposes all its functions to plugins

import { editor, gradResult } from '../../stores/velocity.svelte.js'
import { pushUndo, undo, redo, undoState } from '../../stores/velocityActions.svelte.js'
import { gradToText, safeFilename, downloadText } from './utils.js'
import { toHSL, hslToRgb63 } from './palette.js'
import { findNearest } from './gradient.js'
import { createEventEmitter, createAeroluxAPI } from './api.js'

const emitter = createEventEmitter()
export { emitter };

const history = { pushUndo, undo, redo, undoState }
const utils = { gradToText, safeFilename, downloadText }
const colourTools = { toHSL, hslToRgb63, findNearest }

const aerolux = createAeroluxAPI(editor, gradResult, history, emitter, utils, colourTools)

window.Aerolux = aerolux

/* calls the api */

let previous = { 
	algorithm: 'rgb', 
    steps: 16, 
    easing: 'linear', 
    hslDir: 'shortest', 
    hueShift: 0, 
    tint: JSON.stringify({ ci: null, str: 0, fade: null }), 
    envelope: JSON.stringify({shape: 'none', attack: 0.2, release: 0.2, floor: 0.0}), 
    stops: JSON.stringify([{ id: 0, pos: 0, ci: 1 }, { id: 1, pos: 1, ci: 48 }]), 
    antiRepeat: true
}

$effect.root(() => {
    $effect(() => {
        let changed = false
        const current = { algorithm: editor.algorithm, steps: editor.steps, easing: editor.easing, hslDir: editor.hslDir, hueShift: editor.hueShift, antiRepeat: editor.antiRepeat }

        if (current.algorithm !== previous.algorithm) {
            emitter.emit('algorithm:change', { from: previous.algorithm, to: current.algorithm })
            previous.algorithm = current.algorithm
            changed = true
        }
        if (current.steps !== previous.steps) {
            emitter.emit('steps:change', { from: previous.steps, to: current.steps })
            previous.steps = current.steps
            changed = true
        }
        if (current.easing !== previous.easing) {
            emitter.emit('easing:change', {from: previous.easing, to: current.easing })
            previous.easing = current.easing
            changed = true
        }
        if ( current.hslDir !== previous.hslDir ) {
            emitter.emit('hslDir:change', {from: previous.hslDir, to: current.hslDir })
            previous.hslDir = current.hslDir
            changed = true
        }
        if (current.hueShift !== previous.hueShift) {
            emitter.emit('hueShift:change', { from: previous.hueShift, to: current.hueShift })
            previous.hueShift = current.hueShift
            changed = true
        }
        if (current.antiRepeat !== previous.antiRepeat) {
            emitter.emit('antiRepeat:change', { from: previous.antiRepeat, to: current.antiRepeat })
            previous.antiRepeat = current.antiRepeat
            changed = true
        }
        const currentTintStr = JSON.stringify(editor.tint)
        if (currentTintStr !== previous.tint) {
            emitter.emit('tint:change', { tint: editor.tint })
            previous.tint = currentTintStr
            changed = true
        }
        const currentEnvelopeStr = JSON.stringify(editor.envelope)
        if (currentEnvelopeStr !== previous.envelope) {
            emitter.emit('envelope:change', { envelope: editor.envelope })
            previous.envelope = currentEnvelopeStr
            changed = true
        }
        const currentStopsStr = JSON.stringify(editor.stops)
        if (currentStopsStr !== previous.stops) {
            emitter.emit('stops:change', { stops: editor.stops })
            previous.stops = currentStopsStr
            changed = true
        }
        if (changed === true) { 
            emitter.emit('gradient:change', aerolux.read.getState())
        }
    })
})    