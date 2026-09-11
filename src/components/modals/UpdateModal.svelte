<!-- src/components/modals/UpdateModal.svelte -->
<script>
import { updater, skipUpdate, remindLater, installUpdate } from '../../stores/updater.svelte.js';

let installing = $state(false);

async function handleUpdateNow() {
    installing = true;
    await installUpdate();
    installing = false; // only reached if install/relaunch failed
}
</script>

{#if updater.modalOpen}
<div class="upm-overlay">
    <div class="upm-modal">
        <span class="upm-icon">✦</span>
        <h2 class="upm-title">Update available</h2>
        <p class="upm-subtitle">
            Aerolux {updater.version} is ready to install
            {#if updater.currentVersion}(you're on {updater.currentVersion}){/if}.
        </p>

        {#if updater.notes}
            <div class="upm-notes">{updater.notes}</div>
        {/if}

        {#if installing}
            <div class="al-progress-track" style="margin:14px 0">
                <div class="al-progress-fill" style="width:{updater.progress}%"></div>
            </div>
            <p class="al-dim" style="text-align:center;font-size:12px">
                {updater.progress > 0 ? `Downloading… ${updater.progress}%` : 'Starting download…'}
            </p>
        {:else}
            <div class="upm-actions">
                <button class="al-btn al-btn-danger" onclick={skipUpdate}>
                    Skip this version
                </button>
                <button class="al-btn" onclick={remindLater}>
                    Remind me later
                </button>
                <button class="al-btn al-btn-blue" onclick={handleUpdateNow}>
                    Update now
                </button>
            </div>
        {/if}
    </div>
</div>
{/if}

<style>
.upm-overlay {
    position: fixed; inset: 0; z-index: 2050;
    display: flex; align-items: center; justify-content: center;
    background: var(--color-glass-overlay);
    backdrop-filter: blur(10px) saturate(1.2);
    -webkit-backdrop-filter: blur(10px) saturate(1.2);
    animation: al-overlay-in var(--duration-enter) var(--ease-out) both;
}
.upm-modal {
    background: var(--color-glass-modal);
    border: 1px solid var(--color-accent-border);
    border-radius: var(--radius-xl);
    padding: var(--space-6);
    width: min(90vw, 440px);
    text-align: center;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow: var(--shadow-modal);
    animation: al-modal-in var(--duration-enter) var(--ease-spring) both;
    user-select: none; -webkit-user-select: none;
}
.upm-icon { display: block; font-size: 26px; margin-bottom: var(--space-3); color: var(--color-accent); }
.upm-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin-bottom: var(--space-2); }
.upm-subtitle { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: var(--line-height-base); margin-bottom: var(--space-3); }
.upm-notes {
    max-height: 120px; overflow-y: auto; text-align: left;
    background: var(--color-mono-bg); border: 1px solid var(--color-border);
    border-radius: var(--radius-md); padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-xs); color: var(--color-text-secondary);
    white-space: pre-wrap; margin-bottom: var(--space-4);
}
.upm-actions { display: flex; justify-content: center; gap: var(--space-2); flex-wrap: wrap; }
</style>