//src/lib/aerolux/nodes/scale.js
// spatial scale transform 
// supports two algorithms, selectable per instance

import { buildLaunchpadGrid } from '../midi-layout.js';
import { findNearestUnoccupied } from './fillGaps.js';

// scaling algorithms ────────────────────────────────────────────────

/**
 * NEAREST NEIGHBOUR : maps each pad to the nearest occupied cell among the four
 * most accurate for integer scale factors
 * no gaps for any scale; slight blurring at non-integer scales
 */

function nearestNeighbourScale(cell, scale) {
    const cx = 4.5, cy = 4.5;
    const dx = cell.x - cx, dy = cell.y - cy;
    const nc = dx * scale + cx;
    const nr = dy * scale + cy;
    return { x: Math.round(nc), y: Math.round(nr) };
}

/**
 * BILINEAR INTERPOLATION : gets the weighted average then snaps
 * smooth scaling for any scale factor
 * gaps can appear at non-integer scales
 */

function bilinearScale(cell, scale) {
    const cx = 4.5, cy = 4.5;
    const dx = cell.x - cx, dy = cell.y - cy;
    const nc = dx * scale + cx;
    const nr = dy * scale + cy;
    // return { x: Math.floor(nc), y: Math.floor(nr) }; For simplicity, we floor the coordinates to the nearest lower integer. In a real implementation, you would calculate the weighted average of the four nearest cells.

    const inputs = [
        { x: Math.floor(nc), y: Math.floor(nr) },
        { x: Math.floor(nc), y: Math.ceil(nr)  },
        { x: Math.ceil(nc),  y: Math.floor(nr) },
        { x: Math.ceil(nc),  y: Math.ceil(nr)  },
    ].filter(c => c.x >= 0 && c.x <= 9 && c.y >= 0 && c.y <= 9);
    if (!inputs.length) return null;

    let totalWeight = 0;
    let avgX = 0;
    let avgY = 0;

    for (const c of inputs) {
        const d2 = (c.x - nc) ** 2 + (c.y - nr) ** 2;
        const w = d2 === 0 ? 1e9 : 1 / d2;
        totalWeight += w;
        avgX += c.x * w;
        avgY += c.y * w;
    }

    return {
        x: Math.round(avgX / totalWeight),
        y: Math.round(avgY / totalWeight)
    };
}

// fill-gap helper–––––––––––––––––––––––––––––––––––––––––––––––─────

/**
 * for a destination grid with gaps, find the nearest unoccupied cell
 * to the ideal float position and assign it
 */

// use `findNearestUnoccupied` from nodes/fillGaps.js which respects the
// device `cells` layout rather than assuming a fixed 10x10 grid.

// main processor ––––––––––––––––––––––––––––––––––––––––––––––––––––
/**
 * @param {object[]} noteOns    - array of {absTime, noteNum, velocity}
 * @param {object}   params     - { scale, algorithm, fillGaps }
 * @param {object}   context    - used for device
 * @returns {object[]}
 */
export function processScale(noteOns, params, context) {
    const {
        scale       = 1,
        algorithm   = 'nearest neighbour',
        fillGaps    = false,
    } = params;

    // base scenario
    if (scale === 1) return noteOns;

    const cells = buildLaunchpadGrid(context.device ?? 'LPP2');
    const occupied  = new Set();
    const mapped    = [];
    const dropped   = [];

    for (const ev of noteOns) {
        const cell = cells.find(c => c.exportNote === ev.noteNum);
        if (!cell) { mapped.push(ev); continue;}

        let dest;
        switch (algorithm) {
            case 'nearest neighbour':   dest = nearestNeighbourScale(cell, scale); break;
            case 'bilinear':            dest = bilinearScale(cell, scale); break;
            default:                    dest = nearestNeighbourScale(cell, scale);
        }

        const cx = 4.5, cy = 4.5;
        const dx = cell.x - cx;
        const dy = cell.y - cy;

        const idealCol = dx * scale + cx;
        const idealRow = dy * scale + cy;

        if (!dest || dest.y < 0 || dest.y > 9 || dest.x < 0 || dest.x > 9) {
            // compute ideal float position for gap fill
            dropped.push({
                ev,
                idealRow,
                idealCol,
            });
            continue;
        }

        const key     = `${dest.y},${dest.x}`;
        const target  = cells.find( c => c.x === dest.x && c.y === dest.y);
        const newNote = target?.exportNote;
        if (newNote == null || occupied.has(key)) {
            dropped.push({
                ev,
                idealRow,
                idealCol,
            });
            continue;
        }

        occupied.add(key);
        mapped.push({ ...ev, noteNum: newNote });
    }

    // gap fill 
    if (fillGaps) {
        for (const { ev, idealRow, idealCol } of dropped) {
            const target = findNearestUnoccupied(cells, occupied, idealRow, idealCol);
            if (!target) continue;
            const newNote = target.exportNote;
            occupied.add(`${target.y},${target.x}`);
            mapped.push({ ...ev, noteNum: newNote });
        }
    }

    mapped.sort((a, b) => a.absTime - b.absTime);
    return mapped;
}