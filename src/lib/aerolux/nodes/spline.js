// src/lib/aerolux/nodes/spline.js
// Spline generator — animates a moving point along a curve through control points.
// Pure JS — no DOM, no Svelte.

// ── Grid helpers (same as rotate.js) ─────────────────────────────

function gridToNote( row, col ) {
    // Inner left half
    if (row >= 1 && row <= 8 && col >= 1 && col <= 4) {
        return 36 + (row - 1) * 4 + (col - 1);
    }
    // Inner right half
    if (row >= 1 && row <= 8 && col >= 5 && col <= 8) {
        return 68 + (row - 1) * 4 + (col - 5);
    }
    // Top row
    if (row === 8 && col >= 0 && col <= 7) {
        return 28 + col;
    }
    // Right side
    if (col === 8 && row >= 0 && row <= 7) {
        return 100 + row;
    }
    // Left side
    if (col === 0 && row >= 0 && row <= 7) {
        return 108 + row;
    }
    // Bottom row
    if (row === 0 && col >= 0 && col <= 7) {
        return 116 + col;
    }
    return null;
}

// ── Spline math ───────────────────────────────────────────────────

/**
 * A control point in the advanced editor carries Bezier handles.
 * Simple editor points have no handles (type: 'corner').
 *
 * ControlPoint: {
 *   col:     number   0–9  (grid column, 0=left side, 9=right side)
 *   row:     number   0–9  (grid row, 0=bottom side, 9=top side)
 *   type:    'corner' | 'smooth' | 'symmetric'
 *   handleIn:  { col, row } | null   — handle toward previous point
 *   handleOut: { col, row } | null   — handle toward next point
 * }
 */

/**
 * Catmull-Rom spline through points with no explicit handles.
 * Used when type === 'corner' or handles are null.
 */
function catmullRomSegment(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return {
        col: 0.5 * (2*p1.col + (-p0.col+p2.col)*t + (2*p0.col-5*p1.col+4*p2.col-p3.col)*t2 + (-p0.col+3*p1.col-3*p2.col+p3.col)*t3),
        row: 0.5 * (2*p1.row + (-p0.row+p2.row)*t + (2*p0.row-5*p1.row+4*p2.row-p3.row)*t2 + (-p0.row+3*p1.row-3*p2.row+p3.row)*t3),
    };
}

/**
 * Cubic Bezier segment from p1 to p2, using p1.handleOut and p2.handleIn as
 * control handles. Falls back to Catmull-Rom if handles are absent.
 */
function bezierSegment(p0, p1, p2, p3, t) {
    // If either handle is missing, fall back to Catmull-Rom
    const h1 = p1.handleOut ?? p1;
    const h2 = p2.handleIn  ?? p2;

    const mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt;
    const t2 = t * t, t3 = t2 * t;
    return {
        col: mt3*p1.col + 3*mt2*t*h1.col + 3*mt*t2*h2.col + t3*p2.col,
        row: mt3*p1.row + 3*mt2*t*h1.row + 3*mt*t2*h2.row + t3*p2.row,
    };
}

/**
 * Sample the full spline and return an array of { col, row } float positions.
 * Each segment uses Bezier if handles are present, Catmull-Rom otherwise.
 *
 * @param {ControlPoint[]} points
 * @param {boolean}        curved    — false = linear segments only
 * @param {number}         nSamples  — total samples across all segments
 * @returns {{ col: number, row: number }[]}
 */
function sampleSpline(points, curved, nSamples = 600) {
    if (points.length < 2) return points.slice();

    const segs = points.length - 1;
    const spp  = Math.max(Math.floor(nSamples / segs), 4);
    const out  = [];

    if (!curved) {
        // Linear only
        for (let i = 0; i < segs; i++) {
            for (let j = 0; j < spp; j++) {
                const t = j / spp;
                out.push({
                    col: points[i].col + t * (points[i+1].col - points[i].col),
                    row: points[i].row + t * (points[i+1].row - points[i].row),
                });
            }
        }
        out.push(points[points.length - 1]);
        return out;
    }

    // Ghost points for Catmull-Rom at endpoints
    const ext = [points[0], ...points, points[points.length - 1]];

    for (let i = 1; i < ext.length - 2; i++) {
        const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
        const hasHandles = p1.handleOut || p2.handleIn;
        for (let j = 0; j < spp; j++) {
            const t = j / spp;
            out.push(hasHandles
                ? bezierSegment(p0, p1, p2, p3, t)
                : catmullRomSegment(p0, p1, p2, p3, t));
        }
    }
    out.push(points[points.length - 1]);
    return out;
}

/**
 * Convert float sample positions to integer pad coords (0–9 range clamped to 0–7
 * for main grid, or 0/9 for side buttons), deduplicate in traversal order.
 */
