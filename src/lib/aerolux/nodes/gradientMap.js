// src/lib/aerolux/nodes/gradientMap.js
// Remaps every velocity in the stream using a gradient from the Velocity editor.
// Three map modes:
//   'velocity' — uses the existing velocity (0-127) as a position into the gradient
//   'position' — uses the spline position stored in context (if a spline is upstream)
//   'time'     — uses absTime normalised to clip duration

/**
 * @param {object[]} noteOns
 * @param {{ gradientRef, mapMode }} params
 * @param {{ gradients, totalDuration, palette }} context
 * @returns {object[]}
 */
export function processGradientMap(noteOns, params, context) {
    const { gradientRef, mapMode = 'velocity' } = params;
    const { gradients = new Map(), totalDuration = 1, palette } = context;

    const gradResult = gradients.get(gradientRef ?? 'current') ?? null;
    if (!gradResult || !gradResult.length) return noteOns;  // pass through if no gradient

    const maxTime = totalDuration || Math.max(...noteOns.map(e => e.absTime), 1);

    return noteOns.map(ev => {
        let position;

        if (mapMode === 'velocity') {
            position = ev.velocity / 127;
        } else if (mapMode === 'time') {
            position = Math.max(0, Math.min(1, ev.absTime / maxTime));
        } else {
            // 'position' mode — fall back to velocity if no spline position tag
            position = ev._splinePosition ?? (ev.velocity / 127);
        }

        const idx      = Math.min(gradResult.length - 1, Math.floor(position * gradResult.length));
        const newVel   = gradResult[idx].velocity;
        return { ...ev, velocity: newVel };
    });
}
