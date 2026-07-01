<!-- src/components/modals/RecoveryModal.svelte -->
<!--
    single global instance, mounted once in App.svelte alongside unsavedChangesModal
    reads recoveryPrompt from crash-recovery.svelte.js, resolved via resolveRecoveryPrompt()
-->
<script>
import { recoveryPrompt, resolveRecoveryPrompt } from '../../lib/aerolux/crash-recovery.svelte.js';

const projectName = $derived(recoveryPrompt.data?.name ?? 'Untitled');
const savedAtLabel = $derived(
    recoveryPrompt.data?.savedAt
        ? new Date(recoveryPrompt.data.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : ''
);
</script>

{#if recoveryPrompt.open}
<div class="rcm-overlay">
    <div class="rcm-modal">
        <span class="rcm-icon">⚠</span>
        <h2 class="rcm-title">Aerolux didn't close properly</h2>
        <p class="rcm-subtitle">
            There were unsaved changes to <strong>"{projectName}"</strong> from your last session
            {#if savedAtLabel}(autosaved around {savedAtLabel}){/if}.
            Would you like to recover this work?
        </p>

        <div class="rcm-actions">
            <button class="al-btn al-btn-ghost" onclick={() => resolveRecoveryPrompt('discard')}>
                Discard
            </button>
            <button class="al-btn al-btn-blue" onclick={() => resolveRecoveryPrompt('restore')}>
                Restore
            </button>
        </div>
    </div>
</div>
{/if}

<style>
.rcm-overlay {
    position:        fixed;
    inset:           0;
    z-index:         2100;
    display:         flex;
    align-items:     center;
    justify-content: center;
    background:      var(--color-glass-overlay);
    backdrop-filter:         blur(10px) saturate(1.2);
    -webkit-backdrop-filter: blur(10px) saturate(1.2);
    animation:       al-overlay-in var(--duration-enter) var(--ease-out) both;
}

.rcm-modal {
    background:              var(--color-glass-modal);
    border:                  1px solid var(--color-warning-border);
    border-radius:           var(--radius-xl);
    padding:                 var(--space-6);
    width:                   min(90vw, 440px);
    backdrop-filter:         blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow:              var(--shadow-modal);
    animation:               al-modal-in var(--duration-enter) var(--ease-spring) both;
    text-align:              center;
}

.rcm-icon {
    display:       block;
    font-size:     28px;
    margin-bottom: var(--space-3);
    color:         var(--color-warning);
}

.rcm-title {
    font-size:     var(--font-size-lg);
    font-weight:   var(--font-weight-semibold);
    margin-bottom: var(--space-2);
}

.rcm-subtitle {
    font-size:     var(--font-size-sm);
    color:         var(--color-text-secondary);
    line-height:   var(--line-height-base);
    margin-bottom: var(--space-5);
}

.rcm-actions {
    display:         flex;
    justify-content: center;
    gap:             var(--space-2);
}
</style>