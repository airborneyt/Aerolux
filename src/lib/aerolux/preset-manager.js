// src/lib/aerolux/preset-manager.js
// preset overlay, community feed, publish flow, search/tag system
// call initPresetManager(callbacks)
// returns { open, close, saveCurrentGradient }
// currently defunct and waiting to be ported to the new store system

import { save } from '@tauri-apps/plugin-dialog';
import { open } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import {
    savePreset, loadPresets, softDeletePreset,
    loadDeletedPresets, purgeExpiredDeleted,
    restorePreset, permanentDeletePreset,
    searchPresets, sortPresets, buildMeta,
    renamePreset, exportPresetsJSON, importPresetsJSON,
    COLOUR_TAGS, MODIFIER_TAGS, ALGORITHM_TAGS,
    EASING_TAGS, DIRECTION_TAGS, ENVELOPE_TAGS, DELETED_EXPIRY_DAYS,
} from './presets.js';
import {
    signInWithDiscord,
    getSession, onAuthStateChange, upsertProfile,
    fetchCommunityGradients, fetchGradientState, publishGradient,
    incrementDownload, flagGradient, deleteGradient,
    syncDiscordRoles, getMembership,
} from './community.js';
import {
    escapeHtml, escapeAttr,
    normalizeVelocities, safeCount, safeImageUrl,
    buildBarHTML, buildSweepCSS,
    buildMetaRowHTML, buildTagGroupHTML,
    renderCommunityLoadingCards, clearLoadingCards,
} from './preset-render.js';
import { gradToText, safeFilename, downloadText } from './utils.js';

// module state ──────────────────────────────────────────────────────

let localPresets       = [];
let deletedPresets     = [];
let communityPresets   = [];
let searchTags         = [];
let presetSortMode     = 'newest';
let communityOffset    = 0;
let communityLoading   = false;
let communityExhausted = false;
let currentSession     = null;
let membershipStatus   = { isMember: false, role: null };
let availableTagSet    = new Set();

// init ──────────────────────────────────────────────────────────────

