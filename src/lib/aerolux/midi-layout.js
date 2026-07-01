// src/lib/aerolux/midi-layout.js
// Launchpad coordinate model: pads, edges, and the logo/mode corner
//
// coordinate system:
//   x = 0 (left edge)   → 9 (right edge)
//   y = 0 (bottom edge) → 9 (top edge)
//   main grid occupies x = 1..8, y = 1..8 (bottom-left origin)
//   edges occupy x = 0 or x = 9 or y = 0 or y = 9 (one axis only)
//   the top-right corner (9,9) hosts two virtual cells; 'logo' and
//   'mode' — which share one physical light. See LOGO_MODE below.

export const ZONE = {
  MAIN:   'main',
  TOP:    'top',
  RIGHT:  'right',
  LEFT:   'left',
  BOTTOM: 'bottom',
  LOGO:   'logo',
  MODE:   'mode',
};

// device profiles: determining which edges physically exist ─────────

export const DEVICE_PROFILES = {
  LPX:  { top: true, right: true, left: false, bottom: false },
  LPP2: { top: true, right: true, left: true,  bottom: true  },
  LPP3: { top: true, right: true, left: true,  bottom: true  },
};

// main grid export-note table (DAW drum-rack arrangement) ───────────
// row 0 = bottom row (y=1), matching the coordinate system above
// source: LPP3 "DAW Drumrack" reference from Focusrite

const DRUM_RACK_GRID_NOTES = [
  [36, 37, 38, 39, 68, 69, 70, 71],
  [40, 41, 42, 43, 72, 73, 74, 75],
  [44, 45, 46, 47, 76, 77, 78, 79],
  [48, 49, 50, 51, 80, 81, 82, 83],
  [52, 53, 54, 55, 84, 85, 86, 87],
  [56, 57, 58, 59, 88, 89, 90, 91],
  [60, 61, 62, 63, 92, 93, 94, 95],
  [64, 65, 66, 67, 96, 97, 98, 99],
];

// edge export-note ranges ───────────────────────────────────────────
// shared logo/mode cell uses note 27. corners are export-omitted

const EXPORT_NOTES = {
  logoMode: 27,
  top:    [28, 29, 30, 31, 32, 33, 34, 35],   // left → right
  right:  [100, 101, 102, 103, 104, 105, 106, 107], // top → bottom
  left:   [108, 109, 110, 111, 112, 113, 114, 115], // top → bottom
  bottom: [116, 117, 118, 119, 120, 121, 122, 123], // left → right
  // 124-127 reserved for the LPP3 second bottom row, once measured
};

// live SysEx pad numbers ────────────────────────────────────────────
// main grid: (row+1)*10 + (col+1), bottom-left origin. this matches the
// existing indexAt()/buildSysexData() convention

function mainSysexPad(x, y) {
  return y * 10 + x; // x,y already 1-indexed here
}

export const EDGE_SYSEX = {
  logoMode: 99,
  top:    [91, 92, 93, 94, 95, 96, 97, 98],  // x=1..8 → left → right
  right:  [19, 29, 39, 49, 59, 69, 79, 89],  // y=1..8 → bottom → top
  left:   [10, 20, 30, 40, 50, 60, 70, 80],  // y=1..8 → bottom → top
  bottom: [1, 2, 3, 4, 5, 6, 7, 8],          // x=1..8 → left → right
};

// grid builder ──────────────────────────────────────────────────────

/**
 * build the full set of addressable cells for a device.
 * each cell: { x, y, zone, sysexPad, exportNote }
 * exportNote is null where the DAW drum-rack mode has no note assigned
 * (corner placeholders only)
 *
 * the logo/mode corner produces two cells at (9,9) — one zone:'logo',
 * one zone:'mode', both sharing sysexPad 99 and exportNote 27
 * use pickLogoOrMode() to choose which one actually drives output
 *
 * @param {string} device 'LPX' | 'LPP2' | 'LPP3'
 * @returns {Array<{x:number,y:number,zone:string,sysexPad:number,exportNote:number|null}>}
 */
