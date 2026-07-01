<!-- src/components/preset/PresetOverlay.svelte -->
<script>
import { onMount } from 'svelte';
import { editor, gradResult } from '../../stores/velocity.svelte.js';
import { pushUndo } from '../../stores/velocityActions.svelte.js';
import { toHex } from '../../lib/aerolux/palette.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { playSound } from '../../lib/aerolux/sound.js';
import { gradToText, downloadText } from '../../lib/aerolux/utils.js';
import PresetImportModal from '../modals/PresetImportModal.svelte';
import {
    savePreset, loadPresets, softDeletePreset,
    loadDeletedPresets, purgeExpiredDeleted,
    restorePreset, permanentDeletePreset,
    searchPresets, sortPresets, buildMeta,
    renamePreset, exportPresetsJSON, importPresetsJSON,
    COLOUR_TAGS, MODIFIER_TAGS, ALGORITHM_TAGS,
    EASING_TAGS, DIRECTION_TAGS, ENVELOPE_TAGS,
    DELETED_EXPIRY_DAYS,
} from '../../lib/aerolux/presets.js';

// props ─────────────────────────────────────────────────────────────
let {
    open: overlayOpen = $bindable(false),
    initialName      = '',
    saveGradient     = $bindable(null),
} = $props();

// local state ───────────────────────────────────────────────────────
let localPresets   = $state([]);
let deletedPresets = $state([]);
let searchTags     = $state([]);
let sortMode       = $state('newest');
let searchInput    = $state('');
let showDeleted    = $state(false);
let renamingId     = $state(null);
let renameValue    = $state('');
let loading        = $state(false);
let presetListEl   = $state(null);
let visibleStart   = $state(0);
let visibleEnd     = $state(0);
let presetImportOpen = $state(false);

const PRESET_CARD_HEIGHT = 172;
const PRESET_OVERSCAN = 6;

// derived filtered + sorted list ────────────────────────────────────
const filteredPresets = $derived(
    sortPresets(searchPresets(searchTags, localPresets), sortMode)
);
const visiblePresets = $derived(filteredPresets.slice(visibleStart, visibleEnd));
const spacerTop = $derived(visibleStart * PRESET_CARD_HEIGHT);
const spacerBottom = $derived(Math.max(0, filteredPresets.length - visibleEnd) * PRESET_CARD_HEIGHT);

$effect(() => {
    filteredPresets.length;
    if (presetListEl) {
        requestAnimationFrame(() => updateVisibleRange());
    }
});

// available tags for greying out unavailable ones
const availableTags = $derived(() => {
    const s = new Set();
    for (const p of localPresets) {
        const meta = p.meta ?? {};
        for (const ct of (meta.colourTags ?? [])) {
            const [colour, modifier] = ct.split('-');
            if (colour)   s.add(colour);
            if (modifier) s.add(modifier);
        }
        if (meta.algorithm)    s.add(meta.algorithm);
        if (meta.easing)       s.add(meta.easing);
        if (meta.hslDir)       s.add(meta.hslDir);
        if (meta.envelopeShape != null) s.add(`env_${meta.envelopeShape}`);
        if (meta.length != null) s.add(String(meta.length));
    }
    return s;
});

// load on open ──────────────────────────────────────────────────────
$effect(() => {
    if (overlayOpen) {
        showDeleted = false;
        loadAll();
    }
});

function updateVisibleRange() {
    if (!presetListEl) return;

    const listHeight = presetListEl.clientHeight || 400;
    const scrollTop = presetListEl.scrollTop || 0;
    const start = Math.max(0, Math.floor(scrollTop / PRESET_CARD_HEIGHT) - PRESET_OVERSCAN);
    const end = Math.min(filteredPresets.length, Math.ceil((scrollTop + listHeight) / PRESET_CARD_HEIGHT) + PRESET_OVERSCAN);

    visibleStart = start;
    visibleEnd = end;
}

async function loadAll() {
    loading = true;
    await purgeExpiredDeleted();
    [localPresets, deletedPresets] = await Promise.all([
        loadPresets(),
        loadDeletedPresets(),
    ]);
    loading = false;
    requestAnimationFrame(() => updateVisibleRange());
}

