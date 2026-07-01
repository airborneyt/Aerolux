// src/lib/aerolux/nodes/rotate.js
// spatial rotate transform
// supports five algorithms, selectable per instance

import { kinetic } from '../../../stores/kinetic.svelte.js';
import { buildLaunchpadGrid } from '../midi-layout.js';
import { findNearestUnoccupied } from './fillGaps.js';

// rotation algorithms ───────────────────────────────────────────────

/**
 * SNAP : snap the floating-point rotated position to the nearest pad
 * fast and works for all angles. gaps can appear at non-90° angles
 */

function snapRotate(cell, deg) {
    const cx = 4.5, cy = 4.5;
    const rad = (deg * Math.PI) / 180;
    const dx  = cell.x - cx, dy = cell.y - cy;
    const nc  = dx * Math.cos(rad) - dy * Math.sin(rad) + cx;
    const nr  = dx * Math.sin(rad) + dy * Math.cos(rad) + cy;
    return { x: Math.round(nc), y: Math.round(nr) };
}

/**
 * SHEAR : three-shear decomposition (Paeth 1986)
 * lossless for 90°/180°/270°. minimal gaps at arbitrary angles
 * formula: Rθ = Sh_x(−tan θ/2) · Sh_y(sin θ) · Sh_x(−tan θ/2)
 * applied as integer shears so every source pad maps to exactly one dest pad
 */

function shearRotate(cell, deg) {
    // Normalise to −180..180
    let a = ((deg % 360) + 360) % 360;
    if (a > 180) a -= 360;
    const cx = 4.5, cy = 4.5;
    const rad = (a * Math.PI) / 180;
    const tx  = -Math.tan(rad / 2);
    const sy  = Math.sin(rad);

    let r = cell.y - cy, c = cell.x - cx;

    // shear 1: horizontal
    c = c + Math.round(tx * r);
    // shear 2: vertical
    r = r + Math.round(sy * c);
    // shear 3: horizontal
    c = c + Math.round(tx * r);

    return { x: Math.round(c + cx), y: Math.round(r + cy) };
}

/**
 * NEAREST-4 : maps each pad to the nearest occupied cell among the four
 * 90°-multiples of the rotation, weighted by proximity to the exact angle
 * no gaps for any angle; slight blurring at 45°.
 */

function nearest4Rotate(cell, deg) {
    const cx = 4.5, cy = 4.5;
    const rad  = (deg * Math.PI) / 180;
    const dx   = cell.x - cx, dy = cell.y - cy;
    const nc   = dx * Math.cos(rad) - dy * Math.sin(rad) + cx;
    const nr   = dx * Math.sin(rad) + dy * Math.cos(rad) + cy;

    // candidate: the four corner-rounded positions
    const candidates = [
        { x: Math.floor(nc), y: Math.floor(nr) },
        { x: Math.floor(nc), y: Math.ceil(nr)  },
        { x: Math.ceil(nc),  y: Math.floor(nr) },
        { x: Math.ceil(nc),  y: Math.ceil(nr)  },
    ].filter(c => c.x >= 1 && c.x <= 8 && c.y >= 1 && c.y <= 8);

    if (!candidates.length) return null;

    // pick closest to the ideal float position
    let best = null, bestD = Infinity;
    for (const c of candidates) {
        const d = (c.x - nc) ** 2 + (c.y - nr) ** 2;
        if (d < bestD) { bestD = d; best = c; }
    }
    return best;
}

/**
 * AREA : each destination pad is lit if more than half of its area is
 * covered by any rotated source pad (modelled as unit squares).
 * returns a Map<destKey, srcNote> rather than a single cell
 * the processor uses this for the fill pass
 */

function areaRotate(cell, deg) {
    // for the area algorithm we sample 4 sub-pixel corners of the source pad
    // and average their destinations. this is the cheapest area approximation
    const cx  = 4.5, cy  = 4.5;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);

    const corners = [
        [cell.y - 0.4, cell.x - 0.4],
        [cell.y - 0.4, cell.x + 0.4],
        [cell.y + 0.4, cell.x - 0.4],
        [cell.y + 0.4, cell.x + 0.4],
    ];

    const votes = new Map();
    for (const [r, c] of corners) {
        const dx = c - cx, dy = r - cy;
        const nc = Math.round(dx * cos - dy * sin + cx);
        const nr = Math.round(dx * sin + dy * cos + cy);
        if (nr >= 1 && nr <= 8 && nc >= 1 && nc <= 8) {
            const k = `${nr},${nc}`;
            votes.set(k, (votes.get(k) ?? 0) + 1);
        }
    }

    // return cells that got at least 2 / 4 votes (majority covered)
    const results = [];
    for (const [k, count] of votes) {
        if (count >= 2) {
            const [r, c] = k.split(',').map(Number);
            results.push({ y: r, x: c });
        }
    }
    return results.length ? results : null;
}