export function buildLaunchpadGrid(device = 'LPP2') {
  const profile = DEVICE_PROFILES[device] ?? DEVICE_PROFILES.LPP2;
  const cells = [];

  // main 8x8
  for (let y = 1; y <= 8; y++) {
    for (let x = 1; x <= 8; x++) {
      cells.push({
        x, y,
        zone: ZONE.MAIN,
        sysexPad:   mainSysexPad(x, y),
        exportNote: DRUM_RACK_GRID_NOTES[y - 1][x - 1],
      });
    }
  }

  // top row (y = 9)
  if (profile.top) {
    for (let x = 1; x <= 8; x++) {
      cells.push({
        x, y: 9,
        zone: ZONE.TOP,
        sysexPad:   EDGE_SYSEX.top[x - 1],
        exportNote: EXPORT_NOTES.top[x - 1],
      });
    }
  }

  // right column (x = 9)
  if (profile.right) {
    for (let y = 1; y <= 8; y++) {
      cells.push({
        x: 9, y,
        zone: ZONE.RIGHT,
        sysexPad:   EDGE_SYSEX.right[y - 1],
        exportNote: EXPORT_NOTES.right[y - 1],
      });
    }
  }

  // left column (x = 0)
  if (profile.left) {
    for (let y = 1; y <= 8; y++) {
      cells.push({
        x: 0, y,
        zone: ZONE.LEFT,
        sysexPad:   EDGE_SYSEX.left[y - 1],
        exportNote: EXPORT_NOTES.left[y - 1],
      });
    }
  }

  // bottom row (y = 0)
  if (profile.bottom) {
    for (let x = 1; x <= 8; x++) {
      cells.push({
        x, y: 0,
        zone: ZONE.BOTTOM,
        sysexPad:   EDGE_SYSEX.bottom[x - 1],
        exportNote: EXPORT_NOTES.bottom[x - 1],
      });
    }
  }

  // bottom corners: virtual placeholders, no physical light, export-omitted
  cells.push({ x: 0, y: 0, zone: ZONE.BOTTOM, sysexPad: null, exportNote: null });
  cells.push({ x: 9, y: 0, zone: ZONE.BOTTOM, sysexPad: null, exportNote: null });

  // top-right corner: logo AND mode, both at (9,9), sharing one output
  cells.push({ x: 9, y: 9, zone: ZONE.LOGO, sysexPad: EDGE_SYSEX.logoMode, exportNote: EXPORT_NOTES.logoMode });
  cells.push({ x: 9, y: 9, zone: ZONE.MODE, sysexPad: EDGE_SYSEX.logoMode, exportNote: EXPORT_NOTES.logoMode });

  return cells;
}

// logo / mode selection ─────────────────────────────────────────────

/**
 * given the full cell list and the app's logo/mode setting, return the
 * single cell that should actually drive the shared (9,9) output
 * for both live SysEx and .mid export.
 *
 * @param {Array} cells   - result of buildLaunchpadGrid()
 * @param {'logo'|'mode'} setting
 * @returns {object|undefined}
 */
export function pickLogoOrMode(cells, setting) {
  const zone = setting === 'mode' ? ZONE.MODE : ZONE.LOGO;
  return cells.find(c => c.x === 9 && c.y === 9 && c.zone === zone);
}

// lookups ───────────────────────────────────────────────────────────

/**
 * find a cell by coordinate. For (9,9), pass `logoOrMode` to disambiguate
 * otherwise the 'logo' cell is returned by default.
 *
 * @param {Array} cells
 * @param {number} x
 * @param {number} y
 * @param {'logo'|'mode'} [logoOrMode]
 * @returns {object|undefined}
 */
export function cellAt(cells, x, y, logoOrMode = 'logo') {
  if (x === 9 && y === 9) return pickLogoOrMode(cells, logoOrMode);
  return cells.find(c => c.x === x && c.y === y);
}

/**
 * find a cell by its live SysEx pad number
 * for pad 99 (logo/mode), pass `logoOrMode` to disambiguate
 *
 * @param {Array} cells
 * @param {number} pad
 * @param {'logo'|'mode'} [logoOrMode]
 * @returns {object|undefined}
 */
