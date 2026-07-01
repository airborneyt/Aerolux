// src/lib/aerolux/presets.js 
// local preset storage, metadata, and search
// todo: confirm store method

import { toHSL } from './palette.js';
import { parseImportedGradient } from './import-logic.js';

// constants ─────────────────────────────────────────────────────────

const STORAGE_KEY         = 'aerolux_presets';
const DELETED_STORAGE_KEY = 'aerolux_deleted_presets';

export const DELETED_MAX         = 20;
export const DELETED_EXPIRY_DAYS = 30;

export const COLOUR_TAGS    = new Set(['red','orange','yellow','green','blue','purple','pink','white','black']);
export const MODIFIER_TAGS  = new Set(['bright','muted','dim','dark','deep','pastel']);
export const ALGORITHM_TAGS = new Set(['rgb','lab','hsl','vivid','stepped']);
export const EASING_TAGS    = new Set(['linear','easeIn','easeOut','sCurve','cubicIn','cubicOut',
                                        'sineIn','sineOut','sineBoth','expoIn','expoOut','bounce','elastic']);
export const DIRECTION_TAGS = new Set(['shortest','longest']);

// id generation ─────────────────────────────────────────────────────

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// colour tagging ────────────────────────────────────────────────────

function getColourTags(paletteEntry, paletteIndex) {
    // greyscale range — indices 1-7
    if (paletteIndex >= 1 && paletteIndex <= 7) {
        return paletteIndex === 7 ? ['black'] : ['white'];
    }

    const { h, l } = toHSL(paletteEntry.r, paletteEntry.g, paletteEntry.b);

    // hue bucket
    let hue;
    if (h >= 0.95 || h < 0.05) { hue = 'red'; }
    else if (h < 0.13)          { hue = 'orange'; }
    else if (h < 0.21)          { hue = 'yellow'; }
    else if (h < 0.45)          { hue = 'green'; }
    else if (h < 0.68)          { hue = 'blue'; }
    else if (h < 0.85)          { hue = 'purple'; }
    else                        { hue = 'pink'; }

    // brightness band
    let brightness;
    if      (l >= 0.45) { brightness = 'bright'; }
    else if (l >= 0.30) { brightness = 'muted'; }
    else if (l >= 0.18) { brightness = 'dim'; }
    else                { brightness = 'dark'; }

    // palette region
    const variant = paletteIndex >= 68 ? 'pastel' : 'deep';

    return [
        `${hue}-${brightness}`,
        `${hue}-${variant}`,
    ];
}

// meta builder ──────────────────────────────────────────────────────

export function buildMeta(state, gradResult, palette, paletteMeta = null) {
    const paletteTags = Array.from(new Set((gradResult ?? []).flatMap(g => {
        const entry = palette?.[g.velocity];
        if (!entry) return [];
        return getColourTags(entry, g.velocity);
    })));

    return {
        length:               gradResult.length,
        algorithm:            state.algorithm,
        easing:               state.easing,
        hslDir:               state.hslDir,
        hueShift:             state.hueShift ?? 0,
        envelopeShape:        state.envelope.shape,
        hasBrightnessEnvelope: state.envelope.shape !== 'none',
        hasWhiteStart:        gradResult[0]?.velocity >= 1 && gradResult[0]?.velocity <= 7,
        tint: state.tint.ci !== null && state.tint.str > 0
            ? { ci: state.tint.ci, str: state.tint.str }
            : null,
        colourTags: paletteTags,
        velocities: gradResult.map(g => g.velocity),
        paletteMeta: paletteMeta ?? null,
    };
}

// storage helpers ───────────────────────────────────────────────────

import { presetsStore } from './store.js';

async function readStorage(key) {
    try {
        const val = await presetsStore.get(key);
        return val ?? [];
    } catch {
        return [];
    }
}

async function writeStorage(key, data) {
    try {
        await presetsStore.set(key, data);
        return { ok: true };
    } catch (e) {
        console.error('Aerolux storage write failed:', e);
        return { ok: false, reason: 'Could not save. Storage unavailable.'};
    }
}

// main preset CRUD ──────────────────────────────────────────────────

