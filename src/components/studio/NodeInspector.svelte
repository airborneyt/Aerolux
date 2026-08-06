<!-- src/components/studio/NodeInspector.svelte -->
<!--
    Auto-generates inspector controls from a node's descriptor (NODE_DEFS).
    Purely param-editing UI -- never touches the runtime Field representation.
-->
<script>
import {
    kinetic, currentInstances, setParam, toggleNode, removeNode,
    setTimeRange, openComposite, rebakeComposite, unbakeComposite, renameNode, deviceLabel,
} from '../../stores/kinetic.svelte.js';
import { registerRenameRequestHandler, unregisterRenameRequestHandler } from '../../stores/kineticUiSignals.svelte.js';
import { onMount, onDestroy } from 'svelte';
import { NODE_DEFS } from '../../lib/aerolux/kinetic/nodeRegistry.js';
import { editor } from '../../stores/velocity.svelte.js';
import KnobControl from './controls/KnobControl.svelte';
import ToggleControl from './controls/ToggleControl.svelte';
import SelectControl from './controls/SelectControl.svelte';
import ColourOrGradientControl from './controls/ColourOrGradientControl.svelte';
import ClipImportControl from './controls/ClipImportControl.svelte';

const instance = $derived(
    currentInstances().find(n => n.instanceId === kinetic.selectedInstanceId) ?? null
);
const def = $derived(instance ? NODE_DEFS[instance.nodeId] : null);

// The Output node's `target` param has only 'canvas' as a static option in
// NODE_DEFS -- specific device ids get appended here (Phase 4), and 'group'
// is a synthetic target only ever set programmatically by grouping (Step 2),
// never offered as a manual choice here.
const outputTargetOptions = $derived([
    { value: 'canvas', label: 'Canvas (all devices)' },
    ...kinetic.devices.map(d => ({
        value: d.id,
        label: `${deviceLabel(d)}${d.isPrimary ? ' — primary' : ''}`,
    })),
]);

// ── Rename ─────────────────────────────────────────────────────────────
// Double-click the label to rename inline (below). ALSO reachable from
// NodeGraph.svelte's context menu, which previously used window.prompt()
// -- unreliable/frequently unimplemented in embedded webviews, and
// reported as simply not working. That path now calls requestRename()
// (kineticUiSignals.svelte.js), which this component answers by entering
// the exact same inline-edit mode as a double-click would, via a plain
// registered callback rather than reactive $state -- writing to a $state
// that the SAME effect reads as a dependency is a classic
// self-retriggering footgun in Svelte 5 runes, and a plain function call
// sidesteps it entirely.
let renaming = $state(false);
let renameDraft = $state('');

function startRename() {
    if (!instance) return;
    renameDraft = instance.label || def?.label || '';
    renaming = true;
}
function commitRename() {
    if (!renaming) return; // guards the redundant blur that firing commitRename() via Enter can trigger
    renaming = false;
    if (!instance) return;
    renameNode(instance.instanceId, renameDraft.trim());
}
function onRenameKeydown(e) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') renaming = false;
}

onMount(() => {
    const handler = (id) => {
        if (instance && instance.instanceId === id) startRename();
    };
    registerRenameRequestHandler(handler);
    return () => unregisterRenameRequestHandler(handler);
});

// Selecting a different node while mid-rename abandons the edit rather
// than risk applying a stale draft to the newly-selected node.
let lastInstanceId = null;
$effect(() => {
    const id = instance?.instanceId ?? null;
    if (id !== lastInstanceId) {
        lastInstanceId = id;
        renaming = false;
    }
});

// ── Active range (timeRange) ─────────────────────────────────────────────
const hasRange = $derived(!!instance?.timeRange);
let draftStart = $state(0);
let draftEnd   = $state(480);
$effect(() => {
    if (instance?.timeRange) {
        draftStart = instance.timeRange.start ?? 0;
        draftEnd   = instance.timeRange.end ?? 480;
    }
});

function toggleRange() {
    if (!instance) return;
    if (hasRange) setTimeRange(instance.instanceId, null, null);
    else setTimeRange(instance.instanceId, draftStart, draftEnd);
}
function commitRange() {
    if (!instance || !hasRange) return;
    setTimeRange(instance.instanceId, draftStart, draftEnd);
}

// ── Bake (Step 3) ──────────────────────────────────────────────────────
function handleRebake() {
    if (!instance) return;
    rebakeComposite(instance.instanceId, { palette: editor.palette, devices: kinetic.devices }, {});
}
function handleUnbake() {
    if (!instance) return;
    unbakeComposite(instance.instanceId);
}
</script>