export function cellBySysexPad(cells, pad, logoOrMode = 'logo') {
  if (pad === EDGE_SYSEX.logoMode) return pickLogoOrMode(cells, logoOrMode);
  return cells.find(c => c.sysexPad === pad);
}

/**
 * find a cell by its .mid export note number
 * for note 27 (logo/mode), pass `logoOrMode` to disambiguate
 *
 * @param {Array} cells
 * @param {number} note
 * @param {'logo'|'mode'} [logoOrMode]
 * @returns {object|undefined}
 */
export function cellByExportNote(cells, note, logoOrMode = 'logo') {
  if (note === EXPORT_NOTES.logoMode) return pickLogoOrMode(cells, logoOrMode);
  return cells.find(c => c.exportNote === note);
}

// SysEx message builder ─────────────────────────────────────────────

/**
 * build a SysEx RGB bulk message from a colour map keyed by coordinate
 *
 * @param {Array} cells               - result of buildLaunchpadGrid()
 * @param {Map<string,[number,number,number]>} colourMap
 *        - keys are "x,y" strings, values are 6-bit [r,g,b]
 * @param {'logo'|'mode'} logoOrMode  - which (9,9) cell drives pad 99
 * @returns {Uint8Array}
 */
export function buildSysexMessage(cells, colourMap, logoOrMode = 'logo') {
  const padData = [];
  const seenPads = new Set();

  for (const cell of cells) {
    if (cell.sysexPad === null) continue;
    if (cell.zone === ZONE.LOGO || cell.zone === ZONE.MODE) {
      const chosen = pickLogoOrMode(cells, logoOrMode);
      if (cell !== chosen) continue;
    }
    if (seenPads.has(cell.sysexPad)) continue;

    const rgb = colourMap.get(`${cell.x},${cell.y}`);
    if (!rgb) continue;

    seenPads.add(cell.sysexPad);
    padData.push(cell.sysexPad, rgb[0], rgb[1], rgb[2]);
  }

  return new Uint8Array([
    0xF0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0B,
    ...padData,
    0xF7,
  ]);
}

// note-name helper (kept from old midi.js) ──────────────────────────
// this is here to keep functionality of old code during migration

export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function noteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 2);
}

// note ↔ grid helpers ───────────────────────────────────────────────

const cells = buildLaunchpadGrid('LPP3');

export function noteToGrid(note) {
    const cell = cellByExportNote(cells, note, 'logo'); // or 'mode'
    return cell ? { x: cell.x, y: cell.y, zone: cell.zone } : null;
}

export function gridToNote({ x, y }, logoOrMode = 'logo') {
  const cell = cellAt(cells, x, y, logoOrMode);
  return cell ? cell.exportNote : null;
}

const GRID_CACHE = {
  LPX: null,
  LPP2: null,
  LPP3: null,
};

function getGrid(device) {
  if (!GRID_CACHE[device]) {
    GRID_CACHE[device] = buildLaunchpadGrid(device);
  }
  return GRID_CACHE[device];
}

export function noteToCell(note, device = 'LPP2') {
  const cells = getGrid(device);

  const cell = cells.find(c => c.exportNote === note);
  if (!cell) return null;

  return {
    zone: cell.zone,
    row: cell.y - 1,  // convert back to old system
    col: cell.x - 1,
  };
}

export function cellToSysex(cell) {
  const { zone, row, col } = cell;

  if (zone === 'main') return (row + 1) * 10 + (col + 1);
  if (zone === 'top') return EDGE_SYSEX.top[col];
  if (zone === 'right') return EDGE_SYSEX.right[row];
  if (zone === 'left') return EDGE_SYSEX.left[row];
  if (zone === 'bottom') return EDGE_SYSEX.bottom[col];
  if (zone === 'corner') return EDGE_SYSEX.logoMode;

  return null;
}

export function noteToSysex(note, device = 'LPP2') {
    const cell = noteToCell(note, device);
    if (!cell) return null;
    return cellToSysex(cell);
}