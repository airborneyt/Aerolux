<!-- src/components/studio/NodeInspector.svelte -->
<!--
    Auto-generates inspector controls from a node descriptor's params.
    Used by KineticInspector.svelte when no custom inspector component exists.
-->
<script>
import { NODE_BY_ID } from '../../lib/aerolux/nodeRegistry.js';
import { kinetic, setParam, toggleNode, removeNode } from '../../stores/kinetic.svelte.js';
import KnobControl from './controls/KnobControl.svelte';
import ToggleControl from './controls/ToggleControl.svelte';
import SelectControl from './controls/SelectControl.svelte';
import SplinePointsControl from './controls/SplinePointsControl.svelte';
import SplineAdvancedEditor from './SplineAdvancedEditor.svelte';
import GradientRefControl  from './controls/GradientRefControl.svelte';
import PaletteColourControl from './controls/PaletteColourControl.svelte';
import ClipImportControl from './controls/ClipImportControl.svelte';

let { instance } = $props();

let advancedEditorOpen = $state(false);

const desc = $derived(NODE_BY_ID[instance?.nodeId]);
</script>

{#if instance && desc}
    <div class="insp-node-header">
        <span class="insp-node-icon">{desc.icon}</span>
        <span class="insp-node-label">{desc.label}</span>
        <div class="insp-node-actions">
            <button
                class="al-btn al-btn-sm {instance.enabled ? '' : 'al-btn-danger'}"
                onclick={() => toggleNode(instance.instanceId)}
                title={instance.enabled ? 'Bypass' : 'Bypassed. Click to re-enable'}
            >{instance.enabled ? '⏺' : '⏸'}</button>
            <button
                class="al-btn al-btn-sm al-btn-ghost"
                onclick={() => removeNode(instance.instanceId)}
            >✕</button>
        </div>
    </div>

    {#if desc.hint}
        <p class="al-hint-text" style="margin-bottom:14px">{desc.hint}</p>
    {/if}

    <div class="insp-params">
        {#each Object.entries(desc.params) as [key, paramDesc]}

            <!-- Special types: routed to custom components -->
            {#if paramDesc.type === 'splinePoints'}
                <SplinePointsControl
                    value={instance.params[key]}
                    device={kinetic.device}
                    onchange={v => setParam(instance.instanceId, key, v)}
                />
                <button
                    class="al-btn"
                    style="width:100%;margin-top:6px;font-size:11px"
                    onclick={() => advancedEditorOpen = true}
                >
                    ✦ Advanced editor
                </button>

            {:else if paramDesc.type === 'gradientRef'}
                <GradientRefControl
                    label={paramDesc.label}
                    value={instance.params[key]}
                    hint={paramDesc.hint}
                    onchange={v => setParam(instance.instanceId, key, v)}
                />
            {:else if paramDesc.type === 'paletteColour'}
                <PaletteColourControl
                    label={paramDesc.label}
                    value={instance.params[key]}
                    onchange={v => setParam(instance.instanceId, key, v)}
                />   
            {:else if paramDesc.type === 'clipImport'}
                <ClipImportControl
                    instanceId={instance.instanceId}
                    label={paramDesc.label}
                    value={instance.params[key]}
                    onchange={v => setParam(instance.instanceId, key, v)}
                />    

            <!-- Standard auto-generated controls -->
            {:else}
                <div class="insp-param-row">
                    {#if paramDesc.type === 'knob'}
                        <KnobControl
                            label={paramDesc.label}
                            value={instance.params[key]}
                            min={paramDesc.min}
                            max={paramDesc.max}
                            unit={paramDesc.unit ?? ''}
                            wrap={paramDesc.wrap ?? false}
                            decimals={paramDesc.decimals ?? 0}
                            hint={paramDesc.hint ?? ''}
                            onchange={v => setParam(instance.instanceId, key, v)}
                        />
                    {:else if paramDesc.type === 'toggle'}
                        <ToggleControl
                            label={paramDesc.label}
                            value={instance.params[key]}
                            hint={paramDesc.hint ?? ''}
                            onchange={v => setParam(instance.instanceId, key, v)}
                        />
                    {:else if paramDesc.type === 'select'}
                        <div class="insp-select-wrap">
                            <p class="al-label">{paramDesc.label}</p>
                            {#if paramDesc.hint}
                                <p class="al-hint-text" style="margin-bottom:6px">{paramDesc.hint}</p>
                            {/if}
                            <select class="al-select"
                                value={instance.params[key]}
                                onchange={e => setParam(instance.instanceId, key, e.target.value)}>
                                {#each paramDesc.options as opt}
                                    <option value={opt.value}>{opt.label}</option>
                                {/each}
                            </select>
                        </div>
                    {:else if paramDesc.type === 'int' || paramDesc.type === 'float'}
                        <div class="insp-number-wrap">
                            <p class="al-label">{paramDesc.label}</p>
                            <input
                                type="number"
                                class="al-num-input"
                                value={instance.params[key]}
                                min={paramDesc.min}
                                max={paramDesc.max}
                                step={paramDesc.step ?? (paramDesc.type === 'int' ? 1 : 0.01)}
                                onchange={e => setParam(instance.instanceId, key,
                                    paramDesc.type === 'int'
                                        ? parseInt(e.target.value)
                                        : parseFloat(e.target.value)
                                )}
                            />
                            {#if paramDesc.hint}
                                <p class="al-hint-text" style="margin-top:4px">{paramDesc.hint}</p>
                            {/if}
                        </div>
                    {/if}

                    <!-- Automation lane button (future) -->
                    {#if ['knob','float','int'].includes(paramDesc.type)}
                        <button class="insp-auto-btn" disabled title="Automation lanes coming soon">A</button>
                    {/if}
                </div>
            {/if}

        {/each}
    </div>
{:else}
    <p class="al-hint-text" style="padding:8px 0">
        Select a node in the Transforms or Timeline view to edit it here.
    </p>
{/if}

{#if advancedEditorOpen && instance && NODE_BY_ID[instance.nodeId]?.params?.controlPoints}
    <SplineAdvancedEditor
        bind:points={instance.params.controlPoints}
        bind:curved={instance.params.curved}
        bind:tension={instance.params.tension}
        bind:smoothing={instance.params.smoothing}
        onclose={() => advancedEditorOpen = false}
        onchange={(pts, cur, ten, smo) => {
            setParam(instance.instanceId, 'controlPoints', pts);
            setParam(instance.instanceId, 'curved',        cur);
            setParam(instance.instanceId, 'tension',       ten);
            setParam(instance.instanceId, 'smoothing',     smo);
        }}
    />
{/if}

<style>
.insp-node-header {
    display:      flex;
    align-items:  center;
    gap:          8px;
    margin-bottom:12px;
    padding-bottom:10px;
    border-bottom:1px solid var(--color-border);
}
.insp-node-icon  { font-size: 18px; }
.insp-node-label { font-size: 14px; font-weight: 600; flex: 1; }
.insp-node-actions { display: flex; gap: 4px; }
.insp-params { display: flex; flex-direction: column; gap: 18px; }
.insp-param-row {
    display:     flex;
    align-items: flex-start;
    gap:         6px;
}
.insp-select-wrap, .insp-number-wrap { flex: 1; }
.insp-auto-btn {
    width: 18px; height: 18px; flex-shrink: 0; margin-top: 22px;
    border: 1px solid var(--color-border); border-radius: 3px;
    background: transparent; color: var(--color-text-dim);
    font-size: 9px; font-weight: 700; cursor: pointer; opacity: 0.4;
}
</style>