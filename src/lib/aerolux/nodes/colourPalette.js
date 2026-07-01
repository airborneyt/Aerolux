// src/lib/aerolux/nodes/colour_palette.js
import { buildLaunchpadGrid, ZONE } from '../midi-layout.js';

export function processColour(_noteOns, params, context) {
    const { colourIdx = 1, zone = 'all' } = params;
    const cells   = buildLaunchpadGrid(context.device ?? 'LPP2');
    const noteOns = [];
    const ticksPerSec = (context.bpm / 60) * context.timeDiv;
    // Solid colour for the full duration — one event at tick 0 per pad.
    for (const cell of cells) {
        if (cell.exportNote === null || cell.velocity === 0) continue;
        const inZone = (
            zone === 'all'    ||
            (zone === 'main'   && cell.zone === ZONE.MAIN)   ||
            (zone === 'edges'  && cell.zone !== ZONE.MAIN)   ||
            (zone === 'top'    && cell.zone === ZONE.TOP)     ||
            (zone === 'bottom' && cell.zone === ZONE.BOTTOM)  ||
            (zone === 'left'   && cell.zone === ZONE.LEFT)    ||
            (zone === 'right'  && cell.zone === ZONE.RIGHT)
        );
        if (inZone) noteOns.push({ absTime: 0, noteNum: cell.exportNote, velocity: colourIdx });
    }
    return noteOns;
}