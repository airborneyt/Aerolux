// src/lib/aerolux/kinetic/devicePlacement.js
// ============================================================================
// KINETIC ENGINE: DEVICE AUTO-PLACEMENT
//
// placement heuristic: suggests where a brand-new device should land on
// the stage automatically. once a device has a position (whether
// from this function or from a manual drag in the stage modal) that
// position is just data like any other; this function is never consulted
// again for that device. the stage modal is the only caller.
// ============================================================================

// local grid span (incl. side buttons/corners), canvas units.
export const DEVICE_FOOTPRINT = { width: 10, height: 10 };
export const DEVICE_GAP = 0;

function rotatedFootprint(rotation, footprint) {
    return (rotation === 90 || rotation === 270)
        ? { width: footprint.height, height: footprint.width }
        : { width: footprint.width, height: footprint.height };
}

/**
    packs a new device immediately to the right of whatever's in the current
    bottom row, wrapping to a new row beneath everything once the row would
    exceed `maxRowWidth`.

@param {DeviceInstance[]} existingDevices
@param {{footprint?, gap?, maxRowWidth?, newRotation?}} [opts]
@returns {{x:number, y:number}}
*/
export function computeAutoPosition(existingDevices, opts = {}) {
    const {
        footprint   = DEVICE_FOOTPRINT,
        gap         = DEVICE_GAP,
        maxRowWidth = 44,
        newRotation = 0,
    } = opts;

    if (!existingDevices.length) return { x: 0, y: 0 };

    let maxY = -Infinity;
    for (const d of existingDevices) {
        const fp = rotatedFootprint(d.rotation, footprint);
        maxY = Math.max(maxY, d.position.y + fp.height);
    }

    // "bottom row" = devices whose footprint's bottom edge reaches the
    // overall bounding box's bottom edge.
    const bottomRow = existingDevices.filter(d => {
        const fp = rotatedFootprint(d.rotation, footprint);
        return d.position.y + fp.height >= maxY - 0.001;
    });

    const rowRightEdge = Math.max(...bottomRow.map(d => {
        const fp = rotatedFootprint(d.rotation, footprint);
        return d.position.x + fp.width;
    }));
    const rowTop = Math.min(...bottomRow.map(d => d.position.y));

    const newFp = rotatedFootprint(newRotation, footprint);
    const nextX = rowRightEdge + gap;

    if (nextX + newFp.width <= maxRowWidth) {
        return { x: nextX, y: rowTop };
    }

    // doesn't fit = start a new row beneath everything placed so far.
    return { x: 0, y: maxY + gap };
}