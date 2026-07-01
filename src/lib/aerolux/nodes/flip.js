// src/lib/aerolux/nodes/flip.js
// Flips light effects.
// Pure JS — no DOM, no Svelte.

import { buildLaunchpadGrid } from '../midi-layout.js';

// ── Layout helpers ────────────────────────────────────────────────
// Main grid: row 0 = bottom, row 7 = top, col 0 = left, col 7 = right
// MIDI note from (row, col):
//   col < 4  → 36 + row*4 + col
//   col >= 4 → 68 + row*4 + (col-4)

function flipHorizontal(cell) {
    return {
        x: 9 - cell.x,
        y: cell.y,
    };
}

function flipVertical(cell) {
    return {
        x: cell.x,
        y: 9 - cell.y,
    };
}


// main processor
/**
 * @param {object[]} noteOns   - array of { absTime, noteNum, velocity }
 * @param {object}   params    - { degrees, algorithm, fillGaps }
 * @param {object}   context   - used for device
 * @returns {object[]}
 */
export function processFlip(noteOns, params, context) {
    const {
        axis = 'horizontal',
    } = params;

    const cells = buildLaunchpadGrid(context.device ?? 'LPP2');

    const mapped = [];

    for (const ev of noteOns) {

        const cell = cells.find(c => c.exportNote === ev.noteNum);
        if (!cell) {
            mapped.push(ev);
            continue;
        }

        let dest;

        switch (axis) {
            case 'horizontal':
                dest = flipHorizontal(cell);
                break;

            case 'vertical':
                dest = flipVertical(cell);
                break;

            default:
                dest = flipHorizontal(cell);
                break;
        }

        if (!dest) {
            mapped.push(ev);
            continue;
        }

        const target = cells.find(
            c => c.x === dest.x && c.y === dest.y
        );

        const newNote = target?.exportNote;

        if (newNote == null) {
            mapped.push(ev);
            continue;
        }

        mapped.push({
            ...ev,
            noteNum: newNote,
        });
    }

    mapped.sort((a, b) => a.absTime - b.absTime);
    return mapped;
}
