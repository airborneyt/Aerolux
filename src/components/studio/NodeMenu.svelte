<!-- src/components/studio/NodeMenu.svelte -->
<!--
    persistent, category-browsable node menu. complements NodeGraph.svelte's 
    own double-click-to-search-add overlay: that one is for quick 
    keyboard-driven adding at a specific canvas position; this one 
    is the always-visible browsable list the mockup calls for. both 
    call the same store addNode() underneath.

    drag-to-canvas: items can be dragged onto NodeGraph.svelte's canvas 
    to add them at the drop position. originally built on the native 
    HTML5 Drag and Drop API (draggable="true" + dragstart/dragover/drop)
    but that was completely non-functional, and might be for the reason 
    documented in kineticUiSignals.svelte.js: Tauri's webview intercepts 
    OS-level drag-and-drop at the window level, which commonly swallows drop 
    events before they ever reach page JS. rebuilt on plain pointer events
    (pointerdown/pointermove/pointerup) instead, coordinating with
    NodeGraph.svelte via the shared nodeDragGhost signal.

    clicking still works exactly as before though (handleAdd); 
    a plain click is a pointerdown+pointerup with no
    meaningful movement between them, so it never crosses DRAG_THRESHOLD_PX
    and the drag path never activates for it.

    internal:true registry entries (groupInput/groupInputB/composite) are
    excluded; they're produced only by grouping, never added
    manually. see nodeRegistry.js's own comment on each of those entries.
-->
<script>
import { addNode } from '../../stores/kinetic.svelte.js';
import { NODE_DEFS } from '../../lib/aerolux/kinetic/nodeRegistry.js';
import { nodeDragGhost, startNodeDrag, updateNodeDrag, endNodeDrag } from '../../stores/kineticUiSignals.svelte.js';
import { hapticConfirm } from '../../lib/aerolux/haptics.js';

const DRAG_THRESHOLD_PX = 4;

const CATEGORY_STRUCTURE = [
    {
        id: 'generator', label: 'Generators',
        subcategories: [
            { id: 'shape', label: 'Shapes' },
        ],
    },
    {   
        id: 'transform', label: 'Transforms',
    },
    {   
        id: 'colour', label: 'Colour',
    },
    {
        id: 'temporal', label: 'Temporal',
    },
    {
        id: 'simulation', label: 'Simulations',
    },
    {
        id: 'modifier', label: 'Modifiers',
    },
    {
        id: 'utility', label: 'Utility'
    },
]

let query = $state('');
let expanded = $state(new Set(CATEGORY_STRUCTURE.map(category => category.id)));
let expandedSubcategories = $state(
    new Set(
        CATEGORY_STRUCTURE.flatMap(category =>
            category.subcategories?.map(subcategory =>
                `${category.id}:${subcategory.id}`
            )
        )
    )
);

const visibleDefs = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return Object.values(NODE_DEFS)
        .filter(d => !d.internal)
        .filter(d => !q || d.label.toLowerCase().includes(q) || d.category.toLowerCase().includes(q) || d.subcategory?.toLowerCase().includes(q));
});

const grouped = $derived.by(() => {
    const result = new Map();
    for (const category of CATEGORY_STRUCTURE) {
        result.set(category.id, {
            directNodes: [],
            subcategories: new Map(
                category.subcategories?.map(subcategory => [
                    subcategory.id,
                    []
                ])
            )
        });
    }
    for (const def of visibleDefs) {
        if (!result.has(def.category)) {
            result.set(def.category, {
                directNodes: [],
                subcategories: new Map()
            });
        }
        const category = result.get(def.category);
        if (def.subcategory) {
            if (!category.subcategories.has(def.subcategory)) {
                category.subcategories.set(def.subcategory, []);
            }
            category.subcategories
                .get(def.subcategory)
                .push(def);
        } else {
            category.directNodes.push(def);
        }
    }
    return result;
});

function toggleCategory(cat) {
    const next = new Set(expanded);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    expanded = next;
}

function toggleSubcategory(categoryId, subcategoryId) {
    const key = `${categoryId}:${subcategoryId}`;
    const next = new Set(expandedSubcategories);
    next.has(key) ? next.delete(key) : next.add(key);
    expandedSubcategories = next;
}

function defaultParamsFor(def) {
    const params = {};
    for (const [key, p] of Object.entries(def.params ?? {})) params[key] = p.default;
    return params;
}

function handleAdd(def) {
    hapticConfirm();
    addNode(def.id, defaultParamsFor(def));
}

// drag –––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
let pending = null; // {def, startX, startY}

function onItemPointerDown(e, def) {
    if (e.button !== 0) return;
    pending = { def, startX: e.clientX, startY: e.clientY };
    window.addEventListener('pointermove', onItemPointerMove);
    window.addEventListener('pointerup', onItemPointerUp);
}

function onItemPointerMove(e) {
    if (!pending) return;
    if (!nodeDragGhost.active) {
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        document.body.classList.add('dragging');
        startNodeDrag(pending.def.id, pending.def, e.clientX, e.clientY);
    } else {
        updateNodeDrag(e.clientX, e.clientY);
    }
}

function onItemPointerUp(e) {
    window.removeEventListener('pointermove', onItemPointerMove);
    window.removeEventListener('pointerup', onItemPointerUp);
    document.body.classList.remove('dragging');
    if (nodeDragGhost.active) endNodeDrag(e.clientX, e.clientY);
    pending = null;
}
</script>