export async function savePreset(name, state, gradResult, palette) {
    const presets = await readStorage(STORAGE_KEY);

    const incoming = JSON.stringify(gradResult.map(g => g.velocity));
    const duplicate = presets.find(p =>
        JSON.stringify(p.meta?.velocities) === incoming
    ) ?? null;

    const preset = {
        id:      generateId(),
        name:    name.trim(),
        savedAt: Date.now(),
        author:  null,
        state: {
            stops:     JSON.parse(JSON.stringify(state.stops)),
            steps:     state.steps,
            algorithm: state.algorithm,
            easing:    state.easing,
            hslDir:    state.hslDir,
            hueShift:  state.hueShift ?? 0,
            tint:      { ...state.tint },
            envelope:  { ...state.envelope },
        },
        meta: buildMeta(state, gradResult, palette, null),
    };

    presets.unshift(preset);
    const result = await writeStorage(STORAGE_KEY, presets);

    return {
        preset,
        duplicate,
        storageError: result.ok ? null : result.reason,
        countWarning: presets.length >= 30
            ? `You have ${presets.length} saved presets. Consider exporting a backup.`
            : null,
    };
}

export async function loadPresets() {
    return readStorage(STORAGE_KEY);
}

export async function deletePreset(id) {
    const updated = (await readStorage(STORAGE_KEY)).filter(p => p.id !== id);
    await writeStorage(STORAGE_KEY, updated);
}

export async function updatePreset(id, changes) {
    const presets = await readStorage(STORAGE_KEY);
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return { ok: false, reason: 'Preset not found' };
    presets[idx] = { ...presets[idx], ...changes };
    return writeStorage(STORAGE_KEY, presets);
}

// soft delete / recently deleted ────────────────────────────────────

export async function softDeletePreset(id, origin = 'local') {
    const presets = await readStorage(STORAGE_KEY);
    const preset  = presets.find(p => p.id === id);
    if (!preset) return;

    const deleted      = await readStorage(DELETED_STORAGE_KEY);
    const deletedEntry = { ...preset, deletedAt: Date.now(), origin };

    if (deleted.length >= DELETED_MAX) deleted.pop();
    deleted.unshift(deletedEntry);

    await writeStorage(STORAGE_KEY, presets.filter(p => p.id !== id));
    await writeStorage(DELETED_STORAGE_KEY, deleted);
}

export async function loadDeletedPresets() {
    return readStorage(DELETED_STORAGE_KEY);
}

export async function restorePreset(id) {
    const deleted = await readStorage(DELETED_STORAGE_KEY);
    const preset  = deleted.find(p => p.id === id);
    if (!preset) return;

    const { deletedAt, origin, ...restored } = preset;
    const presets = await readStorage(STORAGE_KEY);
    presets.unshift(restored);

    await writeStorage(STORAGE_KEY, presets);
    await writeStorage(DELETED_STORAGE_KEY, deleted.filter(p => p.id !== id)); 
}

export async function permanentDeletePreset(id) {
    const updated = (await readStorage(DELETED_STORAGE_KEY)).filter(p => p.id !== id);
    await writeStorage(DELETED_STORAGE_KEY, updated);
}

export async function purgeExpiredDeleted() {
    const expiryMs = DELETED_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const now      = Date.now();
    const valid    = (await readStorage(DELETED_STORAGE_KEY))
        .filter(p => now - p.deletedAt < expiryMs);
    await writeStorage(DELETED_STORAGE_KEY, valid);
}

// search ────────────────────────────────────────────────────────────

export function searchPresets(activeTags, presets) {
    if (!activeTags.length) return presets;

    const activeColours = activeTags.filter(t => COLOUR_TAGS.has(t) || /^palette_/.test(t));
    const activeMods    = activeTags.filter(t => MODIFIER_TAGS.has(t));
    const activeAlgos   = activeTags.filter(t => ALGORITHM_TAGS.has(t));
    const activeEasings = activeTags.filter(t => EASING_TAGS.has(t));
    const activeDirs    = activeTags.filter(t => DIRECTION_TAGS.has(t));
    const activeEnvs    = activeTags.filter(t => ENVELOPE_TAGS.has(t));
    const activeLength  = activeTags.find(t => /^\d+$/.test(t));

    return presets.filter(preset => {
        const meta = preset.meta ?? {};
        const colourTags = Array.isArray(meta.colourTags) ? meta.colourTags : [];

        // colour + modifier logic
        let colourPass;
        if (!activeColours.length && !activeMods.length) {
            colourPass = true;
        } else if (!activeColours.length) {
            // only modifiers act as main tags
            colourPass = colourTags.some(tag => {
                const [, tagMod] = tag.split('-');
                return activeMods.some(m => tagMod === m);
            });
        } else {
            // if colours are present, modifiers narrow within matched colours
            colourPass = colourTags.some(tag => {
                const [tagColour, tagMod] = tag.split('-');
                const colourMatch   = activeColours.some(c => c.startsWith('palette_') ? tag === c : tagColour === c);
                const modifierMatch = activeMods.length === 0 ||
                    activeMods.every(m => tagMod === m);
                return colourMatch && modifierMatch;
            });
        }

        // independent tag checks
        const algoPass   = activeAlgos.length === 0   || activeAlgos.includes(meta.algorithm);
        const easingPass = activeEasings.length === 0 || activeEasings.includes(meta.easing);
        const dirPass    = activeDirs.length === 0    || activeDirs.includes(meta.hslDir);
        const lengthPass = !activeLength               || String(meta.length) === activeLength;
        const envPass    = activeEnvs.length === 0    || activeEnvs.includes(meta.envelope);

        return colourPass && algoPass && easingPass && dirPass && lengthPass && envPass;
    });
}

