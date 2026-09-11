<!-- src/components/modals/PresetImportModal.svelte -->
<!--
    houses the dragover zone and button zone for batch gradient imports in the preset manager
-->
<script>
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, readDir } from '@tauri-apps/plugin-fs';
import { showToast } from '../../lib/aerolux/toast.js';
import { importPresetsJSON } from '../../lib/aerolux/presets.js';

let { open: modalOpen = $bindable(false), onImported = () => {} } = $props();

let status = $state('');
let statusOk = $state(false);
let confirmDisabled = $state(true);
let isDragging = $state(false);
let pendingFiles = [];

function resetState() {
    status = '';
    statusOk = false;
    confirmDisabled = true;
    pendingFiles = [];
}

function closeModal() {
    modalOpen = false;
    resetState();
}

function handleText(text, filename = '', mode = 'gradient') {
    pendingFiles.push({
        text,
        name: filename.replace(/\.[^.]+$/, '') || 'Imported gradient',
        mode
    });

    status = `✓ ${pendingFiles.length} preset${pendingFiles.length !== 1 ? 's' : ''} ready`;
    statusOk = true;
    confirmDisabled = false;
}

async function collectFolder(folderPath) {
    const entries = await readDir(folderPath);
    for (const entry of entries) {
        const fullPath = `${folderPath}/${entry.name}`;
        const name = entry.name ?? '';
        const lower = name.toLowerCase();
        if (entry.children) {
            await collectFolder(fullPath);
            continue;
        }
        if (
            !lower.endsWith('.txt') &&
            !lower.endsWith('.json')
        ) continue;
        const text = await readTextFile(fullPath);
        handleText(
            text,
            name,
            lower.endsWith('.json') ? 'json' : 'gradient'
        );
    }
}

async function browse() {
    pendingFiles = [];
    const selection = await open({
        multiple: true,
        filters: [{ name: 'Aerolux Presets', extensions: ['json', 'txt'] }]
    });
    if (!selection) return;
    const paths = Array.isArray(selection)
        ? selection
        : [selection];
    try {
        for (const path of paths) {
        const text = await readTextFile(path);
        const name =
            path.split('/').pop() ??
            path.split('\\').pop() ??
            '';
        const mode =
            name.toLowerCase().endsWith('.json')
                ? 'json'
                : 'gradient';
        handleText(text, name, mode);
    }
    } catch (err) {
        status = '✗ Could not read file: ' + err.message;
        statusOk = false;
        confirmDisabled = true;
    }
}

async function browseFolder() {
    const folder = await open({
        directory: true
    });
    if (!folder) return;
    try {
        pendingFiles = [];

        await collectFolder(folder);
    } catch (err) {
        status = `✗ Could not read folder: ${err.message}`;
        statusOk = false;
        confirmDisabled = true;
    }
}

function onDragover(e) { e.preventDefault(); isDragging = true; }
function onDragLeave() { isDragging = false; }
async function onDrop(e) {
    pendingFiles = [];
    e.preventDefault();
    isDragging = false;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    for (const file of files) {
        const lower = file.name.toLowerCase();
        if (
            !lower.endsWith('.txt') &&
            !lower.endsWith('.json')
        ) {
            continue;
        }
        const text = await file.text();
        handleText(
            text,
            file.name,
            lower.endsWith('.json')
                ? 'json'
                : 'gradient'
        );
    }
}

async function confirm() {
    if (pendingFiles.length === 0) return;
    let imported = 0;
    let skipped = 0;
    for (const file of pendingFiles) {
        try {
            const result = await importPresetsJSON(file.text, file.name);
            if (result.storageError) {
                showToast(
                    `Import failed for ${file.name}: ${result.storageError}`,
                    'error',
                    5000
                );
                continue;
            }
            imported += result.imported;
            skipped += result.skipped;
        } catch (err) {
            showToast(
                `Import crashed for ${file.name}: ${err.message}`,
                'error',
                5000
            );
        }
    }
    showToast(
        `Imported ${imported} preset${imported !== 1 ? 's' : ''}${skipped ? `, ${skipped} skipped` : ''}`,
        'success',
        4000
    );
    onImported?.();
    closeModal();
}
</script>

{#if modalOpen}
    <div class="al-modal-overlay" onclick={closeModal}>
        <div class="al-modal" onclick={e => e.stopPropagation()}>
            <button class="al-modal-close" onclick={closeModal}>×</button>
            <h2 style="margin-bottom:4px">Import Preset</h2>
            <p class="al-dim" style="margin-bottom:20px;font-size:12px">
                Import a gradient file or a folder.
            </p>

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
                <p style="font-size:13px;margin-bottom:4px;color:var(--color-text-secondary)">Drop your gradient file here</p>
                <p class="al-dim" style="margin-bottom:16px">or</p>
                <button class="al-btn al-btn-blue" onclick={e => { e.stopPropagation(); browse(); }}>Browse files</button>
                <button class="al-btn al-btn-blue" onclick={e => {e.stopPropagation(); browseFolder();}}>Browse Folder</button>
            </div>

            <p class="import-status {statusOk ? 'ok' : status ? 'err' : ''}">{status}</p>

            <div style="display:flex;gap:8px;margin-top:16px">
                <button class="al-btn al-btn-blue" disabled={confirmDisabled} onclick={confirm}>Import preset</button>
                <button class="al-btn" onclick={closeModal}>Cancel</button>
            </div>
        </div>
    </div>
{/if}

<style>
.import-dropzone {
    border: 2px dashed var(--color-border-bright);
    border-radius: var(--radius-lg);
    padding: 40px 24px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
    margin-bottom: 12px;
    user-select: none;
}
.import-dropzone:hover,
.import-dropzone.drag-active {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
}
.import-status {
    min-height: 16px;
    font-size: 12px;
    text-align: center;
    color: var(--color-text-dim);
    transition: color 0.15s ease;
}
.import-status.ok { color: var(--color-success); }
.import-status.err { color: var(--color-danger); }
</style>