// expose saveCurrentGradient to parent ──────────────────────────────
onMount(() => {
    const handleResize = () => updateVisibleRange();
    window.addEventListener('resize', handleResize);

    saveGradient = async (name) => {
        if (!name?.trim()) { showToast('Add a name first', 'warning'); return; }
        const gr      = gradResult();
        const state   = {
            stops:     editor.stops,
            steps:     editor.steps,
            algorithm: editor.algorithm,
            easing:    editor.easing,
            hslDir:    editor.hslDir,
            hueShift:  editor.hueShift,
            tint:      editor.tint,
            envelope:  editor.envelope,
            antiRepeat:editor.antiRepeat,
        };

        const { duplicate, storageError, countWarning } = await savePreset(name, state, gr);

        if (storageError) { showToast(`Save failed: ${storageError}`, 'error', 6000); return; }
        if (duplicate) {
            showToast(`"${name}" saved. Identical gradient already exists as "${duplicate.name}"`, 'warning', 5000);
        } else {
            showToast(`"${name}" saved`, 'success');
        }
        if (countWarning) setTimeout(() => showToast(countWarning, 'info', 6000), 1000);

        // refresh list if overlay is open
        if (overlayOpen) {
            localPresets = await loadPresets();
            requestAnimationFrame(() => updateVisibleRange());
        }
    };

    return () => {
        window.removeEventListener('resize', handleResize);
    };
});

// load preset into editor ───────────────────────────────────────────
function loadPresetIntoEditor(preset) {
    pushUndo();
    const s = preset.state;
    editor.stops     = JSON.parse(JSON.stringify(s.stops));
    editor.algorithm = s.algorithm;
    editor.easing    = s.easing;
    editor.hslDir    = s.hslDir;
    editor.hueShift  = s.hueShift ?? 0;
    editor.tint      = { ...s.tint };
    editor.envelope  = { ...s.envelope };
    editor.steps     = s.steps;
    editor.selStop   = s.stops[0].id;
    editor.nextId    = Math.max(...s.stops.map(s => s.id)) + 1;
    showToast(`"${preset.name}" loaded`, 'success');
    overlayOpen = false;
}

// delete ────────────────────────────────────────────────────────────
async function handleDelete(preset) {
    await softDeletePreset(preset.id);
    localPresets   = await loadPresets();
    deletedPresets = await loadDeletedPresets();
    requestAnimationFrame(() => updateVisibleRange());
    showToast(`"${preset.name}" moved to Recently Deleted`, 'info', 2000);
}

// restore ───────────────────────────────────────────────────────────
async function handleRestore(preset) {
    await restorePreset(preset.id);
    [localPresets, deletedPresets] = await Promise.all([loadPresets(), loadDeletedPresets()]);
    requestAnimationFrame(() => updateVisibleRange());
    showToast(`"${preset.name}" restored`, 'success');
}

// permanent delete ──────────────────────────────────────────────────
async function handlePermanentDelete(preset) {
    await permanentDeletePreset(preset.id);
    deletedPresets = await loadDeletedPresets();
    showToast(`"${preset.name}" permanently deleted`, 'info', 1500);
}

// rename ────────────────────────────────────────────────────────────
function startRename(preset) {
    renamingId  = preset.id;
    renameValue = preset.name;
}

async function commitRename(id) {
    const result = await renamePreset(id, renameValue);
    if (!result.ok) { showToast(result.reason, 'warning'); return; }
    renamingId   = null;
    localPresets = await loadPresets();
    requestAnimationFrame(() => updateVisibleRange());
    showToast('Renamed', 'success', 1500);
}

function cancelRename() {
    renamingId  = null;
    renameValue = '';
}

// tag search ────────────────────────────────────────────────────────
function toggleTag(tag) {
    if (searchTags.includes(tag)) {
        searchTags = searchTags.filter(t => t !== tag);
    } else {
        searchTags = [...searchTags, tag];
    }
}

// export / import ───────────────────────────────────────────────────
async function handleExport() {
    const json = await exportPresetsJSON();
    downloadText(json, `aerolux_presets_${Date.now()}.json`);
    showToast('Presets exported', 'success');
}

