<!-- src/components/velocity/AutomationPanel.svelte -->
<!--
    automation panel
    switches between the python automation mode
    and the airbot automation mode
-->

<script>
import PythonPanel        from './PythonPanel.svelte';
import AirbotAgenticPanel from './AirbotAgenticPanel.svelte';

let mode = $state('python');
</script>


<div class="al-card-header">
    <h3 class="al-card-title">Automation</h3>
    <div style="display:flex;gap:6px;align-items:center">
        <span class="al-label" style="margin:0">Mode</span>
        <div class="al-sort-tabs" id="auto-mode-tabs">
            <button
                class="al-stab {mode === 'python' ? 'active' : ''}"
                onclick={() => mode = 'python'}
            >Python script</button>
            <button
                class="al-stab {mode === 'airbot' ? 'active' : ''}"
                onclick={() => mode = 'airbot'}
            >Airbot automation</button>
        </div>
    </div>
</div>


{#if mode === 'python'}
    <PythonPanel />
{:else}
    <AirbotAgenticPanel />
{/if}