<!-- src/components/home/RecentProjectsList.svelte -->
<!--
    reads projects.recents directly. renders only as many items as fit
    the available height (measured, not fixed), recalculating on
    resize. holding alt/option swaps the displayed/sorted timestamp
    from lastOpenedAt to modifiedAt for the duration of the keypress.
    pinned entries always sort first.
-->
<script>
import { onMount } from 'svelte';
import { projects, togglePinRecent, removeRecent } from '../../stores/projects.svelte.js';
import { pathExists } from '../../lib/aerolux/project-io.js';

let { onOpenRecent } = $props();

const ITEM_HEIGHT = 56; // in px, matches .rpl-item's rendered height incl. gap

let containerEl  = $state(null);
let containerH   = $state(0);
let altHeld      = $state(false);
let missingPaths = $state(new Set());

// alt/option hold detection ─────────────────────────────────────────
onMount(() => {
    const onKeyChange = (e) => { altHeld = e.altKey; };
    window.addEventListener('keydown', onKeyChange);
    window.addEventListener('keyup',   onKeyChange);
    // altKey can get stuck "true" if focus leaves the window mid-hold
    const onBlur = () => { altHeld = false; };
    window.addEventListener('blur', onBlur);
    return () => {
        window.removeEventListener('keydown', onKeyChange);
        window.removeEventListener('keyup',   onKeyChange);
        window.removeEventListener('blur',    onBlur);
    };
});

// existence check (best-effort) ─────────────────────────────────────
// stale entries (file moved/deleted) still show, but visually muted
// with a small indicator, rather than disappearing or erroring
onMount(async () => {
    const checks = await Promise.all(
        projects.recents.map(async r => [r.path, await pathExists(r.path)])
    );
    missingPaths = new Set(checks.filter(([, exists]) => !exists).map(([path]) => path));
});

// sort: pinned first, then by the active timestamp field ────────────
const sortedRecents = $derived.by(() => {
    const field = altHeld ? 'modifiedAt' : 'lastOpenedAt';
    return [...projects.recents].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b[field] ?? 0) - (a[field] ?? 0);
    });
});

// viewport-based truncation ─────────────────────────────────────────
const visibleCount = $derived(
    containerH > 0 ? Math.max(1, Math.floor(containerH / ITEM_HEIGHT)) : 3
);
const visibleRecents = $derived(sortedRecents.slice(0, visibleCount));

function handleResize() {
    if (containerEl) containerH = containerEl.clientHeight;
}

onMount(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
});

// helpers ───────────────────────────────────────────────────────────

function relativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min  = Math.floor(diff / 60000);
    if (min < 1)   return 'Just now';
    if (min < 60)  return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24)   return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7)   return `${day}d ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const typeLabel = { velocity: 'Velocity', kinetic: 'Kinetic', combined: 'V + K' };
const typeIcon  = { velocity: '◈', kinetic: '⟁', combined: '✦' };

function handlePin(e, path) {
    e.stopPropagation();
    togglePinRecent(path);
}

function handleRemove(e, path) {
    e.stopPropagation();
    removeRecent(path);
}
</script>

<div class="rpl-container" bind:this={containerEl} bind:clientHeight={containerH}>
    {#if !projects.recents.length}
        <div class="al-tip-card">
            <span class="al-tip-icon">🌱</span>
            <span>No recent projects yet. Create one to get started.</span>
        </div>
    {:else}
        {#each visibleRecents as recent (recent.path)}
            {@const missing = missingPaths.has(recent.path)}
            <div
                class="rpl-item {missing ? 'rpl-item-missing' : ''}"
                onclick={() => !missing && onOpenRecent(recent)}
                title={missing ? `File not found: ${recent.path}` : recent.path}
            >
                <div class="rpl-thumb">
                    {#if recent.thumbnail}
                        <img src={recent.thumbnail} alt="" />
                    {:else}
                        <span class="rpl-thumb-icon">{typeIcon[recent.type] ?? '◇'}</span>
                    {/if}
                </div>

                <div class="rpl-info">
                    <div class="rpl-name">
                        {recent.name}
                        {#if missing}<span class="rpl-missing-badge">missing</span>{/if}
                    </div>
                    <div class="rpl-meta">
                        <span class="rpl-type-pill">{typeLabel[recent.type] ?? recent.type}</span>
                        <span class="al-dim">·</span>
                        <span class="al-dim">
                            {altHeld ? 'Modified' : 'Opened'} {relativeTime(altHeld ? recent.modifiedAt : recent.lastOpenedAt)}
                        </span>
                    </div>
                </div>

                <div class="rpl-actions">
                    <button
                        class="rpl-action-btn {recent.pinned ? 'rpl-pinned' : ''}"
                        onclick={(e) => handlePin(e, recent.path)}
                        title={recent.pinned ? 'Unpin' : 'Pin'}
                    >📌</button>
                    <button
                        class="rpl-action-btn"
                        onclick={(e) => handleRemove(e, recent.path)}
                        title="Remove from recents"
                    >✕</button>
                </div>
            </div>
        {/each}
    {/if}
</div>

<style>
.rpl-container {
    display:        flex;
    flex-direction: column;
    gap:            6px;
    flex:           1;
    min-height:     0;
    overflow:       hidden; /* truncation is computed, not scrolled */
}

.rpl-item {
    display:       flex;
    align-items:   center;
    gap:           var(--space-3);
    padding:       var(--space-2) var(--space-3);
    border:        1px solid var(--color-border);
    border-radius: var(--radius-lg);
    cursor:        pointer;
    background:    var(--color-surface-1);
    backdrop-filter:         blur(4px);
    -webkit-backdrop-filter: blur(4px);
    box-shadow:    var(--shadow-card);
    height:        60px;
    transition:    box-shadow var(--duration-fast) var(--ease-smooth),
                   border-color var(--duration-fast) var(--ease-smooth);
}
.rpl-item:hover { box-shadow: var(--shadow-card-hover); border-color: var(--color-border-bright); }

.rpl-item-missing { opacity: 0.5; cursor: not-allowed; }
.rpl-item-missing:hover { box-shadow: var(--shadow-card); border-color: var(--color-border); }

.rpl-thumb {
    width:           125px;
    height:          28px;
    border-radius:   var(--radius-xs);
    overflow:        hidden;
    flex-shrink:     0;
    background:      var(--color-surface-2);
    display:         flex;
    align-items:     center;
    justify-content: center;
}
.rpl-thumb img { width: 100%; height: 100%; object-fit: cover; }
.rpl-thumb-icon { font-size: 14px; opacity: 0.4; }

.rpl-info  { flex: 1; min-width: 0; }
.rpl-name  {
    font-size:     var(--font-size-sm);
    font-weight:   var(--font-weight-medium);
    white-space:   nowrap;
    overflow:      hidden;
    text-overflow: ellipsis;
    display:       flex;
    align-items:   center;
    gap:           6px;
}
.rpl-meta  {
    font-size:   var(--font-size-xs);
    color:       var(--color-text-dim);
    display:     flex;
    align-items: center;
    gap:         5px;
    margin-top:  2px;
}
.rpl-type-pill {
    font-size:     var(--font-size-2xs);
    padding:       1px 6px;
    border-radius: var(--radius-xs);
    border:        1px solid var(--color-border);
    font-family:   'Geist Mono', monospace;
}

.rpl-missing-badge {
    font-size:     var(--font-size-2xs);
    padding:       1px 6px;
    border-radius: var(--radius-xs);
    background:    var(--color-danger-subtle);
    border:        1px solid var(--color-danger-border);
    color:         var(--color-danger);
    flex-shrink:   0;
}

.rpl-actions { display: flex; gap: 3px; flex-shrink: 0; }
.rpl-action-btn {
    width:           22px;
    height:          22px;
    border:          1px solid transparent;
    border-radius:   var(--radius-sm);
    background:      transparent;
    font-size:       11px;
    cursor:          pointer;
    opacity:         0.35;
    display:         flex;
    align-items:     center;
    justify-content: center;
    transition:      opacity var(--duration-fast) var(--ease-smooth),
                     background var(--duration-fast) var(--ease-smooth);
}
.rpl-action-btn:hover  { opacity: 1; background: var(--color-surface-2); }
.rpl-action-btn.rpl-pinned { opacity: 1; }
</style>