async function handleImport(e) {
    const files = Array.from(e.target.files ?? []).filter(file => {
        const name = file.name.toLowerCase();
        return name.endsWith('.json') || name.endsWith('.txt');
    });

    if (!files.length) {
        showToast('No preset or gradient files were selected', 'warning', 3000);
        e.target.value = '';
        return;
    }

    let imported = 0;
    let skipped = 0;
    let storageError = null;

    try {
        for (const file of files) {
            const text = await file.text();
            const result = await importPresetsJSON(text, file.name.replace(/\.[^.]+$/, ''));
            imported += result.imported;
            skipped += result.skipped;
            if (result.storageError) storageError = result.storageError;
        }

        if (storageError) {
            showToast(`Import completed with a storage issue: ${storageError}`, 'warning', 6000);
        } else {
            localPresets = await loadPresets();
            requestAnimationFrame(() => updateVisibleRange());
            showToast(`Imported ${imported} preset${imported !== 1 ? 's' : ''}${skipped ? `, ${skipped} skipped` : ''}`, 'success', 4000);
        }
    } catch (err) {
        showToast(`Import failed: ${err.message}`, 'error', 5000);
    }

    e.target.value = '';
}

async function refreshPresets() {
    localPresets = await loadPresets();
    requestAnimationFrame(() => updateVisibleRange());
}

// gradient bar helper ───────────────────────────────────────────────
function buildBarSegments(velocities) {
    const palette = editor.palette;
    return (velocities ?? []).map(vel => {
        const c = palette[vel] ?? palette[0];
        return toHex(c.r, c.g, c.b);
    });
}

// days left helper ──────────────────────────────────────────────────
function daysLeft(preset) {
    return Math.max(0, Math.ceil(
        (preset.deletedAt + DELETED_EXPIRY_DAYS * 86400000 - Date.now()) / 86400000
    ));
}

// tag groups for the panel
const TAG_GROUPS = [
    { label: 'Colour',    tags: [...COLOUR_TAGS]    },
    { label: 'Mood',      tags: [...MODIFIER_TAGS]  },
    { label: 'Algorithm', tags: [...ALGORITHM_TAGS] },
    { label: 'Easing',    tags: [...EASING_TAGS]    },
    { label: 'Direction', tags: [...DIRECTION_TAGS] },
    { label: 'Envelope',  tags: [
        ['env_none','none'],['env_fade_in','fade in'],['env_fade_out','fade out'],
        ['env_fade_both','fade both'],['env_bell','bell'],['env_valley','valley'],
    ]},
    { label: 'Length', tags: Array.from({length:15},(_,i)=>String(i+2)) },
];

    const gr = $derived(gradResult());

    const segs = $derived(
        buildBarSegments(gr.map(g => g.velocity))
    );

    const meta = $derived(
        buildMeta(
            {
                stops: editor.stops,
                steps: editor.steps,
                algorithm: editor.algorithm,
                easing: editor.easing,
                hslDir: editor.hslDir,
                hueShift: editor.hueShift,
                tint: editor.tint,
                envelope: editor.envelope
            },
            gr,
        )
    );

</script>

