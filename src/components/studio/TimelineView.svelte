<!-- src/components/studio/TimelineView.svelte -->
<script>
import { kinetic, addNode } from '../../stores/kinetic.svelte.js';
import { NODE_BY_ID } from '../../lib/aerolux/nodeRegistry.js';

// Rough timeline: show note events as dots, node chain as coloured blocks below
const notesByTime = $derived.by(() => {
    if (!kinetic.parsedMidi) return [];
    const maxTime = Math.max(...kinetic.parsedMidi.noteOns.map(e => e.absTime), 1);
    return kinetic.parsedMidi.noteOns.map(e => ({
        x: e.absTime / maxTime,
        vel: e.velocity,
    }));
});

function onDrop(e) {
    e.preventDefault();
    const nodeId = e.dataTransfer.getData('aerolux/nodeId');
    if (nodeId) addNode(nodeId);
}
function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
</script>

<div class="timeline-view" ondrop={onDrop} ondragover={onDragOver}>

    <!-- Clip row -->
    <div class="tl-track-label">Clip</div>
    <div class="tl-track">
        {#if kinetic.parsedMidi}
            <div class="tl-clip">
                <span class="tl-clip-label">{kinetic.fileLabel}</span>
                <!-- Note density visualisation -->
                <svg class="tl-density" viewBox="0 0 1 1" preserveAspectRatio="none">
                    {#each notesByTime as n}
                        <rect x={n.x} y="0" width="0.003" height="1"
                            fill="rgba(255,255,255,0.4)" />
                    {/each}
                </svg>
            </div>
        {:else}
            <div class="tl-empty">No clip loaded</div>
        {/if}
    </div>

    <!-- One row per node in the chain -->
    {#each kinetic.nodeChain as instance (instance.instanceId)}
        {@const desc = NODE_BY_ID[instance.nodeId]}
        <div class="tl-track-label">{desc?.icon} {desc?.label}</div>
        <div class="tl-track">
            <!-- Node spans the full clip duration -->
            <div
                class="tl-node-block {kinetic.selectedNodeId === instance.instanceId ? 'selected' : ''} {!instance.enabled ? 'bypassed' : ''}"
                style="--node-color:{desc?.timelineColor ?? 'hsl(210,60%,50%)'};left:0;width:100%"
                onclick={() => kinetic.selectedNodeId = instance.instanceId}
            >
                <span class="tl-node-block-label">{desc?.label}</span>
                <!-- Future: automation lane breakpoints would appear here -->
            </div>
        </div>
    {/each}

    <!-- Drop hint if no nodes -->
    {#if !kinetic.nodeChain.length}
        <div class="tl-drop-hint">
            Drag a node here from the menu to add it to the chain
        </div>
    {/if}

</div>

<style>
.timeline-view {
    flex:       1;
    overflow:   auto;
    padding:    12px 16px;
    display:    grid;
    grid-template-columns: 120px 1fr;
    gap:        4px;
    align-content: start;
}

.tl-track-label {
    display:     flex;
    align-items: center;
    font-size:   11px;
    color:       var(--color-text-dim);
    padding-right: 8px;
    white-space: nowrap;
}

.tl-track {
    position:  relative;
    height:    36px;
    background:var(--color-surface-0);
    border:    1px solid var(--color-border);
    border-radius: var(--radius-sm);
    overflow:  hidden;
}

.tl-clip {
    position:     absolute;
    inset:        2px;
    background:   var(--color-surface-2);
    border-radius:var(--radius-xs);
    display:      flex;
    align-items:  center;
    padding:      0 8px;
    overflow:     hidden;
}
.tl-clip-label {
    font-size:   11px;
    color:       var(--color-text-secondary);
    z-index:     1;
    white-space: nowrap;
}
.tl-density {
    position: absolute;
    inset:    0;
    width:    100%;
    height:   100%;
}

.tl-node-block {
    position:     absolute;
    top:          2px; bottom: 2px;
    border-radius:var(--radius-xs);
    background:   color-mix(in srgb, var(--node-color) 30%, transparent);
    border:       1px solid var(--node-color);
    cursor:       pointer;
    padding:      0 8px;
    display:      flex;
    align-items:  center;
    transition:   background 0.1s;
}
.tl-node-block.selected { background: color-mix(in srgb, var(--node-color) 50%, transparent); }
.tl-node-block.bypassed { opacity: 0.35; }
.tl-node-block-label { font-size: 10px; font-weight: 600; color: var(--color-text); }

.tl-empty {
    display:         flex;
    align-items:     center;
    justify-content: center;
    height:          100%;
    font-size:       11px;
    color:           var(--color-text-dim);
}

.tl-drop-hint {
    grid-column:     1 / -1;
    padding:         20px;
    text-align:      center;
    font-size:       12px;
    color:           var(--color-text-dim);
    border:          2px dashed var(--color-border);
    border-radius:   var(--radius-lg);
    margin-top:      8px;
}
</style>