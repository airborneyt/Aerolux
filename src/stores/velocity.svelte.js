// src/stores/velocity.svelte.js
import { DEFAULT_PALETTE, rgbToLab } from '../lib/aerolux/palette.js';
import { buildGradient } from '../lib/aerolux/gradient.js';

export const editor = $state({
    palette: DEFAULT_PALETTE.map((c, i) => ({ i, r: c[0], g: c[1], b: c[2] })),
    paletteLabCache: null,
    sortMode:        'original',
    swatchOrder:     [],

    stops:      [{ id: 0, pos: 0, ci: 1 }, { id: 1, pos: 1, ci: 48 }],
    nextId:     2,
    selStop:    0,
    steps:      16,
    algorithm:  'rgb',
    easing:     'linear',
    hslDir:     'shortest',
    hueShift:   0,
    antiRepeat: true,

    envelope: { shape: 'none', attack: 0.2, release: 0.2, floor: 0.0 },
    tint:     { ci: null, str: 0, fade: null },
    pickingTint: false,
});

const _gradResult = $derived.by(() => {
    if (!editor.paletteLabCache) {
        editor.paletteLabCache = editor.palette.map(c => rgbToLab(c.r, c.g, c.b));
    }
    return buildGradient(
        editor.stops, editor.palette, editor.algorithm, editor.easing,
        editor.steps, editor.tint, editor.envelope, editor.antiRepeat,
        editor.hueShift, editor.hslDir, editor.paletteLabCache
    );
});

export function gradResult()   { return _gradResult; }

export function repeatSteps() {
    const gr = gradResult();
    const out = [];
    for (let i = 1; i < gr.length; i++)
        if (gr[i].velocity === gr[i - 1].velocity) out.push(i);
    return out;
}

export function sortStopsInPlace() {
    editor.stops.sort((a, b) => a.pos - b.pos);
}

export function invalidatePaletteCache() {
    editor.paletteLabCache = null;
}

export function resetVelocityState() {
    editor.palette = DEFAULT_PALETTE.map((c, i) => ({ i, r: c[0], g: c[1], b: c[2] }));
    editor.paletteLabCache = null;
    editor.sortMode = 'original';
    editor.swatchOrder = [];

    editor.stops = [{ id: 0, pos: 0, ci: 1}, { id: 1, pos: 1, ci: 48 }];
    editor.nextId = 2;
    editor.selStop = 0;
    editor.steps = 16;
    editor.algorithm = 'rgb';
    editor.easing = 'linear';
    editor.hslDir = 'shortest';
    editor.hueShift = 0;
    editor.antiRepeat = true;

    editor.envelope = { shape: 'none', attack: 0.2, release: 0.2, floor: 0.0 };
    editor.tint = { ci: null, str: 0, fade: null };
    editor.pickingTint = false;
}