<!-- src/components/velocity/HistoryPanel.svelte -->
<!--
    handles the session history of exported gradients in velocity
-->
<script>
import { editor } from '../../stores/velocity.svelte.js';
import { historyEntries, clearHistory, pushUndo } from '../../stores/velocityActions.svelte.js';
import { showToast } from '../../lib/aerolux/toast.js';
import GradientBar from '../shared/GradientBar.svelte';

// restore a history entry
function restore(entry) {
    pushUndo();
    editor.stops     = JSON.parse(JSON.stringify(entry.stops));
    editor.algorithm = entry.algorithm;
    editor.easing    = entry.easing;
    editor.steps     = entry.steps;
    editor.hslDir    = entry.hslDir    ?? editor.hslDir;
    editor.hueShift  = entry.hueShift  ?? 0;
    editor.tint      = entry.tint      ? { ...entry.tint }     : { ci: null, str: 0, fade: null };
    editor.envelope  = entry.envelope  ? { ...entry.envelope } : { shape: 'none', attack: 0.2, release: 0.2, floor: 0.0 };
    editor.selStop   = entry.stops[0].id;
    editor.nextId    = Math.max(...entry.stops.map(s => s.id)) + 1;
    showToast('History restored', 'success', 1500);
}
</script>

<div class="al-card" id="history-panel">
    <div class="al-card-header">
        <h3 class="al-card-title">Session history</h3>
        <button class="al-btn" onclick={() => { clearHistory(); showToast('History cleared','info',1500); }}>
            Clear
        </button>
    </div>
    <p class="al-hint-text" style="margin-bottom:8px">
        Last 12 gradients · click to restore
    </p>

    <div class="al-history-list">
        {#if !historyEntries.list.length}
            <p class="al-hint-text" style="padding:4px">
                No history yet. Export a gradient to add it here.
            </p>
        {:else}
            {#each historyEntries.list as entry}
                <div class="al-hist-item"
                    onclick={() => restore(entry)}
                    title="Restore · {new Date(entry.ts).toLocaleTimeString()}"
                >
                    <!-- entry.result is the gradResult array -->
                    <GradientBar
                        gradResult={entry.result}
                        palette={editor.palette}
                        height="18px"
                    />
                    <span class="al-hist-ts">
                        {new Date(entry.ts).toLocaleTimeString([],
                            { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            {/each}
        {/if}
    </div>
</div>