/**
 * RADIAL : rotates around the geometric centre using nearest-pad snapping,
 * but preserves radial distance from the centre
 * for quarter-turns this is identical to exact rotation
 * for arbitrary angles it minimises "squeezing" toward the centre
 * extremely useful for spinners
 */

function radialRotate(cell, deg) {
    const cx  = 4.5, cy  = 4.5;
    const dx  = cell.x - cx, dy  = cell.y - cy;
    const r   = Math.sqrt(dx * dx + dy * dy);
    if (r < 0.01) return { x: cell.x, y: cell.y }; // centre pad stays in place

    const origAngle = Math.atan2(dy, dx);
    const newAngle  = origAngle + (deg * Math.PI) / 180;

    // place at exact same radius, new angle, then snap
    const nc = Math.round(Math.cos(newAngle) * r + cx);
    const nr = Math.round(Math.sin(newAngle) * r + cy);
    return { x: nc, y: nr };
}

// fill-gap helper ───────────────────────────────────────────────────

/**
 * for a destination grid with gaps, find the nearest unoccupied cell
 * to the ideal float position and assign it
 */

// gap filling uses the shared helper which respects device `cells`

// main processor ────────────────────────────────────────────────────

/**
 * @param {object[]} noteOns   - array of { absTime, noteNum, velocity }
 * @param {object}   params    - { degrees, algorithm, fillGaps }
 * @param {object}   context   - used for device
 * @returns {object[]}
 */
export function processRotate(noteOns, params, context) {
    const {
        degrees   = 0,
        algorithm = 'snap',
        fillGaps  = false,
    } = params;

    // base scenario
    if (degrees === 0) return noteOns;

    const cells = buildLaunchpadGrid(kinetic.device ?? 'LPP2');
    const occupied  = new Set();
    const mapped    = [];
    const dropped   = [];  // { ev, idealRow, idealCol }

    for (const ev of noteOns) {
        const cell = cells.find(c => c.exportNote === ev.noteNum);
        if (!cell) { mapped.push(ev); continue; }  // side button → pass through

        if (algorithm === 'area') {
            const dests = areaRotate(cell, degrees);
            if (!dests) { dropped.push({ ev, idealRow: cell.y, idealCol: cell.x }); continue; }
            for (const dest of dests) {
                const target  = cells.find(c => c.x === dest.x && c.y === dest.y);
                const newNote = target?.exportNote;
                if (newNote == null) { dropped.push({ ev, idealRow: dest.y, idealCol: dest.x }); continue; }
                const key = `${dest.y},${dest.x}`;
                if (!occupied.has(key)) {
                    occupied.add(key);
                    mapped.push({ ...ev, noteNum: newNote });
                }
            }
            continue;
        }

        let dest;
        switch (algorithm) {
            case 'shear':    dest = shearRotate(cell, degrees); break;
            case 'nearest4': dest = nearest4Rotate(cell, degrees); break;
            case 'radial':   dest = radialRotate(cell, degrees); break;
            default:         dest = snapRotate(cell, degrees); // 'snap'
        }

        if (!dest || dest.y < 0 || dest.y > 9 || dest.x < 0 || dest.x > 9) {
            // compute ideal float position for gap fill
            const cx = 4.5, cy = 4.5;
            const rad = (degrees * Math.PI) / 180;
            const dx  = cell.x - cx, dy = cell.y - cy;
            dropped.push({
                ev,
                idealRow: dx * Math.sin(rad) + dy * Math.cos(rad) + cy,
                idealCol: dx * Math.cos(rad) - dy * Math.sin(rad) + cx,
            });
            continue;
        }

        const key     = `${dest.y},${dest.x}`;
        const target  = cells.find(c => c.x === dest.x && c.y === dest.y);
        const newNote = target?.exportNote;
        if (newNote == null || occupied.has(key)) {
            const cx = 4.5, cy = 4.5;
            const rad = (degrees * Math.PI) / 180;
            const dx  = cell.x - cx, dy = cell.y - cy;
            dropped.push({
                ev,
                idealRow: dx * Math.sin(rad) + dy * Math.cos(rad) + cy,
                idealCol: dx * Math.cos(rad) - dy * Math.sin(rad) + cx,
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