{#if instance && def}
    <div class="insp-header">
        <span class="insp-icon">{def.icon}</span>
        {#if renaming}
            <input
                class="al-text-input insp-rename-input"
                bind:value={renameDraft}
                onblur={commitRename}
                onkeydown={onRenameKeydown}
                autofocus
            />
        {:else}
            <span
                class="insp-label"
                ondblclick={startRename}
                title="Double-click to rename"
            >{instance.label || def.label}</span>
        {/if}
        <div class="insp-actions">
            <button
                class="al-btn al-btn-sm {instance.enabled ? '' : 'al-btn-danger'}"
                onclick={() => toggleNode(instance.instanceId)}
                title={instance.enabled ? 'Bypass' : 'Bypassed — click to re-enable'}
            >{instance.enabled ? '⏺' : '⏸'}</button>
            <button class="al-btn al-btn-sm al-btn-ghost" onclick={() => removeNode(instance.instanceId)}>✕</button>
        </div>
    </div>

    {#if def.hint}
        <p class="al-hint-text" style="margin-bottom:14px">{def.hint}</p>
    {/if}

    {#if instance.nodeId === 'composite'}
        <div class="insp-composite-block">
            <button class="al-btn al-btn-blue" style="width:100%" onclick={() => openComposite(instance.instanceId)}>
                ▣ Open composite
            </button>
            <div class="insp-bake-row">
                <span class="al-status-pill">
                    <span class="al-status-dot {instance.baked ? 'ok' : ''}"></span>
                    {instance.baked ? 'Baked' : 'Not baked'}
                </span>
                {#if instance.baked}
                    <button class="al-btn al-btn-sm" onclick={handleRebake}>↻ Re-bake</button>
                    <button class="al-btn al-btn-sm al-btn-ghost" onclick={handleUnbake}>Un-bake</button>
                {:else}
                    <button class="al-btn al-btn-sm al-btn-green" onclick={handleRebake}>⬢ Bake</button>
                {/if}
            </div>
        </div>
        <div class="al-divider"></div>
    {/if}

    <div class="insp-params">
        {#each Object.entries(def.params) as [key, p]}
            {@const value = instance.params[key]}
            <div class="insp-row">
                {#if p.type === 'knob'}
                    <KnobControl
                        label={p.label} value={value} min={p.min} max={p.max}
                        unit={p.unit ?? ''} wrap={p.wrap ?? false} decimals={p.decimals ?? 0}
                        hint={p.hint ?? ''}
                        onchange={v => setParam(instance.instanceId, key, v)}
                    />
                {:else if p.type === 'toggle'}
                    <ToggleControl
                        label={p.label} value={value} hint={p.hint ?? ''}
                        onchange={v => setParam(instance.instanceId, key, v)}
                    />
                {:else if p.type === 'select'}
                    <SelectControl
                        label={p.label} value={value}
                        options={(instance.nodeId === 'output' && key === 'target') ? outputTargetOptions : p.options}
                        hint={p.hint ?? ''}
                        onchange={v => setParam(instance.instanceId, key, v)}
                    />
                {:else if p.type === 'paletteColour'}
                    <!-- Legacy dispatch, kept alive for un-migrated nodes.
                         See nodeRegistry.patch.md's "remaining mechanical
                         follow-up" list -- once every colourIdx param is
                         migrated to 'colourOrGradient', this branch (and
                         PaletteColourControl.svelte itself) can be deleted. -->
                    <PaletteColourControl
                        label={p.label} value={value}
                        onchange={v => setParam(instance.instanceId, key, v)}
                    />
                {:else if p.type === 'colourOrGradient'}
                    <ColourOrGradientControl
                        label={p.label} value={value} hint={p.hint ?? ''}
                        onchange={v => setParam(instance.instanceId, key, v)}
                    />
                {:else if p.type === 'clipImport'}
                    <ClipImportControl
                        label={p.label} value={value}
                        onchange={v => setParam(instance.instanceId, key, v)}
                    />
                {:else if p.type === 'int' || p.type === 'float'}
                    <div class="insp-number-wrap">
                        <p class="al-label">{p.label}</p>
                        <input
                            type="number"
                            class="al-num-input"
                            value={value}
                            min={p.min}
                            max={p.max}
                            step={p.step ?? (p.type === 'int' ? 1 : 0.01)}
                            onchange={e => setParam(
                                instance.instanceId, key,
                                p.type === 'int' ? parseInt(e.target.value) : parseFloat(e.target.value)
                            )}
                        />
                        {#if p.hint}<p class="al-hint-text" style="margin-top:4px">{p.hint}</p>{/if}
                    </div>
                {/if}
            </div>
        {/each}
    </div>

    <div class="al-divider"></div>

    <div class="insp-range-block">
        <div class="al-setting-row" style="padding:0 0 8px">
            <div>
                <div class="al-setting-label">Active range</div>
                <div class="al-setting-desc">Limit this node to a tick window instead of always-on.</div>
            </div>
            <label class="al-toggle-wrap">
                <input type="checkbox" checked={hasRange} onchange={toggleRange} />
                <span class="al-dim">{hasRange ? 'Limited' : 'Always active'}</span>
            </label>
        </div>
        {#if hasRange}
            <div class="insp-range-inputs">
                <label>
                    <span class="al-dim" style="font-size:10px">Start</span>
                    <input type="number" class="al-num-input" bind:value={draftStart} min="0" onchange={commitRange} />
                </label>
                <label>
                    <span class="al-dim" style="font-size:10px">End</span>
                    <input type="number" class="al-num-input" bind:value={draftEnd} min="0" onchange={commitRange} />
                </label>
            </div>
        {/if}
    </div>
{:else}
    <p class="al-hint-text" style="padding:8px 0">Select a node in the graph to inspect it here.</p>
{/if}

<style>
.insp-header {
    display:      flex;
    align-items:  center;
    gap:          8px;
    margin-bottom:12px;
    padding-bottom:10px;
    border-bottom:1px solid var(--color-border);
}
.insp-icon  { font-size: 18px; }
.insp-label { font-size: 14px; font-weight: 600; flex: 1; cursor: text; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.insp-rename-input { flex: 1; height: 26px; font-size: 13px; font-weight: 600; }
.insp-actions { display: flex; gap: 4px; }
.insp-params { display: flex; flex-direction: column; gap: 18px; }
.insp-number-wrap { flex: 1; }

.insp-composite-block { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
.insp-bake-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

.insp-range-block  { display:flex; flex-direction:column; gap:8px; }
.insp-range-inputs { display:flex; gap:12px; }
.insp-range-inputs label { display:flex; flex-direction:column; gap:3px; }
</style>