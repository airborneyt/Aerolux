<!-- src/components/studio/GraphBreadcrumb.svelte -->
<!--
    breadcrumb trail for nested composite navigation. 
    Root | CompositeA | CompositeB ...
    click any crumb to jump straight to that depth via goToBreadcrumb.
-->
<script>
import { kinetic, goToBreadcrumb, breadcrumbLabels } from '../../stores/kinetic.svelte.js';

const labels = $derived(breadcrumbLabels());
</script>

{#if kinetic.graphPath.length > 0}
<div class="gb-wrap">
    {#each labels as label, i}
        <button class="gb-crumb {i === labels.length - 1 ? 'active' : ''}" onclick={() => goToBreadcrumb(i)}>
            {label}
        </button>
        {#if i < labels.length - 1}<span class="gb-sep">›</span>{/if}
    {/each}
</div>
{/if}

<style>
.gb-wrap  { display:flex; align-items:center; gap:4px; padding:4px 10px; font-size:11px; }
.gb-crumb {
    background:transparent; border:none; color:var(--color-text-dim);
    font-size:11px; font-family:inherit; cursor:pointer; padding:2px 4px;
    border-radius:var(--radius-xs);
}
.gb-crumb:hover  { background:var(--color-surface-2); color:var(--color-text-secondary); }
.gb-crumb.active { color:var(--color-accent-text); font-weight:600; cursor:default; }
.gb-crumb.active:hover { background:transparent; }
.gb-sep   { color:var(--color-text-dim); font-size:10px; }
</style>