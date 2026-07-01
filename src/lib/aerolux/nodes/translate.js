// src/lib/aerolux/nodes/translate.js
// Translates light effects in the Launchpad grid.
// Pure JS — no DOM, no Svelte.

import { buildLaunchpadGrid } from '../midi-layout.js';

function translate(cell, deltaRow, deltaCol) {
    return {
        x: cell.x + deltaRow,
        y: cell.y + deltaCol
    };
}

export function processTranslate(noteOns, params, context) {
    const {
        deltaRow = 0,
        deltaCol = 0,
    } = params;
    const cells = buildLaunchpadGrid(context.device ?? 'LPP2');
    const mapped = [];

    for (const ev of noteOns) {
        const cell = cells.find(c=> c.exportNote === ev.noteNum);
        if (!cell) { mapped.push(ev); continue; }

        let dest;
        dest = translate(cell, deltaRow, deltaCol);
        if (!dest) {
            mapped.push(ev);
            continue;
        }

        const target = cells.find(c => c.x === dest.x && c.y === dest.y);
        const newNote = target?.exportNote;
        if (newNote === null) { mapped.push(ev); continue; }

        mapped.push({ ...ev, noteNum: newNote });
    }
    mapped.sort((a, b) => a.absTime - b.absTime);
    return mapped;
}