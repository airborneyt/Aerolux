<!-- src/components/studio/controls/ClipImportControl.svelte -->
<script>
import { open }     from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { kinetic }  from '../../../stores/kinetic.svelte.js';
import { showToast } from '../../../lib/aerolux/toast.js';
import { parseClipFile } from '../../../lib/aerolux/nodes/clipImport.js';

let { instanceId, label = 'File', value = 'No file loaded', onchange = () => {} } = $props();

let loading = $state(false);
let fileLabel = typeof value === 'string'
    ? value
    : value && value.noteOns
        ? 'Loaded clip'
        : 'No file loaded';

async function importFile() {
    const path = await open({
        multiple: false,
        filters:  [{ name: 'MIDI', extensions: ['mid', 'midi'] }],
    });
    if (!path) return;

    loading = true;
    try {
        const bytes  = await readFile(path);
        const parsed = parseClipFile(bytes);

        // Store in kinetic.loadedClips keyed by this node's instanceId.
        kinetic.loadedClips[instanceId] = { ...parsed, rawBytes: bytes };

        const name = path.split('/').pop() ?? path.split('\\').pop() ?? 'clip.mid';
        fileLabel = name;
        onchange(parsed);

        const pads = new Set(parsed.noteOns.map(e => e.noteNum)).size;
        showToast(`Loaded: ${parsed.numTrks} track(s) · ${parsed.noteOns.length} events · ${pads} pads`, 'success', 4000);
    } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
    } finally {
        loading = false;
    }
}

function clearFile() {
    delete kinetic.loadedClips[instanceId];
    fileLabel = 'No file loaded';
    onchange(null);
}

const hasClip = $derived(!!kinetic.loadedClips[instanceId]);
</script>

<div style="display:flex;flex-direction:column;gap:6px">
    <p class="al-label">{label}</p>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <button class="al-btn al-btn-blue" onclick={importFile} disabled={loading}>
            {loading ? 'Loading…' : '⬆ Load .mid'}
        </button>
        {#if hasClip}
            <button class="al-btn al-btn-danger" onclick={clearFile}>✕</button>
        {/if}
    </div>
    <p class="al-hint-text">{fileLabel}</p>
    {#if hasClip}
        {@const clip = kinetic.loadedClips[instanceId]}
        <p class="al-hint-text">
            {clip.numTrks} track(s) · {clip.noteOns.length} events
        </p>
    {/if}
</div>