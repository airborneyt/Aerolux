<!-- src/components/modals/ImportModal.svelte -->
<!--
    houses the dragover zone and button zone for gradient imports in velocity
    todo: rename to GradientImportModal.svelte
-->
<script>
import { open }         from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { editor }       from '../../stores/velocity.svelte.js';
import { pushUndo }     from '../../stores/velocityActions.svelte.js';
import { parseImportedGradient } from '../../lib/aerolux/import-logic.js';
import { showToast } from '../../lib/aerolux/toast.js';

let { open: modalOpen = $bindable(false) } = $props();

// state ─────────────────────────────────────────────────────────────
let status          = $state('');
let statusOk        = $state(false);
let confirmDisabled = $state(true);
let isDragging      = $state(false);

let pendingStops  = null;
let pendingSteps  = null;
let pendingNextId = null;

// parse text ────────────────────────────────────────────────────────
function handleText(text, filename = '') {
    try {
        const result = parseImportedGradient(text, editor.palette.length, 0);
        pendingStops  = result.stops;
        pendingSteps  = result.steps;
        pendingNextId = result.nextId;
        status          = `✓ ${filename ? filename + ' · ' : ''}${result.stops.length} stops detected`;
        statusOk        = true;
        confirmDisabled = false;
    } catch (err) {
        status          = '✗ ' + err.message;
        statusOk        = false;
        confirmDisabled = true;
        pendingStops = pendingSteps = pendingNextId = null;
    }
}

// file dialog ───────────────────────────────────────────────────────
async function browse() {
    const path = await open({
        multiple: false,
        filters:  [{ name: 'Aerolux Gradient', extensions: ['txt'] }],
    });
    if (!path) return;
    try {
        const text = await readTextFile(path);
        const name = path.split('/').pop() ?? path.split('\\').pop() ?? '';
        handleText(text, name);
    } catch (err) {
        status   = '✗ Could not read file: ' + err.message;
        statusOk = false;
        confirmDisabled = true;
    }
}

// drag and drop ─────────────────────────────────────────────────────
function onDragover(e) { e.preventDefault(); isDragging = true; }
function onDragLeave() { isDragging = false; }
async function onDrop(e) {
    e.preventDefault();
    isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.txt')) {
        status = '✗ Please drop a .txt file exported from Aerolux';
        statusOk = false;
        confirmDisabled = true;
        return;
    }
    const text = await file.text();
    handleText(text, file.name);
}

// confirm ───────────────────────────────────────────────────────────
function confirm() {
    if (!pendingStops) return;
    pushUndo();
    editor.stops   = pendingStops;
    editor.steps   = Math.max(2, Math.min(16, pendingSteps));
    editor.nextId  = pendingNextId;
    editor.selStop = pendingStops[0].id;
    // sync steps slider display
    showToast('Gradient imported', 'success');
    closeModal();
}

function closeModal() {
    modalOpen       = false;
    status          = '';
    statusOk        = false;
    confirmDisabled = true;
    pendingStops = pendingSteps = pendingNextId = null;
}
</script>

{#if modalOpen}
    <!-- overlay -->
    <div class="al-modal-overlay" onclick={closeModal}>
        <div class="al-modal" onclick={e => e.stopPropagation()}>

            <button class="al-modal-close" onclick={closeModal}>×</button>

            <h2 style="margin-bottom:4px">Import Gradient</h2>
            <p class="al-dim" style="margin-bottom:20px;font-size:12px">
                Load a .txt gradient file exported from Aerolux
            </p>

            <!-- dropzone -->
            <div
                class="import-dropzone {isDragging ? 'drag-active' : ''}"
                onclick={browse}
                ondragover={onDragover}
                ondragleave={onDragLeave}
                ondrop={onDrop}
                role="button"
                tabindex="0"
                onkeydown={e => e.key === 'Enter' && browse()}
            >
                <div style="font-size:32px;margin-bottom:8px">📂</div>
                <p style="font-size:13px;margin-bottom:4px;color:var(--color-text-secondary)">
                    Drop your gradient file here
                </p>
                <p class="al-dim" style="margin-bottom:16px">or</p>
                <button class="al-btn al-btn-blue"
                    onclick={e => { e.stopPropagation(); browse(); }}>
                    Browse files
                </button>
            </div>

            <!-- status -->
            <p class="import-status {statusOk ? 'ok' : status ? 'err' : ''}">
                {status}
            </p>

            <!-- actions -->
            <div style="display:flex;gap:8px;margin-top:16px">
                <button class="al-btn al-btn-blue"
                    disabled={confirmDisabled}
                    onclick={confirm}>
                    Load gradient
                </button>
                <button class="al-btn" onclick={closeModal}>Cancel</button>
            </div>

        </div>
    </div>
{/if}

<style>
.import-dropzone {
    border:        2px dashed var(--color-border-bright);
    border-radius: var(--radius-lg);
    padding:       40px 24px;
    text-align:    center;
    cursor:        pointer;
    transition:    border-color 0.15s ease, background 0.15s ease;
    margin-bottom: 12px;
    user-select:   none;
}
.import-dropzone:hover,
.import-dropzone.drag-active {
    border-color: var(--color-accent);
    background:   var(--color-accent-subtle);
}
.import-status {
    min-height:  16px;
    font-size:   12px;
    text-align:  center;
    color:       var(--color-text-dim);
    transition:  color 0.15s ease;
}
.import-status.ok  { color: var(--color-success); }
.import-status.err { color: var(--color-danger);  }
</style>