{#if overlayOpen}
<!-- overlay backdrop -->
<div class="al-pm-overlay open" onclick={() => overlayOpen = false}>

    <!-- container — stop clicks propagating to backdrop -->
    <div class="al-pm-container" onclick={e => e.stopPropagation()}>

        <!-- ── recently deleted view ── -->
        {#if showDeleted}
            <div class="al-pm-deleted-view">
                <div class="al-pm-deleted-header">
                    <button class="al-btn al-btn-ghost" onclick={() => showDeleted = false}>← Back</button>
                    <span class="al-pm-section-title">Recently Deleted</span>
                    <span class="al-dim" style="font-size:11px;margin-right:auto">
                        Items expire after {DELETED_EXPIRY_DAYS} days
                    </span>
                </div>

                <div class="al-pm-deleted-grid">
                    {#if !deletedPresets.length}
                        <p class="al-hint-text" style="padding:6px 2px">No recently deleted presets.</p>
                    {:else}
                        {#each deletedPresets as preset (preset.id)}
                            {@const segs = buildBarSegments(preset.meta?.velocities)}
                            <div class="al-pm-card">
                                <div class="al-pm-card-name">{preset.name}</div>
                                <div class="al-pm-bar-wrap">
                                    <div class="al-pm-bar">
                                        {#each segs as col}
                                            <div style="background:{col}"></div>
                                        {/each}
                                    </div>
                                </div>
                                <div class="al-pm-card-body">
                                    <div class="al-pm-meta-row">
                                        <span class="al-pm-meta-pill">{preset.meta?.algorithm}</span>
                                        <span class="al-pm-meta-pill">{preset.meta?.easing}</span>
                                        <span class="al-pm-meta-pill">{preset.meta?.length} steps</span>
                                    </div>
                                </div>
                                <div class="al-pm-card-footer">
                                    <span class="al-pm-card-source">expires in {daysLeft(preset)}d</span>
                                    <button class="al-btn al-btn-sm" onclick={() => handleRestore(preset)}>Restore</button>
                                    <button class="al-btn al-btn-sm al-btn-danger" onclick={() => handlePermanentDelete(preset)}>Delete</button>
                                </div>
                            </div>
                        {/each}
                    {/if}
                </div>
            </div>
        {/if}

        <!-- ── left: current gradient card ── -->
        <div class="al-pm-left">
            <div class="al-pm-current-card">
                <div class="al-pm-current-eyebrow">Current gradient</div>
                <div class="al-pm-bar-wrap">
                    <div class="al-pm-bar">
                        {#each segs as col}
                            <div style="background:{col}"></div>
                        {/each}
                    </div>
                </div>
                <div class="al-pm-current-body">
                    <div class="al-pm-meta-row">
                        <span class="al-pm-meta-pill">{editor.algorithm}</span>
                        <span class="al-pm-meta-pill">{editor.easing}</span>
                        <span class="al-pm-meta-pill">{editor.steps} steps</span>
                    </div>
                    <div class="al-pm-tag-group">
                        {#each (meta.colourTags ?? []) as tag}
                            <span class="al-pm-tag">{tag}</span>
                        {/each}
                    </div>
                </div>
            </div>
        </div>

        <!-- ── right: search + preset list ── -->
        <div class="al-pm-right">

            <!-- search bar -->
            <br>
            <br>
            <div class="al-pm-search-zone">
                <div class="al-pm-search-bar">
                    <span class="al-pm-search-icon">⌕</span>
                    <div class="al-pm-chips-row">
                        {#each searchTags as tag}
                            <span class="al-pm-chip" onclick={() => toggleTag(tag)}>
                                {tag} ×
                            </span>
                        {/each}
                        <input
                            type="text"
                            class="al-pm-search-input"
                            placeholder={searchTags.length ? '' : 'Search presets…'}
                            bind:value={searchInput}
                            autocomplete="off"
                            onkeydown={e => {
                                if (e.key === 'Backspace' && !searchInput && searchTags.length) {
                                    searchTags = searchTags.slice(0, -1);
                                }
                            }}
                        />
                    </div>
                </div>

                <!-- tag panel -->
                <div class="al-pm-tag-panel">
                    <div class="al-pm-tag-divider"></div>
                    {#each TAG_GROUPS as group}
                        <div class="al-pm-tag-row">
                            <span class="al-pm-tag-label">{group.label}</span>
                            {#each group.tags as tag}
                                {@const tagVal   = Array.isArray(tag) ? tag[0] : tag}
                                {@const tagLabel = Array.isArray(tag) ? tag[1] : tag}
                                {@const isActive = searchTags.includes(tagVal)}
                                {@const isAvail  = availableTags().has(tagVal)}
                                <button
                                    class="al-tag-option {isActive ? 'active' : ''} {!isAvail && !isActive ? 'disabled' : ''}"
                                    onclick={() => toggleTag(tagVal)}
                                >{tagLabel}</button>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>

            <!-- preset list -->
            <div class="al-pm-columns">
                <div class="al-pm-col">
                    <div class="al-pm-col-header">
                        <span class="al-pm-col-title">My Presets</span>
                        <span class="al-pm-col-count">{filteredPresets.length === localPresets.length ? localPresets.length : `${filteredPresets.length} of ${localPresets.length}`}</span>
                        <select class="al-select" style="font-size:11px;padding:2px 6px;min-width:75px;flex:0"
                            bind:value={sortMode}>
                            <option value="newest">Newest</option>
                            <option value="oldest">Oldest</option>
                            <option value="alpha">A–Z</option>
                        </select>
                    </div>

                    <div class="al-pm-list" bind:this={presetListEl} onscroll={updateVisibleRange}>
                        {#if loading}
                            <p class="al-hint-text" style="padding:6px 2px">Loading…</p>
                        {:else if !filteredPresets.length}
                            <p class="al-hint-text" style="padding:6px 2px">
                                {localPresets.length ? 'No presets match your search.' : 'No presets yet. Save a gradient to get started.'}
                            </p>
                        {:else}
                            <div style:height={`${spacerTop}px`}></div>
                            {#each visiblePresets as preset (preset.id)}
                                {@const segs = buildBarSegments(preset.meta?.velocities)}
                                <div class="al-pm-card">

                                    <!-- name / rename -->
                                    {#if renamingId === preset.id}
                                        <div class="al-pm-rename-wrap">
                                            <input
                                                class="al-text-input al-pm-rename-input"
                                                bind:value={renameValue}
                                                onkeydown={e => {
                                                    if (e.key === 'Enter')  commitRename(preset.id);
                                                    if (e.key === 'Escape') cancelRename();
                                                }}
                                                onblur={() => commitRename(preset.id)}
                                            />
                                        </div>
                                    {:else}
                                        <div class="al-pm-card-name pm-rename-trigger"
                                            title="Double-click to rename"
                                            ondblclick={() => startRename(preset)}
                                        >{preset.name}</div>
                                    {/if}

                                    <!-- gradient bar -->
                                    <div class="al-pm-bar-wrap">
                                        <div class="al-pm-bar">
                                            {#each segs as col}
                                                <div style="background:{col}"></div>
                                            {/each}
                                        </div>
                                    </div>

                                    <!-- meta -->
                                    <div class="al-pm-card-body">
                                        <div class="al-pm-meta-row" style="margin-top:8px;">
                                            <span class="al-pm-meta-pill">{preset.meta?.algorithm}</span>
                                            <span class="al-pm-meta-pill">{preset.meta?.easing}</span>
                                            <span class="al-pm-meta-pill">{preset.meta?.length} steps</span>
                                            {#if (preset.meta?.hueShift ?? 0) !== 0}
                                                <span class="al-pm-meta-pill">⟳ {preset.meta.hueShift}°</span>
                                            {/if}
                                            {#if preset.meta?.envelopeShape && preset.meta.envelopeShape !== 'none'}
                                                <span class="al-pm-meta-pill">{preset.meta.envelopeShape.replace('_',' ')}</span>
                                            {/if}
                                        </div>
                                        <div class="al-pm-tag-group">
                                            {#each (preset.meta?.colourTags ?? []) as tag}
                                                <span class="al-pm-tag">{tag}</span>
                                            {/each}
                                        </div>
                                    </div>

                                    <!-- footer actions -->
                                    <div class="al-pm-card-footer">
                                        <span class="al-pm-card-source">
                                            saved {new Date(preset.savedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                        </span>
                                        <button class="al-btn al-btn-sm" onclick={() => loadPresetIntoEditor(preset)}>Load</button>
                                        <button class="al-btn al-btn-sm al-btn-danger" onclick={() => handleDelete(preset)}>Delete</button>
                                    </div>
                                </div>
                            {/each}
                            <div style:height={`${spacerBottom}px`}></div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>

        <!-- ── overlay controls (top right) ── -->
        {#if !showDeleted} 
        <div class="al-pm-controls" style="right:0;left: 316px;">
            <button class="al-btn al-btn-ghost" style="font-size:11px;opacity:0.6"
                onclick={handleExport}>⬇ Export</button>
            <button class="al-btn al-btn-ghost" style="font-size:11px;opacity:0.6"
                onclick={() => presetImportOpen = true}>⬆ Import</button>
            <button class="al-btn al-btn-ghost" style="font-size:11px;opacity:0.6"
                onclick={() => showDeleted = true}>🗑 Recently Deleted</button>
        </div>
        {/if}
        <div class="al-pm-controls">        
            <button class="al-btn al-btn-danger" onclick={() => overlayOpen = false}>×</button>
        </div>

    </div>
</div>
{/if}

<PresetImportModal bind:open={presetImportOpen} onImported={refreshPresets} />

<style>
/* overlay + container use global styles from app.css */
.al-pm-container {
    height: 80vh;
    width: 80vw;
}
/* only component-specific overrides live here */

.al-pm-left {
    width:        300px;
    flex-shrink:  0;
    border-right: 1px solid var(--color-border);
    padding:      var(--space-4);
    overflow-y:   auto;
}

.al-pm-right {
    flex:           1;
    min-width:      0;
    display:        flex;
    flex-direction: column;
    overflow:       hidden;
}

.al-pm-current-card {
    display:        flex;
    flex-direction: column;
    gap:            var(--space-2);
}

.al-pm-current-eyebrow {
    font-size:      var(--font-size-xs);
    font-weight:    var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color:          var(--color-text-dim);
}

.al-pm-current-body { display: flex; flex-direction: column; gap: var(--space-1); }

.al-pm-search-zone {
    padding:       var(--space-3) var(--space-4) 0;
    border-bottom: 1px solid var(--color-border);
    flex-shrink:   0;
}

.al-pm-search-bar {
    display:       flex;
    align-items:   center;
    gap:           var(--space-2);
    padding:       var(--space-2) var(--space-3);
    background:    var(--color-surface-0);
    border:        1px solid var(--color-border-input);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-2);
}

.al-pm-search-icon { color: var(--color-text-dim); font-size: 14px; }

.al-pm-chips-row {
    display:   flex;
    flex-wrap: wrap;
    gap:       4px;
    flex:      1;
}

.al-pm-search-input {
    border:     none;
    background: transparent;
    outline:    none;
    font-size:  var(--font-size-sm);
    color:      var(--color-text);
    font-family:inherit;
    min-width:  80px;
    flex:       1;
}

.al-pm-tag-panel {
    display:        flex;
    flex-direction: column;
    gap:            var(--space-2);
    padding:        var(--space-2) 0 var(--space-3);
}

.al-pm-tag-divider { height: 1px; background: var(--color-border); }

.al-pm-tag-row {
    display:     flex;
    flex-wrap:   wrap;
    align-items: center;
    gap:         4px;
}

.al-pm-tag-label {
    font-size:      var(--font-size-2xs);
    font-weight:    var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color:          var(--color-text-dim);
    min-width:      60px;
}

.al-tag-option {
    display:       inline-flex;
    align-items:   center;
    height:        20px;
    padding:       0 var(--space-2);
    border:        1px solid var(--color-border);
    border-radius: var(--radius-xs);
    background:    transparent;
    color:         var(--color-text-secondary);
    font-family:   inherit;
    font-size:     var(--font-size-2xs);
    cursor:        pointer;
    transition:    background 0.12s, border-color 0.12s, color 0.12s;
}
.al-tag-option:hover   { background: var(--color-surface-2); color: var(--color-text); }
.al-tag-option.active  { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent-text); }
.al-tag-option.disabled{ opacity: 0.3; pointer-events: none; }

.al-pm-columns {
    flex:       1;
    min-height: 0;
    overflow:   hidden;
}

.al-pm-col {
    display:        flex;
    flex-direction: column;
    height:         100%;
    overflow:       hidden;
}

.al-pm-col-header {
    display:       flex;
    align-items:   center;
    gap:           var(--space-2);
    padding:       var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    flex-shrink:   0;
}

.al-pm-col-title {
    font-size:   var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
}

.al-pm-col-count {
    font-size:   var(--font-size-xs);
    color:       var(--color-text-dim);
    font-family: 'Geist Mono', monospace;
}

.al-pm-list {
    flex:           1;
    overflow-y:     auto;
    padding:        var(--space-3);
    display:        flex;
    flex-direction: column;
    gap:            var(--space-2);
}

/* preset cards */
.al-pm-card {
    min-height: 160px;
    background:    var(--color-surface-1);
    border:        1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow:      hidden;
    transition:    border-color 0.15s, box-shadow 0.15s;
}
.al-pm-card:hover { border-color: var(--color-border-bright); box-shadow: var(--shadow-card-hover); }

.al-pm-bar { height: 28px; display: flex; }
.al-pm-bar > div { flex: 1; }

.al-pm-bar-wrap { height: 28px; overflow: hidden; }

.al-pm-card-name {
    padding:        var(--space-2) var(--space-3) var(--space-1);
    font-weight:    var(--font-weight-semibold);
    font-size:      var(--font-size-sm);
    white-space:    nowrap;
    overflow:       hidden;
    text-overflow:  ellipsis;
    cursor:         default;
}
.al-pm-card-name.pm-rename-trigger { cursor: text; }

.al-pm-rename-wrap { padding: 4px 12px 6px; }
.al-pm-rename-input { font-size: 12px; width: 100%; }

.al-pm-card-body { padding: 0 var(--space-3) var(--space-2); }

.al-pm-meta-row {
    display:       flex;
    flex-wrap:     wrap;
    gap:           4px;
    margin-bottom: 4px;
}

.al-pm-meta-pill {
    font-size:     var(--font-size-2xs);
    padding:       1px 6px;
    border-radius: var(--radius-xs);
    border:        1px solid var(--color-border);
    color:         var(--color-text-dim);
    font-family:   'Geist Mono', monospace;
}

.al-pm-tag-group { display: flex; flex-wrap: wrap; gap: 3px; }

.al-pm-tag {
    font-size:     var(--font-size-2xs);
    padding:       1px 5px;
    border-radius: var(--radius-xs);
    background:    var(--color-accent-subtle);
    border:        1px solid var(--color-accent-border);
    color:         var(--color-accent-text);
}

.al-pm-card-footer {
    display:      flex;
    align-items:  center;
    gap:          var(--space-2);
    padding:      var(--space-2) var(--space-3);
    border-top:   1px solid var(--color-border);
    flex-wrap:    wrap;
}

.al-pm-card-source {
    font-size:    var(--font-size-2xs);
    color:        var(--color-text-dim);
    font-family:  'Geist Mono', monospace;
    margin-right: auto;
}

.al-pm-chip {
    display:       inline-flex;
    align-items:   center;
    height:        20px;
    padding:       0 var(--space-2);
    border-radius: var(--radius-xs);
    background:    var(--color-surface-2);
    border:        1px solid var(--color-border);
    font-size:     var(--font-size-2xs);
    color:         var(--color-text-secondary);
    cursor:        pointer;
    gap:           4px;
}
.al-pm-chip:hover { background: var(--color-surface-3); }

/* overlay controls */
.al-pm-controls {
    position:    absolute;
    top:         var(--space-3);
    right:       var(--space-3);
    display:     flex;
    gap:         var(--space-2);
    align-items: center;
    z-index:     10;
}

.al-pm-close-btn {
    width:           28px;
    height:          28px;
    border:          1px solid var(--color-border);
    border-radius:   var(--radius-sm);
    background:      var(--color-surface-2);
    color:           var(--color-text-secondary);
    font-size:       18px;
    cursor:          pointer;
    display:         flex;
    align-items:     center;
    justify-content: center;
    box-shadow:      var(--shadow-btn);
    transition:      background 0.15s, color 0.15s, border-color 0.15s;
}
.al-pm-close-btn:hover { background: var(--color-danger-subtle); color: var(--color-danger); border-color: var(--color-danger-border); }

/* deleted view */
.al-pm-deleted-view {
    position:       absolute;
    inset:          0;
    background:     var(--color-glass-modal);
    backdrop-filter:        blur(20px);
    -webkit-backdrop-filter:blur(20px);
    z-index:        5;
    display:        flex;
    flex-direction: column;
    overflow:       hidden;
    border-radius:  inherit;
}

.al-pm-deleted-header {
    display:       flex;
    align-items:   center;
    gap:           var(--space-3);
    padding:       var(--space-4);
    border-bottom: 1px solid var(--color-border);
    flex-shrink:   0;
}

.al-pm-section-title {
    font-size:   var(--font-size-md);
    font-weight: var(--font-weight-semibold);
}

.al-pm-deleted-grid {
    flex:           1;
    overflow-y:     auto;
    padding:        var(--space-4);
    display:        flex;
    flex-direction: column;
    gap:            var(--space-2);
}
</style>