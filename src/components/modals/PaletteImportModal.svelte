<!-- src/components/modals/PaletteImportModal.svelte -->
<!--
    houses the dragover zone and button zone for palette imports in settings
-->
<script>
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parseImportedPalette } from "../../lib/aerolux/import-logic";
import { DEFAULT_PALETTE } from "../../lib/aerolux/palette";
import { showToast } from "../../lib/aerolux/toast";

let { open:modalOpen = $bindable(false), onImport = () => {} } = $props();

// state
let status              = $state('');
let statusOk            = $state(false);
let confirmDisabled   = $state(true);
let isDragging          = $state(false);

let pendingPalette      = null;
let pendingPaletteIndex = null;

// parse text
function normalizePalette(palette) {
    const out = new Array(128);

    for (let i = 0; i < 128; i++) {
        out[i] = palette[i] ?? [0, 0, 0];
    }

    return out;
}

function handleText(text, filename = '') {
    try {
        const result = parseImportedPalette(text);
        pendingPalette = normalizePalette(result.palette);
        pendingPaletteIndex = result.id;
        status          = `✓ ${filename ? filename + ' · ' : ''}Palette parsed.`;
        statusOk        = true;
        confirmDisabled = false;
    } catch(err) {
        status          = '✗ ' + err.message;
        statusOk        = false;
        confirmDisabled = true;
        pendingPalette      = null;
        pendingPaletteIndex = null;
    }
}

// file dialog
async function browse() {
    const path = await open({
        multiple: false,
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

// drag and drop
function onDragover(e) { e.preventDefault(); isDragging = true; }
function onDragLeave() { isDragging = false; }
async function onDrop(e) {
    e.preventDefault();
    isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const text = await file.text();
    handleText(text, file.name);
}

// confirm
function confirm() {
    if (!pendingPalette) return;

    showToast("Palette imported", "success");
    onImport?.(pendingPalette);
    closeModal();

    pendingPalette = null;
}

// importing custom palettes
export function resetPalette() {
  onImport?.(DEFAULT_PALETTE);
  closeModal();
}

function closeModal() {
    modalOpen       = false;
    status          = '';
    statusOk        = false;
    confirmDisabled = true;
    pendingPaletteIndex = null;
}
</script>

{#if modalOpen}
    <!-- overlay -->
    <div class="al-modal-overlay" onclick={closeModal}>
        <div class="al-modal" onclick={e => e.stopPropagation()}>

            <button class="al-modal-close" onclick={closeModal}>×</button>

            <h2 style="margin-bottom:4px">Import Palette</h2>
            <p class="al-dim" style="margin-bottom:20px;font-size:12px">
                Load a custom palette
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
                    Drop your palette file here
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
                    Load palette
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