<div class="nm-wrap">
    <div class="nm-search">
        <input class="al-input" type="text" placeholder="Search nodes…" bind:value={query} />
    </div>

    <div class="nm-list">
        {#each CATEGORY_STRUCTURE as category}
            {@const group = grouped.get(category.id)}
            {@const directNodes = group?.directNodes ?? []}
            {@const subcategories = group?.subcategories ?? new Map()}

            {@const categoryNodeCount =
                directNodes.length +
                [...subcategories.values()]
                    .reduce((total, defs) => total + defs.length, 0)
            }

            {#if categoryNodeCount > 0}
                <div class="nm-category">
                    <button class="nm-category-header" onclick={() => toggleCategory(category.id)} >
                        <span class="nm-category-chevron">{expanded.has(category.id) ? '▼' : '▶︎'}</span>
                        <span>{category.label}</span>
                        <span class="nm-category-count">{categoryNodeCount}</span>
                    </button>
                    {#if expanded.has(category.id)}
                        <!-- Nodes directly inside this category -->
                        {#if directNodes.length}
                            <div class="nm-items nm-direct-items">
                                {#each directNodes as def}
                                    <button
                                        class="nm-item"
                                        style="--nc:{def.color}"
                                        onpointerdown={e => onItemPointerDown(e, def)}
                                        onclick={() => handleAdd(def)}
                                        title={def.hint ?? def.label}
                                    >
                                        <span class="nm-item-icon">{def.icon}</span>
                                        <span class="nm-item-label">{def.label}</span>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                        <!-- Subcategories -->
                        {#each category.subcategories as subcategory}
                            {@const defs = subcategories.get(subcategory.id) ?? []}
                            {#if defs.length}
                                {@const subcategoryKey = `${category.id}:${subcategory.id}`}
                                <div class="nm-subcategory">
                                    <button
                                        class="nm-subcategory-header"
                                        onclick={() => toggleSubcategory(category.id, subcategory.id)}
                                    >
                                        <span class="nm-subcategory-chevron">{expandedSubcategories.has(subcategoryKey) ? '▼' : '▶︎'}</span>
                                        <span>{subcategory.label}</span>
                                        <span class="nm-subcategory-count">{defs.length}</span>
                                    </button>
                                    {#if expandedSubcategories.has(subcategoryKey)}
                                        <div class="nm-items">
                                            {#each defs as def}
                                                <button
                                                    class="nm-item"
                                                    style="--nc:{def.color}"
                                                    onpointerdown={e => onItemPointerDown(e, def)}
                                                    onclick={() => handleAdd(def)}
                                                    title={def.hint ?? def.label}
                                                >
                                                    <span class="nm-item-icon">{def.icon}</span>
                                                    <span class="nm-item-label">{def.label}</span>
                                                </button>
                                            {/each}
                                        </div>
                                    {/if}

                                </div>
                            {/if}
                        {/each}
                    {/if}
                </div>
            {/if}
        {/each}
        {#if !visibleDefs.length}
            <p class="al-hint-text" style="padding:12px">No matching nodes.</p>
        {/if}
    </div>
</div>

<style>
.nm-wrap    { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.nm-search  { padding:10px; border-bottom:1px solid var(--color-border); flex-shrink:0; }
.nm-list    { flex:1; overflow-y:auto; padding:6px; }

.nm-category        { margin-bottom:2px; }
.nm-category-header {
    display:flex; align-items:center; gap:6px; width:100%;
    padding:6px 8px; background:transparent; border:none;
    color:var(--color-text-secondary); font-size:11px; font-weight:600;
    text-transform:uppercase; letter-spacing:0.06em; cursor:pointer;
    border-radius:var(--radius-sm); font-family:inherit;
    user-select: none; -webkit-user-select: none;
}
.nm-category-header:hover { background:var(--color-surface-2); color:var(--color-text); }
.nm-category-chevron      { font-size:9px; width:10px; color:var(--color-text-dim); }
.nm-category-count        { margin-left:auto; font-size:10px; color:var(--color-text-dim); font-family:'Geist Mono',monospace; }

.nm-subcategory { margin-bottom: 2px; }
.nm-subcategory-header {
    display: flex; align-items: center; gap: 5px; width: 100%;
    padding: 4px 8px 4px 18px; background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--color-text-dim); font-family: inherit; font-size: 10px; font-weight: 500;
    cursor: pointer; text-align: left;
    user-select: none; -webkit-user-select: none;
}
.nm-subcategory-header:hover { background: var(--color-surface-2); color: var(--color-text-secondary); }
.nm-subcategory-chevron { width: 8px; font-size: 7px; }
.nm-subcategory-count { margin-left: auto; color: var(--color-text-dim); font-family: 'Geist Mono', monospace; font-size: 9px; }

.nm-items { display:flex; flex-direction:column; gap:2px; padding-left:6px; margin-bottom:6px; }
.nm-item {
    display:flex; align-items:center; gap:8px; width:100%;
    padding:6px 8px; background:transparent; border:1px solid transparent;
    border-radius:var(--radius-sm); cursor:grab; text-align:left;
    color:var(--color-text-secondary); font-size:12px; font-family:inherit;
    transition:background var(--duration-fast) var(--ease-smooth), border-color var(--duration-fast) var(--ease-smooth);
    user-select: none; -webkit-user-select: none;
}
.nm-subcategory .nm-items { padding-left: 20px; }
.nm-item:active { cursor:grabbing; }
.nm-item:hover { background:var(--color-surface-2); border-color:var(--color-border); color:var(--color-text); }
.nm-item-icon  { width:16px; text-align:center; color:var(--nc); flex-shrink:0; }
.nm-item-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
</style>