function snapToPads(samples) {
    const seen = new Set();
    const out  = [];
    for (const s of samples) {
        const col = Math.max(0, Math.min(9, Math.round(s.col)));
        const row = Math.max(0, Math.min(9, Math.round(s.row)));
        const key = `${col},${row}`;
        if (!seen.has(key)) { seen.add(key); out.push({ col, row }); }
    }
    return out;
}

// ── Colour helpers ────────────────────────────────────────────────

function posToVelocity(position, gradResult, solidColour) {
    if (!gradResult?.length) return solidColour ?? 1;
    const idx = Math.min(
        gradResult.length - 1,
        Math.floor(position * gradResult.length)
    );
    return gradResult[idx].velocity;
}

/**
 * Dim a velocity toward black by factor (0 = black, 1 = full).
 * Fast approximation: scale RGB components proportionally then find nearest.
 */
function dimVelocity(velocity, factor, palette) {
    if (!palette?.length || factor >= 1) return velocity;
    const c   = palette[velocity] ?? palette[0];
    const r   = Math.round(c.r * factor);
    const g   = Math.round(c.g * factor);
    const b   = Math.round(c.b * factor);
    let best  = 0, bestD = Infinity;
    for (const pc of palette) {
        if (pc.i === 0) continue;
        const d = Math.abs(pc.r - r) + Math.abs(pc.g - g) + Math.abs(pc.b - b);
        if (d < bestD) { bestD = d; best = pc.i; }
    }
    return best;
}

// ── Main processor ────────────────────────────────────────────────

/**
 * @param {object[]} _noteOns   — ignored (source node)
 * @param {object}   params
 * @param {object}   context    — { device, palette, gradients, totalDuration }
 * @returns {object[]}
 */
export function processSpline(_noteOns, params, context) {
    const {
        controlPoints = [{ col: 1, row: 1, type: 'corner', handleIn: null, handleOut: null },
                         { col: 8, row: 8, type: 'corner', handleIn: null, handleOut: null }],
        curved        = true,
        direction     = 'forward',
        duration      = 96,
        trailLength   = 0,
        trailDecay    = 0.5,
        loop          = true,
        gradientRef   = null,
        solidColour   = 1,
        // Advanced params (from advanced editor, ignored in simple mode)
        tension       = 0.5,    // 0 = straight, 1 = tight Catmull-Rom
        smoothing     = 'catmull-rom', // 'catmull-rom' | 'bezier' | 'cardinal'
    } = params;

    const {
        palette       = [],
        gradients     = new Map(),
        totalDuration = 96 * 8,
    } = context;

    const gradResult = gradients.get(gradientRef ?? 'current') ?? null;

    // Build pad path
    const samples = sampleSpline(controlPoints, curved, 800);
    const padPath = snapToPads(samples);
    if (!padPath.length) return [];

    const pathLen    = padPath.length;
    const clipLen    = totalDuration;
    const passes     = loop ? Math.max(1, Math.ceil(clipLen / duration)) : 1;
    const result     = [];

    for (let pass = 0; pass < passes; pass++) {
        const passStart = pass * duration;

        // Determine traversal order for this pass
        let effectivePath;
        if (direction === 'reverse') {
            effectivePath = [...padPath].reverse();
        } else if (direction === 'pingpong') {
            effectivePath = pass % 2 === 0 ? padPath : [...padPath].reverse();
        } else {
            effectivePath = padPath;
        }

        for (let i = 0; i < effectivePath.length; i++) {
            const pad     = effectivePath[i];
            const absTime = passStart + Math.round((i / Math.max(effectivePath.length - 1, 1)) * duration);
            if (absTime > clipLen) break;

            const note = gridToNote(pad.row, pad.col);
            if (note === null) continue;

            const position = i / Math.max(effectivePath.length - 1, 1);
            const velocity = posToVelocity(position, gradResult, solidColour);

            result.push({ absTime, noteNum: note, velocity, velBytePos: -1 });

            // Trail
            for (let t = 1; t <= trailLength && i - t >= 0; t++) {
                const trailPad  = effectivePath[i - t];
                const trailNote = gridToNote(trailPad.row, trailPad.col);
                if (trailNote === null) continue;

                const decayFactor = trailDecay * (1 - t / (trailLength + 1));
                const trailVel    = dimVelocity(velocity, Math.max(0, decayFactor), palette);
                const trailTime   = Math.max(0, absTime - t);
                result.push({ absTime: trailTime, noteNum: trailNote, velocity: trailVel, velBytePos: -1 });
            }
        }
    }

    result.sort((a, b) => a.absTime - b.absTime);
    return result;
}
