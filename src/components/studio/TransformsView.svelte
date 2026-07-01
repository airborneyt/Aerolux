<!-- src/components/studio/TransformsView.svelte -->
<!--
    Shows the node chain as a vertical list.
    Accepts drops from NodeMenu.
    Click a node to select it (inspector updates).
    Drag nodes within the list to reorder.
-->
<script>
import { kinetic, addNode, removeNode, moveNode, toggleNode } from '../../stores/kinetic.svelte.js';
import { NODE_BY_ID } from '../../lib/aerolux/nodeRegistry.js';

function onDrop(e) {
    e.preventDefault();
    const nodeId = e.dataTransfer.getData('aerolux/nodeId');
    if (nodeId) addNode(nodeId);
}

function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
</script>

<div class="transforms-view"
    ondrop={onDrop}
    ondragover={onDragOver}
>
    {#if !kinetic.nodeChain.length}
        <div class="transforms-empty">
            <p>Drag nodes here from the menu, or double-click them.</p>
        </div>
    {:else}
        <div class="transforms-chain">
            <!-- Input sentinel -->
            <div class="chain-sentinel">
                <span class="chain-sentinel-label">Input clip</span>
                <div class="chain-arrow">↓</div>
            </div>

            {#each kinetic.nodeChain as instance, i (instance.instanceId)}
                {@const desc = NODE_BY_ID[instance.nodeId]}
                <div
                    class="chain-node {kinetic.selectedNodeId === instance.instanceId ? 'selected' : ''} {!instance.enabled ? 'bypassed' : ''}"
                    style="--node-color:{desc?.timelineColor ?? 'hsl(210,60%,50%)'}"
                    onclick={() => kinetic.selectedNodeId = instance.instanceId}
                >
                    <span class="chain-node-icon">{desc?.icon ?? '?'}</span>
                    <span class="chain-node-label">{desc?.label ?? instance.nodeId}</span>

                    <!-- Param summary -->
                    <span class="chain-node-params">
                        {#each Object.entries(instance.params) as [k, v]}
                            {#if typeof v === 'number'}
                                <span class="chain-param-pill">
                                    {desc.params[k]?.label ?? k}:
                                    {v.toFixed(desc.params[k]?.decimals ?? 0)}{desc.params[k]?.unit ?? ''}
                                </span>
                            {/if}
                        {/each}
                    </span>

                    <div class="chain-node-actions">
                        <button class="chain-action-btn"
                            onclick={(e) => {
                                e.stopPropagation();
                                moveNode(instance.instanceId, -1);
                            }}
                            disabled={i === 0} title="Move earlier">↑</button>
                        <button class="chain-action-btn"
                            onclick={(e) => {
                                e.stopPropagation();
                                moveNode(instance.instanceId, 1);
                            }}
                            disabled={i === kinetic.nodeChain.length - 1} title="Move later">↓</button>
                        <button class="chain-action-btn"
                            onclick={(e) => {
                                e.stopPropagation();
                                toggleNode(instance.instanceId);
                            }}
                            title={instance.enabled ? 'Bypass' : 'Enable'}
                        >{instance.enabled ? '⏸' : '⏺'}</button>
                        <button class="chain-action-btn danger"
                            onclick={(e) => {
                                e.stopPropagation();
                                removeNode(instance.instanceId);
                            }}
                            title="Remove">✕</button>
                    </div>
                </div>
                {#if i < kinetic.nodeChain.length - 1}
                    <div class="chain-arrow">↓</div>
                {/if}
            {/each}

            <!-- Output sentinel -->
            <div class="chain-arrow">↓</div>
            <div class="chain-sentinel">
                <span class="chain-sentinel-label">Output</span>
            </div>
        </div>
    {/if}
</div>

<style>
.transforms-view {
    flex:       1;
    overflow-y: auto;
    padding:    16px;
}

.transforms-empty {
    display:         flex;
    align-items:     center;
    justify-content: center;
    height:          200px;
    color:           var(--color-text-dim);
    font-size:       var(--font-size-sm);
    border:          2px dashed var(--color-border);
    border-radius:   var(--radius-lg);
}

.transforms-chain {
    display:        flex;
    flex-direction: column;
    align-items:    flex-start;
    gap:            0;
    max-width:      600px;
}

.chain-node {
    display:       flex;
    align-items:   center;
    gap:           10px;
    width:         100%;
    padding:       10px 12px;
    border:        2px solid var(--node-color, var(--color-border));
    border-radius: var(--radius-lg);
    background:    color-mix(in srgb, var(--node-color, var(--color-accent)) 12%, transparent);
    cursor:        pointer;
    user-select:   none;
    transition:    border-color 0.1s, background 0.1s;
}
.chain-node.selected {
    border-color: var(--node-color, var(--color-accent));
    background:   color-mix(in srgb, var(--node-color, var(--color-accent)) 22%, transparent);
}
.chain-node.bypassed { opacity: 0.4; }

.chain-node-icon  { font-size: 16px; flex-shrink: 0; }
.chain-node-label { font-size: 13px; font-weight: 600; flex-shrink: 0; min-width: 80px; }

.chain-node-params {
    display:   flex;
    flex-wrap: wrap;
    gap:       4px;
    flex:      1;
}
.chain-param-pill {
    font-size:     10px;
    padding:       1px 6px;
    border-radius: var(--radius-xs);
    border:        1px solid var(--color-border);
    color:         var(--color-text-dim);
    font-family:   'Geist Mono', monospace;
}

.chain-node-actions {
    display:    flex;
    gap:        3px;
    flex-shrink:0;
}
.chain-action-btn {
    width:         24px; height: 24px;
    border:        1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background:    transparent;
    color:         var(--color-text-dim);
    font-size:     11px;
    cursor:        pointer;
}
.chain-action-btn:hover { background: var(--color-surface-2); color: var(--color-text); }
.chain-action-btn:disabled { opacity: 0.25; cursor: not-allowed; }
.chain-action-btn.danger:hover { background: var(--color-danger-subtle); color: var(--color-danger); }

.chain-arrow {
    font-size: 16px;
    color:     var(--color-text-dim);
    padding:   2px 16px;
    align-self:flex-start;
}

.chain-sentinel {
    padding:       8px 12px;
    border:        1px dashed var(--color-border);
    border-radius: var(--radius-md);
    color:         var(--color-text-dim);
    font-size:     11px;
    width:         100%;
}
.chain-sentinel-label { font-family: 'Geist Mono', monospace; }
</style>