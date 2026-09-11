// project-velocity.js
// pure serialisation between editor.svelte.js state and the
// VelocityState shape stored inside .alx project files.

import { DEFAULT_PALETTE } from './palette.js';

// defaults ──────────────────────────────────────────────────────────
// mirrors the initial shape of editor.svelte.js so newProject() and
// missing-field fallbacks stay in one place.

export function defaultVelocityState() {
  return {
    stops:      [{ id: 0, pos: 0, ci: 1 }, { id: 1, pos: 1, ci: 48 }],
    nextId:     2,
    selStop:    0,
    steps:      16,
    algorithm:  'rgb',
    easing:     'linear',
    hslDir:     'shortest',
    hueShift:   0,
    antiRepeat: true,
    envelope:   { shape: 'none', attack: 0.2, release: 0.2, floor: 0.0 },
    tint:       { ci: null, str: 0, fade: null },
    sortMode:   'original',
    swatchOrder: [],
    palette:    null, // null = use palette. Embedded array when custom.
  };
}

// serialise: editor store → VelocityState ───────────────────────────
// excludes transient UI-only fields: pickingTint, paletteLabCache.
// palette is only embedded if it differs from DEFAULT_PALETTE (by
// reference shape comparison), keeping saved files small for the
// common case.

function isDefaultPalette(palette) {
  if (!Array.isArray(palette) || palette.length !== palette.length) return false;
  return palette.every((c, i) =>
    c.r === palette[i][0] &&
    c.g === palette[i][1] &&
    c.b === palette[i][2]
  );
}

export function serializeVelocityState(editor) {
  return {
    stops:      JSON.parse(JSON.stringify(editor.stops)),
    nextId:     editor.nextId,
    selStop:    editor.selStop,
    steps:      editor.steps,
    algorithm:  editor.algorithm,
    easing:     editor.easing,
    hslDir:     editor.hslDir,
    hueShift:   editor.hueShift,
    antiRepeat: editor.antiRepeat,
    envelope:   { ...editor.envelope },
    tint:       { ...editor.tint },
    sortMode:   editor.sortMode,
    swatchOrder: [...editor.swatchOrder],
    palette:    isDefaultPalette(editor.palette)
      ? null
      : editor.palette.map(c => [c.r, c.g, c.b]),
  };
}

// deserialise: VelocityState → partial editor patch ─────────────────
// returns a plain object the caller applies onto the editor $state.
// does not mutate editor directly (keeps this module side-effect free).
// missing/malformed fields fall back to defaults rather than throwing,
// so older or hand-edited .alx files degrade gracefully.

export function deserializeVelocityState(state) {
  const fallback = defaultVelocityState();
  const s = state ?? {};

  const stops = Array.isArray(s.stops) && s.stops.length >= 2
    ? s.stops
    : fallback.stops;

  const paletteData = Array.isArray(s.palette)
    ? s.palette
    : DEFAULT_PALETTE;

  const palette = paletteData.map((c, i) => ({
    i,
    r: c[0],
    g: c[1],
    b: c[2]
  }));

  return {
    stops,
    nextId:     s.nextId     ?? (Math.max(...stops.map(st => st.id)) + 1),
    selStop:    stops.some(st => st.id === s.selStop) ? s.selStop : stops[0].id,
    steps:      clampInt(s.steps, 2, 16, fallback.steps),
    algorithm:  ['rgb','lab','hsl','vivid','stepped'].includes(s.algorithm) ? s.algorithm : fallback.algorithm,
    easing:     typeof s.easing === 'string' ? s.easing : fallback.easing,
    hslDir:     ['shortest','longest'].includes(s.hslDir) ? s.hslDir : fallback.hslDir,
    hueShift:   typeof s.hueShift === 'number' ? s.hueShift : fallback.hueShift,
    antiRepeat: typeof s.antiRepeat === 'boolean' ? s.antiRepeat : fallback.antiRepeat,
    envelope:   { ...fallback.envelope, ...(s.envelope ?? {}) },
    tint:       { ...fallback.tint, ...(s.tint ?? {}) },
    sortMode:   typeof s.sortMode === 'string' ? s.sortMode : fallback.sortMode,
    swatchOrder: Array.isArray(s.swatchOrder) ? s.swatchOrder : fallback.swatchOrder,
    palette,
    paletteLabCache: null, // rebuild lazily
  };
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// validation ────────────────────────────────────────────────────────
// lightweight shape check before attempting deserialisation, so the
// caller (projects store) can show a clear error rather than a stack
// trace if a file is corrupt or not actually a Velocity section.

export function isValidVelocityState(state) {
  return !!state &&
    Array.isArray(state.stops) &&
    state.stops.length >= 2 &&
    typeof state.steps === 'number';
}