// envelope tags ─────────────────────────────────────────────────────

export const ENVELOPE_TAGS = new Set([
    'env_none','env_fade_in','env_fade_out','env_fade_both','env_bell','env_valley'
]);

// sort ──────────────────────────────────────────────────────────────

// sortMode: 'newest' | 'oldest' | 'alpha'
export function sortPresets(presets, sortMode = 'newest') {
    const copy = [...presets];
    if (sortMode === 'newest') return copy.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    if (sortMode === 'oldest') return copy.sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
    if (sortMode === 'alpha')  return copy.sort((a, b) => a.name.localeCompare(b.name));
    return copy;
}

// rename ────────────────────────────────────────────────────────────

// returns { ok: true } or { ok: false, reason: string }
export async function renamePreset(id, newName) {
    const trimmed = newName.trim();
    if (!trimmed) return { ok: false, reason: 'Name cannot be empty' };
    const presets = await readStorage(STORAGE_KEY);
    const idx = presets.findIndex(p => p.id === id);
    if (idx === -1) return { ok: false, reason: 'Preset not found' };
    presets[idx] = { ...presets[idx], name: trimmed };
    return writeStorage(STORAGE_KEY, presets);
}

// export / import ───────────────────────────────────────────────────

// returns a JSON string ready for download
export async function exportPresetsJSON() {
    const presets = await readStorage(STORAGE_KEY);
    return JSON.stringify({
        _aerolux: true,
        version:  1,
        exported: Date.now(),
        presets,
    }, null, 2);
}

function isPresetLike(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && typeof value.name === 'string' && value.name.trim().length > 0
        && value.state && typeof value.state === 'object';
}

function extractPresetCandidates(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    if (Array.isArray(parsed.presets)) return parsed.presets;
    if (isPresetLike(parsed)) return [parsed];
    return null;
}

function buildPresetFromGradientText(text, fallbackName = 'Imported gradient', palette = null) {
    const result = parseImportedGradient(text, 128, 0);
    const name = fallbackName.trim() || 'Imported gradient';
    const stops = result.stops.map(stop => ({ ...stop }));
    const steps = Math.max(2, Math.min(16, result.steps));
    const velocities = stops.map(stop => stop.ci);
    const state = {
        stops,
        steps,
        algorithm: 'rgb',
        easing: 'linear',
        hslDir: 'shortest',
        hueShift: 0,
        tint: { ci: null, str: 0 },
        envelope: { shape: 'none', amount: 0 },
    };
    const gradResult = velocities.map((velocity, index) => ({
        step: index,
        velocity,
    }));
    const meta = buildMeta(state, gradResult, palette ?? Array.from({ length: 128 }, () => ({ r: 0, g: 0, b: 0 })), palette ? { source: 'custom', palette: palette.map(c => [c.r, c.g, c.b]) } : null);

    return {
        id: generateId(),
        name,
        savedAt: Date.now(),
        author: null,
        state,
        meta: {
            ...meta,
            length: steps,
            velocities,
        },
    };
}

