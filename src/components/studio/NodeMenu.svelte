<script>
import { getMenuGroups } from '../../lib/aerolux/nodeRegistry.js';
import { addNode } from '../../stores/kinetic.svelte.js';

const groups = getMenuGroups();

function onDragStart(e, desc) {
    e.dataTransfer.setData('aerolux/nodeId', desc.id);
    e.dataTransfer.effectAllowed = 'copy';
}
</script>

<div class="nm-wrap">
    <p class="al-label" style="margin-bottom:10px">Nodes</p>

    {#each groups as group}
        <p class="nm-group-label">{group.icon} {group.label}</p>
        {#each group.nodes as desc}
            <div
                class="nm-chip"
                style="--nc:{desc.color}"
                draggable="true"
                ondragstart={e => onDragStart(e, desc)}
                ondblclick={() => addNode(desc)}
                title="{desc.hint ?? desc.label} · Double-click or drag to add"
            >
                <span class="nm-icon">{desc.icon}</span>
                <span class="nm-label">{desc.label}</span>
            </div>
        {/each}
    {/each}

    <p class="al-hint-text" style="margin-top:14px;font-size:10px">
        Double-click or drag into graph
    </p>
</div>

<style>
.nm-wrap { display: flex; flex-direction: column; }

.nm-group-label {
    font-size:      10px;
    font-weight:    700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color:          var(--color-text-dim);
    margin:         12px 0 4px;
    padding-left:   4px;
}

.nm-chip {
    display:       flex;
    align-items:   center;
    gap:           7px;
    padding:       6px 8px;
    margin-bottom: 4px;
    border:        1px solid var(--color-border);
    border-left:   2px solid var(--nc);
    border-radius: var(--radius-md);
    background:    var(--color-surface-1);
    cursor:        grab;
    font-size:     12px;
    font-weight:   500;
    color:         var(--color-text-secondary);
    user-select:   none;
    transition:    background 0.1s, border-color 0.1s;
}
.nm-chip:hover  { background: var(--color-surface-2); color: var(--color-text); }
.nm-chip:active { cursor: grabbing; }

.nm-icon  { font-size: 14px; flex-shrink: 0; }
.nm-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>