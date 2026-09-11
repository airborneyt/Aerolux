<!-- src/components/modals/NewProjectModal.svelte -->
<!-- 
    houses the velocity/kinetic selector in the home page when creating a new project
-->
<script>
import { startNewProject } from '../../lib/aerolux/menu.svelte.js';
import VelocityPreviewCard from './previews/VelocityPreviewCard.svelte';
import KineticPreviewCard  from './previews/KineticPreviewCard.svelte';
import { hapticConfirm } from '../../lib/aerolux/haptics.js';
import { settings } from '../../stores/settings.svelte.js';

let { open = $bindable(false) } = $props();
const defaultEditor = $derived(settings.constants?.defaultEditor ?? null);

async function choose(type) {
    open = false;
    await startNewProject(type);
}

function close() { open = false; }

async function handleVelocity() {
    hapticConfirm();
    await choose('velocity');
}

async function handleKinetic() {
    hapticConfirm();
    await choose('kinetic');
}

</script>

{#if open}
<div class="npm-overlay" onclick={close}>
    <div class="npm-modal" onclick={e => e.stopPropagation()}>

        <div class="npm-header">
            <h2 class="npm-title">New Project</h2>
            <p class="npm-subtitle">Choose a workspace to start in.</p>
        </div>

        <div class="npm-cards">

            <!-- Velocity -->
                <button class="npm-card {defaultEditor === 'velocity' ? 'npm-card-default' : ''}" onclick={handleVelocity}>
                <div class="npm-card-preview">
                    <VelocityPreviewCard />
                </div>
                <div class="npm-card-body">
                    <span class="npm-card-icon">◈</span>
                    <span class="npm-card-name">Velocity</span>
                    <span class="npm-card-desc">Gradient editor for Launchpad colour design.</span>
                </div>
            </button>

            <!-- Kinetic -->
                <button class="npm-card {defaultEditor === 'kinetic' ? 'npm-card-default' : ''}" onclick={handleKinetic}>
                <div class="npm-card-preview">
                    <KineticPreviewCard />
                </div>
                <div class="npm-card-body">
                    <span class="npm-card-icon">⟁</span>
                    <span class="npm-card-name">Kinetic</span>
                    <span class="npm-card-desc">MIDI effect studio. Generate and transform light effects.</span>
                </div>
            </button>

        </div>

        <button class="al-btn al-btn-ghost npm-cancel" onclick={close}>Cancel</button>

    </div>
</div>
{/if}

<style>
.npm-overlay {
    position:        fixed;
    inset:           0;
    z-index:         1000;
    display:         flex;
    align-items:     center;
    justify-content: center;
    background:      var(--color-glass-overlay);
    backdrop-filter:         blur(10px) saturate(1.2);
    -webkit-backdrop-filter: blur(10px) saturate(1.2);
    animation:       al-overlay-in var(--duration-enter) var(--ease-out) both;
    user-select: none; -webkit-user-select: none;
}

.npm-modal {
    background:              var(--color-glass-modal);
    border:                  1px solid var(--color-border-bright);
    border-radius:           var(--radius-xl);
    padding:                 var(--space-6);
    width:                   min(92vw, 625px);
    backdrop-filter:         blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow:              var(--shadow-modal);
    animation:               al-modal-in var(--duration-enter) var(--ease-spring) both;
}

.npm-header { margin-bottom: var(--space-5); text-align: center; }
.npm-title    { font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); margin-bottom: 4px; }
.npm-subtitle { font-size: var(--font-size-sm); color: var(--color-text-secondary); }

.npm-cards {
    display:               grid;
    grid-template-columns: repeat(2, 1fr);
    gap:                   var(--space-3);
    margin-bottom:         var(--space-5);
}

.npm-card {
    display:        flex;
    flex-direction: column;
    border:         1px solid var(--color-border);
    border-radius:  var(--radius-lg);
    background:     var(--color-surface-1);
    cursor:         pointer;
    overflow:       hidden;
    text-align:     left;
    padding:        0;
    font-family:    inherit;
    transition:     border-color var(--duration-fast) var(--ease-smooth),
                    box-shadow   var(--duration-fast) var(--ease-smooth),
                    transform    var(--duration-fast) var(--ease-spring);
}
.npm-card:hover:not(:disabled) {
    border-color: var(--color-accent-border);
    box-shadow:   var(--shadow-card-hover), var(--glow-accent);
    transform:    translateY(-2px);
}
.npm-card-default { border-color: var(--color-accent-border); box-shadow: var(--glow-accent); }
.npm-card:active:not(:disabled) { transform: translateY(0); }

.npm-card-disabled {
    cursor:  not-allowed;
    opacity: 0.5;
}

/* Fixed height (not min-height) so the divider between preview and
   body lands at the exact same spot on every card regardless of each
   preview component's own internal content height. overflow:hidden
   clips anything that doesn't fit rather than pushing the card taller. */
.npm-card-preview {
    border-bottom: 1px solid var(--color-border);
    height:        140px;
    display:       flex;
    align-items:   center;
    overflow:      hidden;
}

.npm-card-body {
    display:        flex;
    flex-direction: column;
    gap:            3px;
    padding:        var(--space-3);
}

.npm-card-icon { font-size: 16px; margin-bottom: 2px; }
.npm-card-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
.npm-card-desc { font-size: var(--font-size-xs); color: var(--color-text-dim); line-height: var(--line-height-base); }

.npm-cancel { display: block; margin: 0 auto; }
</style>
