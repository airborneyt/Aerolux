<!-- src/components/modals/UnsavedChangesModal.svelte -->
<!--
    single global instance, mounted once in App.svelte
    reads unsavedPrompt from menu.svelte.js and resolves it via resolveUnsavedPrompt()
    used by file → new, file → open, and the app quit (Cmd+Q / Alt+F4 / window close) flows alike
-->
<script>
import { unsavedPrompt, resolveUnsavedPrompt } from '../../lib/aerolux/menu.svelte.js';
import { projects } from '../../stores/projects.svelte.js';

const triggerCopy = {
    new:  'starting a new project',
    open: 'opening another project',
    exit: 'quitting Aerolux',
};

const subtitle = $derived(
    `You have unsaved changes. They'll be lost if you continue ${triggerCopy[unsavedPrompt.pending] ?? 'this action'} without saving.`
);
</script>

{#if unsavedPrompt.open}
<div class="ucm-overlay">
    <div class="ucm-modal">
        <h2 class="ucm-title">Save changes to "{projects.currentName}"?</h2>
        <p class="ucm-subtitle">{subtitle}</p>

        <div class="ucm-actions">
            <button class="al-btn al-btn-ghost" onclick={() => resolveUnsavedPrompt('cancel')}>
                Cancel
            </button>
            <button class="al-btn al-btn-danger" onclick={() => resolveUnsavedPrompt('discard')}>
                Don't Save
            </button>
            <button class="al-btn al-btn-blue" onclick={() => resolveUnsavedPrompt('save')}>
                Save
            </button>
        </div>
    </div>
</div>
{/if}

<style>
.ucm-overlay {
    position:        fixed;
    inset:           0;
    z-index:         2000;
    display:         flex;
    align-items:     center;
    justify-content: center;
    background:      var(--color-glass-overlay);
    backdrop-filter:         blur(10px) saturate(1.2);
    -webkit-backdrop-filter: blur(10px) saturate(1.2);
    animation:       al-overlay-in var(--duration-enter) var(--ease-out) both;
}

.ucm-modal {
    background:              var(--color-glass-modal);
    border:                  1px solid var(--color-border-bright);
    border-radius:           var(--radius-xl);
    padding:                 var(--space-6);
    width:                   min(90vw, 420px);
    backdrop-filter:         blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow:              var(--shadow-modal);
    animation:               al-modal-in var(--duration-enter) var(--ease-spring) both;
}

.ucm-title {
    font-size:     var(--font-size-lg);
    font-weight:   var(--font-weight-semibold);
    margin-bottom: var(--space-2);
}

.ucm-subtitle {
    font-size:     var(--font-size-sm);
    color:         var(--color-text-secondary);
    line-height:   var(--line-height-base);
    margin-bottom: var(--space-5);
}

.ucm-actions {
    display:         flex;
    justify-content: flex-end;
    gap:             var(--space-2);
}
</style>