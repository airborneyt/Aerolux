// src/lib/aerolux/midi-layout.js
// Launchpad coordinate model: pads, edges, and the logo/mode corner
//
// coordinate system:
//   x = 0 (left edge)   → 9 (right edge)
//   y = 0 (bottom edge) → 9 (top edge)
//   main grid occupies x = 1..8, y = 1..8 (bottom-left origin)
//   edges occupy x = 0 or x = 9 or y = 0 or y = 9 (one axis only)
//
// LOGO vs MODE: on real hardware these share the same export id. they
// are two independent, separately-sample-able positions: LOGO stays at
// its physical spot (9,9); MODE gets its own dedicated position below the
// main grid (4.5,-1), matching where VirtualLP.svelte already drew a
// separate "mode light row" (that duplication is what this file now feeds
// directly. see VirtualLP.svelte's own header comment). content can be
// authored independently for each. only when something needs to talk to
// the ONE real physical output (live SysEx, or a .mid export) does
// a choice have to be made; see resolveLogoModeForExport() below, and
// each cell's `realSysexPad` field, which is what real-hardware code must
// use instead of `sysexPad` for this pair specifically (their `sysexPad`
// values are deliberately DIFFERENT (99 for logo, 100 for mode) so they
// can be sampled/rendered/previewed as separate entries in a
// Map<sysexPad,...>; only `realSysexPad` reflects the true, single,
// shared hardware address both of them ultimately share).

