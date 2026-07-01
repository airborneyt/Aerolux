// Utility: find the nearest unoccupied pad to an ideal floating position
// Uses the provided `cells` array so device layouts (non-10x10) are respected.
export function findNearestUnoccupied(cells, occupiedSet, idealRow, idealCol) {
    let best = null;
    let bestD = Infinity;
    for (const cell of cells) {
        if (cell.exportNote == null || cell.sysexPad == null) continue;
        const key = `${cell.y},${cell.x}`;
        if (occupiedSet.has(key)) continue;
        const d = (cell.y - idealRow) ** 2 + (cell.x - idealCol) ** 2;
        if (d < bestD) {
            bestD = d;
            best = cell;
        }
    }
    return best;
}