function normalizeImportedPreset(preset, palette = null) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return preset;

    const state = preset.state && typeof preset.state === 'object'
        ? {
            stops: Array.isArray(preset.state.stops) ? preset.state.stops.map(stop => ({ ...stop })) : [],
            steps: preset.state.steps ?? 2,
            algorithm: preset.state.algorithm ?? 'rgb',
            easing: preset.state.easing ?? 'linear',
            hslDir: preset.state.hslDir ?? 'shortest',
            hueShift: preset.state.hueShift ?? 0,
            tint: preset.state.tint ?? { ci: null, str: 0 },
            envelope: preset.state.envelope ?? { shape: 'none', amount: 0 },
        }
        : null;

    if (!state) return preset;

    const velocities = Array.isArray(preset.meta?.velocities) && preset.meta.velocities.length
        ? preset.meta.velocities
        : state.stops.map(stop => stop.ci).filter(value => Number.isFinite(value));

    const gradResult = velocities.map((velocity, index) => ({ step: index, velocity }));
    const basePalette = palette ?? Array.from({ length: 128 }, () => ({ r: 0, g: 0, b: 0 }));
    const build = buildMeta(state, gradResult, basePalette, palette ? { source: 'custom', palette: basePalette.map(c => [c.r, c.g, c.b]) } : null);

    return {
        ...preset,
        state,
        meta: {
            ...(preset.meta && typeof preset.meta === 'object' ? preset.meta : {}),
            ...build,
            length: state.steps,
            algorithm: preset.meta?.algorithm ?? state.algorithm ?? build.algorithm,
            easing: preset.meta?.easing ?? state.easing ?? build.easing,
            hslDir: preset.meta?.hslDir ?? state.hslDir ?? build.hslDir,
            hueShift: preset.meta?.hueShift ?? state.hueShift ?? build.hueShift,
            envelopeShape: preset.meta?.envelopeShape ?? state.envelope?.shape ?? build.envelopeShape,
            hasBrightnessEnvelope: preset.meta?.hasBrightnessEnvelope ?? (state.envelope?.shape ?? 'none') !== 'none',
            hasWhiteStart: preset.meta?.hasWhiteStart ?? ((velocities[0] ?? 0) >= 1 && (velocities[0] ?? 0) <= 7),
            tint: preset.meta?.tint ?? (state.tint?.ci !== null && state.tint?.str > 0 ? { ci: state.tint.ci, str: state.tint.str } : null),
            colourTags: Array.isArray(preset.meta?.colourTags) && preset.meta.colourTags.length
                ? preset.meta.colourTags
                : build.colourTags,
            velocities,
        },
    };
}

// merges imported presets, skipping any whose ID already exists.
// accepts the consolidated export shape, a single preset object,
// or plain-text Aerolux gradient files.
// returns { imported, skipped, storageError }
export async function clearAllPresets() {
    const presetsResult = await writeStorage(STORAGE_KEY, []);
    if (!presetsResult.ok) return presetsResult;

    const deletedResult = await writeStorage(DELETED_STORAGE_KEY, []);
    return deletedResult.ok ? { ok: true } : deletedResult;
}

export async function importPresetsJSON(jsonString, fallbackName = 'Imported gradient', palette = null) {
    let parsed;
    try {
        parsed = JSON.parse(jsonString);
    } catch {
        const preset = buildPresetFromGradientText(jsonString, fallbackName, palette);
        const existing = await readStorage(STORAGE_KEY);
        const existingIds = new Set(existing.map(p => p.id));

        if (existingIds.has(preset.id)) {
            return { imported: 0, skipped: 1, storageError: null };
        }

        existing.push(preset);
        existing.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
        const result = await writeStorage(STORAGE_KEY, existing);
        return {
            imported: 1,
            skipped: 0,
            storageError: result.ok ? null : result.reason,
        };
    }

    const candidates = extractPresetCandidates(parsed);
    if (!candidates) {
        throw new Error('File does not look like an Aerolux preset export, preset object, or gradient text');
    }

    const existing = await readStorage(STORAGE_KEY);
    const existingIds = new Set(existing.map(p => p.id));

    let imported = 0;
    let skipped  = 0;

    for (const rawPreset of candidates) {
        if (!isPresetLike(rawPreset)) { skipped++; continue; }

        const preset = normalizeImportedPreset({
            ...rawPreset,
            id: rawPreset.id ?? generateId(),
            name: rawPreset.name.trim(),
            savedAt: rawPreset.savedAt ?? Date.now(),
        });

        if (existingIds.has(preset.id)) { skipped++; continue; }

        existing.push(preset);
        existingIds.add(preset.id);
        imported++;
    }

    existing.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));

    const result = await writeStorage(STORAGE_KEY, existing);
    return {
        imported,
        skipped,
        storageError: result.ok ? null : result.reason,
    };
}