export const ZONE = {
  MAIN:   'main',
  TOP:    'top',
  RIGHT:  'right',
  LEFT:   'left',
  BOTTOM: 'bottom',
  CORNER: 'corner', // non-addressable virtual placeholder (TL/BL/BR)
  LOGO:   'logo',
  MODE:   'mode',
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

// edge export-note ranges ––––––––––––––––––––––––––––––––––––––––––
// shared logo/mode cell uses note 27. corner placeholders are export-omitted

const EXPORT_NOTES = {
  logoMode: 27,
  top:    [28, 29, 30, 31, 32, 33, 34, 35],   // left → right
  right:  [107, 106, 105, 104, 103, 102, 101, 100], // top → bottom
  left:   [115, 114, 113, 112, 111, 110, 109, 108], // top → bottom
  bottom: [116, 117, 118, 119, 120, 121, 122, 123], // left → right
};

// live SysEx pad numbers –––––––––––––––––––––––––––––––––––––––––––
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

// MODE's own dedicated position (see the module doc above) and its
// preview-only sysexPad. 100 is otherwise completely unused by any real
// address in this whole numbering scheme (every real pad number used
// anywhere above tops out at 99), so it's safe to reserve purely for
// letting MODE render/sample as a genuinely separate entry from LOGO.
// NEVER used for real hardware output. see realSysexPad on both cells.
const MODE_LIGHT_POSITION = { x: 4.5, y: -1 };
const MODE_PREVIEW_SYSEX_PAD = 100;

// grid builder –––––––––––––––––––––––––––––––––––––––––––––––––––––

/**
  build the full set of addressable cells for the (single, canonical)
  Launchpad layout. each cell: { x, y, zone, sysexPad, exportNote }, plus
  `realSysexPad` on the logo/mode pair specifically (see module doc).

@returns {Array<{x:number,y:number,zone:string,sysexPad:number|null,exportNote:number|null,realSysexPad?:number}>}
*/
export function buildLaunchpadGrid() {
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
  for (let x = 1; x <= 8; x++) {
    cells.push({
      x, y: 9,
      zone: ZONE.TOP,
      sysexPad:   EDGE_SYSEX.top[x - 1],
      exportNote: EXPORT_NOTES.top[x - 1],
    });
  }

  // right column (x = 9)
  for (let y = 1; y <= 8; y++) {
    cells.push({
      x: 9, y,
      zone: ZONE.RIGHT,
      sysexPad:   EDGE_SYSEX.right[y - 1],
      exportNote: EXPORT_NOTES.right[y - 1],
    });
  }

  // left column (x = 0)
  for (let y = 1; y <= 8; y++) {
    cells.push({
      x: 0, y,
      zone: ZONE.LEFT,
      sysexPad:   EDGE_SYSEX.left[y - 1],
      exportNote: EXPORT_NOTES.left[y - 1],
    });
  }

  // bottom row (y = 0)
  for (let x = 1; x <= 8; x++) {
    cells.push({
      x, y: 0,
      zone: ZONE.BOTTOM,
      sysexPad:   EDGE_SYSEX.bottom[x - 1],
      exportNote: EXPORT_NOTES.bottom[x - 1],
    });
  }

  // corners: TL/BL/BR are virtual placeholders. no physical light exists
  // at any of these three positions on real hardware. they exist purely so
  // a renderer/consumer can treat the addressable area as a clean 10x10
  // square without special-casing "there's nothing there".
  cells.push({ x: 0, y: 9, zone: ZONE.CORNER, sysexPad: null, exportNote: null }); // TL
  cells.push({ x: 0, y: 0, zone: ZONE.CORNER, sysexPad: null, exportNote: null }); // BL
  cells.push({ x: 9, y: 0, zone: ZONE.CORNER, sysexPad: null, exportNote: null }); // BR

  // top-right corner: the real logo light.
  cells.push({
    x: 9, y: 9, zone: ZONE.LOGO,
    sysexPad: EDGE_SYSEX.logoMode, exportNote: EXPORT_NOTES.logoMode,
    realSysexPad: EDGE_SYSEX.logoMode,
  });

  // mode light: its own distinct position (see module doc). sample-able
  // and render-able completely independently of the logo light, but
  // sharing the same real hardware output whenever one has to actually be
  // chosen for real output. `sysexPad` here is preview-only.
  cells.push({
    x: MODE_LIGHT_POSITION.x, y: MODE_LIGHT_POSITION.y, zone: ZONE.MODE,
    sysexPad: MODE_PREVIEW_SYSEX_PAD, exportNote: EXPORT_NOTES.logoMode,
    realSysexPad: EDGE_SYSEX.logoMode,
  });

  return cells;
}

// logo / mode resolution –––––––––––––––––––––––––––––––––––––––––––

/**
  returns the single logo-or-mode cell matching `setting`.

@param {Array} cells
@param {'logo'|'mode'} setting
@returns {object|undefined}
*/
export function pickLogoOrMode(cells, setting) {
  const zone = setting === 'mode' ? ZONE.MODE : ZONE.LOGO;
  return cells.find(c => c.zone === zone);
}

/**
  resolves the logo/mode pair down to whichever one should actually be
  used wherever real hardware output is involved (live SysEx send, or a
  .mid export); they share exactly one physical light on real hardware
  (see this module's header), so exactly one has to win. Every other cell
  passes through unchanged. callers still need to read `realSysexPad`
  (not `sysexPad`) off the surviving cell when they actually build the
  real address/message. see buildSysexMessage below for the pattern.
 
@param {Array} cells
@param {'logo'|'mode'} [logoOrMode]
@returns {Array} cells with the non-chosen logo/mode entry removed
*/
export function resolveLogoModeForExport(cells, logoOrMode = 'logo') {
  const dropZone = logoOrMode === 'mode' ? ZONE.LOGO : ZONE.MODE;
  return cells.filter(c => c.zone !== dropZone);
}

// lookups ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

/**
  find a cell by coordinate.

@param {Array} cells
@param {number} x
@param {number} y
@returns {object|undefined}
*/
export function cellAt(cells, x, y) {
  return cells.find(c => c.x === x && c.y === y);
}

/**
  find a cell by its preview sysex pad number. for real
  hardware output involving the logo/mode pair, resolve via
  resolveLogoModeForExport() first and read `realSysexPad`, not this.

@param {Array} cells
@param {number} pad
@returns {object|undefined}
*/
export function cellBySysexPad(cells, pad) {
  return cells.find(c => c.sysexPad === pad);
}

/**
  find a cell by its .mid export note number. note 27 is shared between
  logo and mode so it needs to be disambiguated.

@param {Array} cells
@param {number} note
@param {'logo'|'mode'} [logoOrMode]
@returns {object|undefined}
*/
export function cellByExportNote(cells, note, logoOrMode = 'logo') {
  if (note === EXPORT_NOTES.logoMode) return pickLogoOrMode(cells, logoOrMode);
  return cells.find(c => c.exportNote === note);
}

// SysEx message builder ––––––––––––––––––––––––––––––––––––––––––––

/**
 * build a SysEx RGB bulk message from a colour map keyed by coordinate.
 * @param {Array} cells               - result of buildLaunchpadGrid()
 * @param {Map<string,[number,number,number]>} colourMap
 *        - keys are "x,y" strings, values are 6-bit [r,g,b]
 * @param {'logo'|'mode'} logoOrMode  - which one actually drives the
 *        shared real pad 99 for this message
 * @returns {Uint8Array}
 */
export function buildSysexMessage(cells, colourMap, logoOrMode = 'logo') {
  const resolved = resolveLogoModeForExport(cells, logoOrMode);
  const padData = [];
  const seenPads = new Set();

  for (const cell of resolved) {
    if (cell.sysexPad === null) continue;
    // logo/mode cells must be sent under their real shared address, not
    // their preview-only sysexPad (100 for mode isn't a real pad at all).
    const realPad = cell.realSysexPad ?? cell.sysexPad;
    if (seenPads.has(realPad)) continue;

    const rgb = colourMap.get(`${cell.x},${cell.y}`);
    if (!rgb) continue;

    seenPads.add(realPad);
    padData.push(realPad, rgb[0], rgb[1], rgb[2]);
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

let cachedGrid = null;

/**
  a single grid, computed once for the whole app's lifetime and shared 
  by every caller. sampleDevice.js's getDeviceGrid() and VirtualLP.svelte's 
  own rendering both read this directly, so the ~103 cell objects are built 
  exactly once total, not once per call site or once per component instance.

  @returns {Array}
*/
export function getCachedGrid() {
  if (!cachedGrid) cachedGrid = buildLaunchpadGrid();
  return cachedGrid;
}

export function noteToGrid(note) {
    const cell = cellByExportNote(getCachedGrid(), note, 'logo');
    return cell ? { x: cell.x, y: cell.y, zone: cell.zone } : null;
}

export function gridToNote({ x, y }) {
  const cell = cellAt(getCachedGrid(), x, y);
  return cell ? cell.exportNote : null;
}

export function noteToCell(note) {
  const cell = getCachedGrid().find(c => c.exportNote === note);
  if (!cell) return null;

  return {
    zone: cell.zone,
    row: cell.y - 1,  // convert back to old system
    col: cell.x - 1,
  };
}

/**
@param {{zone:string,row:number,col:number}} cell
@returns {number|null}
*/
export function cellToSysex(cell) {
  const { zone, row, col } = cell;

  if (zone === ZONE.MAIN) return (row + 1) * 10 + (col + 1);
  if (zone === ZONE.TOP) return EDGE_SYSEX.top[col];
  if (zone === ZONE.RIGHT) return EDGE_SYSEX.right[row];
  if (zone === ZONE.LEFT) return EDGE_SYSEX.left[row];
  if (zone === ZONE.BOTTOM) return EDGE_SYSEX.bottom[col];
  if (zone === ZONE.LOGO || zone === ZONE.MODE) return EDGE_SYSEX.logoMode;

  return null; // corner placeholders: no real address
}

export function noteToSysex(note) {
    const cell = noteToCell(note);
    if (!cell) return null;
    return cellToSysex(cell);
}