export async function initPresetManager({
    getGradResult,     // () => gradResult array
    getPalette,        // () => palette array
    toHex,             // (r,g,b) => string
    getEditorState,    // () => full editor state object
    applyEditorState,  // (partial) => void
    pushUndo,          // () => void
    syncUiToState,     // () => void
    renderAll,         // () => void
    showToast,         // (msg, type, duration) => void
    playSound,         // (name) => void
    onClose,           // () => void
}) {
    await purgeExpiredDeleted();

    // generate length tag buttons
    const lengthRow = document.getElementById('pm-length-row');
    if (lengthRow) {
        for (let n = 2; n <= 16; n++) {
            const btn = document.createElement('button');
            btn.className   = 'al-tag-option';
            btn.dataset.tag = String(n);
            btn.textContent = String(n);
            lengthRow.appendChild(btn);
        }
    }

    // auth listener: refresh cards when auth changes while overlay is open
    onAuthStateChange(async session => {
        currentSession = session;
        if (session) {
            await upsertProfile(session);
            membershipStatus = await syncDiscordRoles(true);
        } else {
            membershipStatus = { isMember: false, role: null };
        }
        if (document.getElementById('preset-overlay')?.classList.contains('open')) {
            _renderCurrentGradientCard();
            _resetCommunityFeed();
        }
    });

    // open / close ──────────────────────────────────────────────────

    const pmOverlay = document.getElementById('preset-overlay');

    async function open() {
        pmOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        if (currentSession) membershipStatus = await getMembership();
        _renderCurrentGradientCard();
        await _loadAndRenderPresets();
        _resetCommunityFeed();
    }

    function close() {
        if (onClose) {
            onClose();
        } else {
            pmOverlay?.classList.remove('open');
        }
        document.body.style.overflow = '';
    }

    pmOverlay?.addEventListener('click', e => { if (e.target === pmOverlay) close(); });
    document.getElementById('preset-close')?.addEventListener('click', close);
    document.getElementById('browse-presets-btn')
        ?.addEventListener('click', async () => open());

    // current gradient card ─────────────────────────────────────────

    async function _renderCurrentGradientCard() {
        const gradResult = getGradResult();
        const palette    = getPalette();
        const state      = getEditorState();
        const velocities = gradResult.map(g => g.velocity);
        const bar        = buildBarHTML(velocities, palette, toHex);
        const sweep      = buildSweepCSS(velocities, palette, toHex);
        const meta       = buildMeta(state, gradResult, palette);

        let session = null;
        try { session = await getSession(); } catch (_) {}
        currentSession = session;

        const authBtn = session
            ? `<button class="al-btn al-btn-blue" id="cur-publish-btn" style="width:100%;font-size:11px">↑ Publish to community</button>`
            : `<button class="al-btn al-btn-ghost" id="cur-signin-btn" style="width:100%;font-size:11px;opacity:0.6">Sign in with Discord to publish</button>`;

        document.getElementById('preset-current-card').innerHTML = `
            <div class="al-pm-current-card">
                <div class="al-pm-current-eyebrow">Current gradient</div>
                <div class="al-pm-bar-wrap" id="cur-bar-wrap">
                    <div class="al-pm-bar">${bar}</div>
                    <div class="al-pm-bar-sweep" style="background:${sweep}"></div>
                </div>
                <div class="al-pm-current-body">
                    <div class="al-pm-meta-row">${buildMetaRowHTML(state.algorithm, state.easing, state.steps)}</div>
                    <div class="al-pm-tag-group">${buildTagGroupHTML(meta.colourTags)}</div>
                </div>
                <div class="al-pm-current-footer">
                    <button class="al-btn al-btn-blue" id="cur-save-btn" style="width:100%">💾 Save as preset</button>
                    ${authBtn}
                </div>
            </div>`;

        document.getElementById('cur-save-btn')?.addEventListener('click', () => {
            document.getElementById('preset-name-prompt').classList.add('open');
            document.getElementById('preset-name-input').focus();
        });
        document.getElementById('cur-signin-btn')?.addEventListener('click', async () => {
            try { await signInWithDiscord(); }
            catch (e) { showToast('Sign in failed', 'error'); }
        });
        document.getElementById('cur-publish-btn')?.addEventListener('click', _openPublishModal);
        document.getElementById('cur-bar-wrap')?.addEventListener('click', () => _previewInOutput(velocities));
    }

    // save preset ───────────────────────────────────────────────────

    async function saveCurrentGradient(name) {
    const gradResult = getGradResult();
        const palette    = getPalette();
        const state      = getEditorState();
        if (!name) { showToast('Add a name first', 'warning'); return; }

        const { duplicate, storageError, countWarning } = await savePreset(
            name, state, gradResult, palette
        );

        document.getElementById('preset-name-prompt').classList.remove('open');
        document.getElementById('preset-name-input').value = '';

        if (storageError) { showToast(`Save failed: ${storageError}`, 'error', 6000); return; }
        if (duplicate) {
            showToast(`"${name}" saved. Identical gradient already exists as "${duplicate.name}"`, 'warning', 5000);
        } else {
            showToast(`"${name}" saved`, 'success');
        }
        if (countWarning) setTimeout(() => showToast(countWarning, 'info', 6000), 1000);
        await _loadAndRenderPresets();
    }
    // tag set helper ────────────────────────────────────────────────

    function _buildTagSet(presets) {
        const available = new Set();
        for (const p of presets) {
            const meta = p.meta ?? {};
            for (const ct of (meta.colourTags ?? [])) {
                const [colour, modifier] = ct.split('-');
                if (colour)   available.add(colour);
                if (modifier) available.add(modifier);
            }
            if (meta.algorithm)    available.add(meta.algorithm);
            if (meta.easing)       available.add(meta.easing);
            if (meta.hslDir)       available.add(meta.hslDir);
            if (meta.envelopeShape != null) available.add(`env_${meta.envelopeShape}`);
            if (meta.length != null) available.add(String(meta.length));
        }
        return available;
    }

    // load and render ───────────────────────────────────────────────

    async function _loadAndRenderPresets() {
        const all      = await loadPresets();
        const filtered = sortPresets(searchPresets(searchTags, all), presetSortMode);
        localPresets    = all;
        availableTagSet = _buildTagSet(all);

        for (const preset of all) {
            if (preset.meta?.velocities) {
                const gr = preset.meta.velocities.map((v, i) => ({
                    step: i,
                    velocity: v
                }));
            }
        }

        const listEl  = document.getElementById('preset-local-list');
        const countEl = document.getElementById('local-preset-count');
        listEl.innerHTML = filtered.length
            ? filtered.map(_renderPresetCard).join('')
            : `<p class="al-hint-text" style="padding:6px 2px">${
                all.length ? 'No presets match your search.' : 'No presets yet. Save a gradient to get started.'
              }</p>`;
        if (countEl) countEl.textContent = filtered.length === all.length
            ? `${all.length}` : `${filtered.length} of ${all.length}`;
    }

    async function _loadAndRenderDeleted() {
        const all = await loadDeletedPresets();
        deletedPresets = all;
        const listEl = document.getElementById('preset-deleted-list');
        listEl.innerHTML = all.length
            ? all.map(_renderDeletedCard).join('')
            : `<p class="al-hint-text" style="padding:6px 2px">No recently deleted presets.</p>`;
    }

    // community feed ────────────────────────────────────────────────

    function _resetCommunityFeed() {
        communityOffset    = 0;
        communityExhausted = false;
        communityPresets   = [];
        communityLoading   = false;

        const list = document.getElementById('preset-community-list');
        list.innerHTML = '<div id="community-sentinel"></div>';

        const allTags = [...COLOUR_TAGS, ...MODIFIER_TAGS, ...ALGORITHM_TAGS, ...EASING_TAGS, ...DIRECTION_TAGS];
        renderCommunityLoadingCards(list, document.getElementById('community-sentinel'), allTags);
        _observeCommunity();
    }

    function _observeCommunity() {
        const sentinel = document.getElementById('community-sentinel');
        if (!sentinel) return;
        const obs = new IntersectionObserver(async entries => {
            if (entries[0].isIntersecting) await _loadMoreCommunity();
        }, { threshold: 0.1 });
        obs.observe(sentinel);
    }

    async function _loadMoreCommunity() {
        if (communityLoading || communityExhausted) return;
        communityLoading = true;
        try {
            const results = await fetchCommunityGradients(20, communityOffset);
            clearLoadingCards(document.getElementById('preset-community-list'));
            if (results.length < 20) communityExhausted = true;
            const sentinel = document.getElementById('community-sentinel');
            results.forEach(g => {
                communityPresets.push(g);
                sentinel.insertAdjacentHTML('beforebegin', _renderCommunityCard(g));
            });
            communityOffset += results.length;
            const countEl = document.getElementById('community-preset-count');
            if (countEl) countEl.textContent = communityPresets.length;
            if (communityExhausted) {
                sentinel.insertAdjacentHTML('beforebegin',
                    `<p class="al-hint-text" style="padding:8px 4px;text-align:center;opacity:0.35">All community gradients loaded</p>`);
            }
        } catch (err) {
            clearLoadingCards(document.getElementById('preset-community-list'));
            showToast('Failed to load community gradients', 'error');
            console.error(err);
        } finally { communityLoading = false; }
    }

    // preview ───────────────────────────────────────────────────────

    function _previewInOutput(velocities) {
        const palette  = getPalette();
        const safeVels = normalizeVelocities(velocities, palette.length);
        document.getElementById('out-bar').innerHTML = safeVels.map((vel, i) => {
            const c = palette[vel] || palette[0];
            return `<div title="step ${i+1} · vel ${vel}" style="background:${toHex(c.r,c.g,c.b)}"></div>`;
        }).join('');
        document.getElementById('out-chips').innerHTML = safeVels
            .map(vel => `<span class="al-chip">${vel}</span>`).join('');
        document.getElementById('out-text').value =
            safeVels.map((v, i) => `${i}, ${v};`).join('\n');
        showToast('Previewing in output — click Load to use in editor', 'info', 2500);
    }

    // load into editor ──────────────────────────────────────────────

    function _loadPresetIntoEditor(state, name) {
        pushUndo();
        applyEditorState({
            stops:     JSON.parse(JSON.stringify(state.stops)),
            algorithm: state.algorithm,
            easing:    state.easing,
            hslDir:    state.hslDir,
            hueShift:  state.hueShift ?? 0,
            tint:      { ...state.tint },
            envelope:  { ...state.envelope },
            steps:     state.steps,
            selStop:   state.stops[0].id,
            nextId:    Math.max(...state.stops.map(s => s.id)) + 1,
        });
        syncUiToState();
        renderAll();
        showToast(`"${name}" loaded`, 'success');
        close();
    }

    // card renderers ────────────────────────────────────────────────

    function _renderPresetCard(preset) {
        const palette = getPalette();
        const vels    = normalizeVelocities(preset.meta?.velocities, palette.length);
        const bar     = buildBarHTML(vels, palette, toHex);
        const sweep   = buildSweepCSS(vels, palette, toHex);
        const date    = new Date(preset.savedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
        const id      = escapeAttr(preset.id);
        const hueShiftVal = preset.meta?.hueShift ?? 0;
        const envShape    = preset.meta?.envelopeShape ?? 'none';
        const extraPills  = [
            hueShiftVal !== 0 ? `<span class="al-pm-meta-pill" title="Hue shift">⟳ ${hueShiftVal}°</span>` : '',
            envShape !== 'none' ? `<span class="al-pm-meta-pill">${envShape.replace('_', ' ')}</span>` : '',
        ].filter(Boolean).join('');
        return `
            <div class="al-pm-card">
                <div class="al-pm-card-name pm-rename-trigger" data-id="${id}" title="Double-click to rename">${escapeHtml(preset.name)}</div>
                <div class="al-pm-rename-wrap" data-id="${id}" style="display:none;padding:4px 12px 6px">
                  <input class="al-text-input al-pm-rename-input" style="font-size:12px" value="${escapeAttr(preset.name)}" maxlength="48" />
                </div>
                <div class="al-pm-bar-wrap" data-vels="${vels.join(',')}">
                    <div class="al-pm-bar">${bar}</div>
                    <div class="al-pm-bar-sweep" style="background:${sweep}"></div>
                </div>
                <div class="al-pm-card-body">
                    <div class="al-pm-meta-row">${buildMetaRowHTML(preset.meta?.algorithm, preset.meta?.easing, preset.meta?.length)}${extraPills}</div>
                    <div class="al-pm-tag-group">${buildTagGroupHTML(preset.meta?.colourTags)}</div>
                </div>
                <div class="al-pm-card-footer">
                    <span class="al-pm-card-source">saved ${escapeHtml(date)}</span>
                    <button class="al-btn pm-load-btn" data-id="${id}">Load</button>
                    <button class="al-btn al-btn-danger pm-delete-btn" data-id="${id}">Delete</button>
                </div>
            </div>`;
    }

    function _renderCommunityCard(gradient) {
        const palette = getPalette();
        const vels    = normalizeVelocities(gradient.meta?.velocities, palette.length);
        const bar     = buildBarHTML(vels, palette, toHex);
        const sweep   = buildSweepCSS(vels, palette, toHex);
        const isOwn   = currentSession?.user?.id === gradient.author_id;
        const id      = escapeAttr(gradient.id);
        const user    = gradient.profiles?.username ?? 'Unknown';
        const avatar  = safeImageUrl(gradient.profiles?.avatar_url);
        const dlCount = safeCount(gradient.download_count);
        return `
            <div class="al-pm-card">
                <div class="al-pm-card-author">
                    <img src="${avatar}" class="al-pm-avatar" alt="${escapeAttr(user)}" />
                    <span class="al-pm-author-name">${escapeHtml(user)}</span>
                    <span class="al-pm-dl-count">${dlCount} dl</span>
                </div>
                <div class="al-pm-card-name">${escapeHtml(gradient.name)}</div>
                <div class="al-pm-bar-wrap" data-vels="${vels.join(',')}">
                    <div class="al-pm-bar">${bar}</div>
                    <div class="al-pm-bar-sweep" style="background:${sweep}"></div>
                </div>
                <div class="al-pm-card-body">
                    <div class="al-pm-meta-row">${buildMetaRowHTML(gradient.meta?.algorithm, gradient.meta?.easing, gradient.meta?.length)}</div>
                    <div class="al-pm-tag-group">${buildTagGroupHTML(gradient.meta?.colourTags)}</div>
                </div>
                <div class="al-pm-card-footer">
                    ${membershipStatus.isMember
                        ? `<button class="al-btn pm-load-btn" data-id="${id}">Load</button>`
                        : `<button class="al-btn al-btn-ghost pm-join-hint" style="font-size:11px;opacity:0.5;cursor:default" disabled>Members only</button>`}
                    <button class="al-btn al-btn-green pm-dl-btn" data-id="${id}">⬇</button>
                    ${currentSession ? `<button class="al-btn pm-flag-btn" data-id="${id}">⚑</button>` : ''}
                    ${isOwn ? `<button class="al-btn al-btn-danger pm-own-delete-btn" data-id="${id}">Delete</button>` : ''}
                </div>
            </div>`;
    }

    function _renderDeletedCard(preset) {
        const palette  = getPalette();
        const vels     = normalizeVelocities(preset.meta?.velocities, palette.length);
        const bar      = buildBarHTML(vels, palette, toHex);
        const sweep    = buildSweepCSS(vels, palette, toHex);
        const daysLeft = Math.max(0, Math.ceil(
            (preset.deletedAt + DELETED_EXPIRY_DAYS * 86400000 - Date.now()) / 86400000
        ));
        const id = escapeAttr(preset.id);
        return `
            <div class="al-pm-card">
                <div class="al-pm-card-name">${escapeHtml(preset.name)}</div>
                <div class="al-pm-bar-wrap" data-vels="${vels.join(',')}">
                    <div class="al-pm-bar">${bar}</div>
                    <div class="al-pm-bar-sweep" style="background:${sweep}"></div>
                </div>
                <div class="al-pm-card-body">
                    <div class="al-pm-meta-row">${buildMetaRowHTML(preset.meta?.algorithm, preset.meta?.easing, preset.meta?.length)}</div>
                    <div class="al-pm-tag-group">${buildTagGroupHTML(preset.meta?.colourTags)}</div>
                </div>
                <div class="al-pm-card-footer">
                    <span class="al-pm-card-source">expires in ${daysLeft}d</span>
                    <button class="al-btn pm-restore-btn" data-id="${id}">Restore</button>
                    <button class="al-btn al-btn-danger pm-perm-del-btn" data-id="${id}">Delete</button>
                </div>
            </div>`;
    }

    // event delegation ──────────────────────────────────────────────

    async function _handleLocalListEvent(e) {
        const bar     = e.target.closest('.al-pm-bar-wrap');
        const loadBtn = e.target.closest('.pm-load-btn');
        const delBtn  = e.target.closest('.pm-delete-btn');
        const renameTrigger = e.target.closest('.pm-rename-trigger');

        if (bar && !loadBtn && !delBtn) {
            const vels = bar.dataset.vels?.split(',').map(Number);
            if (vels?.length) _previewInOutput(vels);
            return;
        }
        if (loadBtn) {
            const preset = localPresets.find(p => p.id === loadBtn.dataset.id);
            if (preset) _loadPresetIntoEditor(preset.state, preset.name);
        }
        if (delBtn) {
            const preset = localPresets.find(p => p.id === delBtn.dataset.id);
            if (!preset) return;
            await softDeletePreset(preset.id);                             // ← CHANGED: added await
            await _loadAndRenderPresets();                                 // ← CHANGED: added await
            showToast(`"${preset.name}" moved to Recently Deleted`, 'info', 2000);
        }
        if (renameTrigger && e.type === 'dblclick') {
            const id    = renameTrigger.dataset.id;
            const wrap  = document.querySelector(`.al-pm-rename-wrap[data-id="${id}"]`);
            const input = wrap?.querySelector('.al-pm-rename-input');
            if (!wrap || !input) return;
            renameTrigger.style.display = 'none';
            wrap.style.display = 'block';
            input.focus(); input.select();
            const commit = async () => {                                           // ← CHANGED: added async
                const result = await renamePreset(id, input.value);               // ← CHANGED: added await
                if (!result.ok) { showToast(result.reason, 'warning'); return; }
                await _loadAndRenderPresets();                                     // ← CHANGED: added await
                showToast('Renamed', 'success', 1500);
            };
            input.addEventListener('keydown', ev => {
                if (ev.key === 'Enter')  commit();
                if (ev.key === 'Escape') _loadAndRenderPresets();
            });
            input.addEventListener('blur', commit);
        }
    }
    document.getElementById('preset-local-list')?.addEventListener('click',   _handleLocalListEvent);
    document.getElementById('preset-local-list')?.addEventListener('dblclick', _handleLocalListEvent);

    document.getElementById('preset-community-list')?.addEventListener('click', async e => {
        const bar        = e.target.closest('.al-pm-bar-wrap');
        const loadBtn    = e.target.closest('.pm-load-btn');
        const dlBtn      = e.target.closest('.pm-dl-btn');
        const flagBtn    = e.target.closest('.pm-flag-btn');
        const ownDelBtn  = e.target.closest('.pm-own-delete-btn');
        const palette    = getPalette();

        if (bar && !loadBtn && !dlBtn && !flagBtn && !ownDelBtn) {
            const vels = bar.dataset.vels?.split(',').map(Number);
            if (vels?.length) _previewInOutput(vels);
            return;
        }
        if (loadBtn) {
    const g = communityPresets.find(p => p.id === loadBtn.dataset.id);
    if (!g) return;
    const { isMember } = await getMembership();
    if (!isMember) { showToast('Join Airborne\'s Discord server to load community gradients', 'warning', 4000); return; }
    if (loadBtn.disabled) return;
    const originalText  = loadBtn.textContent;
    loadBtn.disabled    = true;
    loadBtn.textContent = 'Loading…';
    try {
        const state = await fetchGradientState(g.id);
        if (!state) { showToast('Could not load gradient state', 'error'); loadBtn.disabled = false; loadBtn.textContent = originalText; return; }
        _loadPresetIntoEditor(state, g.name);
        incrementDownload(g.id);
    } catch (err) {
        showToast('Load failed: ' + err.message, 'error');
        loadBtn.disabled = false; loadBtn.textContent = originalText;
    }
}
if (dlBtn) {
    const g = communityPresets.find(p => p.id === dlBtn.dataset.id);
    if (!g) return;
    const { isMember } = await getMembership();
    if (!isMember) {
        showToast('Join Airborne\'s Discord server to download community gradients', 'warning', 4000);
        return;
    }
    if (dlBtn.disabled) return;
    const velocities = normalizeVelocities(g.meta?.velocities, palette.length);
    const text = gradToText(velocities.map((v, i) => ({ step: i, velocity: v })));
    downloadText(text, safeFilename(g.name || 'community_gradient'));
    incrementDownload(g.id);
    showToast(`"${g.name}" downloaded`, 'success');
}
        if (flagBtn) {
            const g = communityPresets.find(p => p.id === flagBtn.dataset.id);
            if (!g) return;
            try { await flagGradient(g.id); showToast('Flagged and sent for review', 'info', 2000); }
            catch (err) { showToast(err.message, 'warning', 3000); }
        }
        if (ownDelBtn) {
            const g = communityPresets.find(p => p.id === ownDelBtn.dataset.id);
            if (!g) return;
            try {
                await deleteGradient(g.id);
                communityPresets = communityPresets.filter(p => p.id !== g.id);
                ownDelBtn.closest('.al-pm-card').remove();
                showToast(`"${g.name}" deleted`, 'info', 1500);
            } catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
        }
    });

    document.getElementById('preset-deleted-list')?.addEventListener('click', async e => {
        const bar        = e.target.closest('.al-pm-bar-wrap');
        const restoreBtn = e.target.closest('.pm-restore-btn');
        const permDelBtn = e.target.closest('.pm-perm-del-btn');
        if (bar && !restoreBtn && !permDelBtn) {
            const vels = bar.dataset.vels?.split(',').map(Number);
            if (vels?.length) _previewInOutput(vels);
            return;
        }
        if (restoreBtn) {
            const preset = deletedPresets.find(p => p.id === restoreBtn.dataset.id);
            if (!preset) return;
            await restorePreset(preset.id);
            await _loadAndRenderDeleted();
            await _loadAndRenderPresets();
            showToast(`"${preset.name}" restored`, 'success');
        }
        if (permDelBtn) {
            const preset = deletedPresets.find(p => p.id === permDelBtn.dataset.id);
            if (!preset) return;
            await permanentDeletePreset(preset.id);
            await _loadAndRenderDeleted();
            showToast(`"${preset.name}" permanently deleted`, 'info', 1500);
        }
    });

    document.getElementById('deleted-toggle-btn')?.addEventListener('click', async () => {
        document.getElementById('preset-deleted-view').style.display = 'flex';
        await _loadAndRenderDeleted();
    });
    document.getElementById('deleted-back-btn')?.addEventListener('click', () => {
        document.getElementById('preset-deleted-view').style.display = 'none';
    });
    document.getElementById('preset-sort-select')?.addEventListener('change', async e => {
        presetSortMode = e.target.value;
        await _loadAndRenderPresets();
    });

    // search tag panel ──────────────────────────────────────────────

    const pmTagPanel   = document.getElementById('tag-panel');
    const pmSearchZone = document.getElementById('preset-search-zone');

    const _getSearchInput = () => document.getElementById('preset-search-input');
    const _openTagPanel   = () => { pmTagPanel?.classList.add('open');    _updateTagPanel(); };
    const _closeTagPanel  = () => { pmTagPanel?.classList.remove('open'); };

    pmSearchZone?.addEventListener('focusin', e => {
        if (e.target.id === 'preset-search-input') _openTagPanel();
    });
    document.addEventListener('click', e => {
        if (pmSearchZone && !pmSearchZone.contains(e.target)) _closeTagPanel();
    });
    pmTagPanel?.addEventListener('click', async e => {
        const btn = e.target.closest('.al-tag-option');
        if (!btn || btn.classList.contains('disabled')) return;
        const tag = btn.dataset.tag;
        searchTags = searchTags.includes(tag) ? searchTags.filter(t => t !== tag) : [...searchTags, tag];
        _renderSearchChips(); _updateTagPanel();
        await _loadAndRenderPresets();
        _getSearchInput()?.focus();
    });
    document.getElementById('search-chips-container')?.addEventListener('click', async e => {
        const chip = e.target.closest('.al-pm-chip');
        if (!chip) return;
        searchTags = searchTags.filter(t => t !== chip.dataset.tag);
        _renderSearchChips(); _updateTagPanel(); 
        await _loadAndRenderPresets();
    });

    function _renderSearchChips() {
        const container = document.getElementById('search-chips-container');
        if (!container) return;
        container.innerHTML =
            searchTags.map(tag => `<span class="al-pm-chip" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</span>`).join('') +
            `<input type="text" id="preset-search-input" class="al-pm-search-input"
                placeholder="${searchTags.length ? '' : 'Search presets…'}" autocomplete="off" />`;
        const input = document.getElementById('preset-search-input');
        input?.addEventListener('focus', _openTagPanel);
        input?.addEventListener('keydown', async e => {
            if (e.key === 'Backspace' && !e.target.value && searchTags.length) {
                searchTags = searchTags.slice(0, -1);
                _renderSearchChips(); _updateTagPanel(); 
                await _loadAndRenderPresets();
            }
        });
    }

    function _updateTagPanel() {
        document.querySelectorAll('.al-tag-option').forEach(btn => {
            const tag      = btn.dataset.tag;
            const isActive = searchTags.includes(tag);
            btn.classList.toggle('active',   isActive);
            btn.classList.toggle('disabled', !availableTagSet.has(tag) && !isActive);
        });
    }

    // export / import ───────────────────────────────────────────────

    document.getElementById('preset-export-btn')?.addEventListener('click', async () => {
        const json = await exportPresetsJSON();
        const path = await save({
            defaultPath: `aerolux_presets_${Date.now()}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return;
        await writeTextFile(path, json);
        showToast('Presets exported', 'success');
    });

    document.getElementById('preset-import-btn')?.addEventListener('click', async () => {
        const path = await open({
            multiple: false,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return;

        try {
            const text = await readTextFile(path);
            const { imported, skipped, storageError } = await importPresetsJSON(text);
            if (storageError) { showToast(`Import failed: ${storageError}`, 'error', 6000); return; }
            await _loadAndRenderPresets();
            showToast(`Imported ${imported} preset${imported !== 1 ? 's' : ''}${skipped ? `, ${skipped} skipped` : ''}`, 'success', 4000);
        } catch (err) {
            showToast(`Import failed: ${err.message}`, 'error', 5000);
        }
    });

    // publish modal ─────────────────────────────────────────────────

    function _openPublishModal() {
        const gradResult = getGradResult();
        const palette    = getPalette();
        document.getElementById('publish-preview-bar').innerHTML = gradResult.map(g => {
            const c = palette[g.velocity] || palette[0];
            return `<div style="flex:1;background:${toHex(c.r,c.g,c.b)}"></div>`;
        }).join('');
        document.getElementById('publish-name-input').value = '';
        document.getElementById('publish-desc-input').value = '';
        document.getElementById('publish-desc-count').textContent = '0';
        document.getElementById('publish-review-notice').style.display = 'none';
        document.getElementById('publish-modal').classList.add('open');
    }

    document.getElementById('publish-desc-input')?.addEventListener('input', e => {
        document.getElementById('publish-desc-count').textContent = e.target.value.length;
    });
    ['publish-modal-close','publish-cancel-btn'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            document.getElementById('publish-modal').classList.remove('open');
        });
    });
    document.getElementById('publish-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('publish-modal'))
            document.getElementById('publish-modal').classList.remove('open');
    });

    document.getElementById('publish-confirm-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('publish-name-input').value.trim();
        const desc = document.getElementById('publish-desc-input').value.trim();
        if (!name) { showToast('Add a name first', 'warning'); return; }
        const btn = document.getElementById('publish-confirm-btn');
        btn.disabled = true; btn.textContent = 'Publishing…';
        try {
            const state      = getEditorState();
            const gradResult = getGradResult();
            const palette    = getPalette();
            const meta       = buildMeta(state, gradResult, palette);
            const result     = await publishGradient(name, desc, state, meta);
            document.getElementById('publish-modal').classList.remove('open');
            if (result.underReview) {
                showToast('Published and under review. A moderator will approve it shortly', 'warning', 5000);
            } else {
                showToast(`"${name}" published to the community!`, 'success');
            }
            _resetCommunityFeed();
        } catch (err) {
            showToast(err.message, 'error', 6000);
        } finally { btn.disabled = false; btn.textContent = '↑ Publish'; }
    });

    // public API ────────────────────────────────────────────────────

    return { open, close, saveCurrentGradient };
}