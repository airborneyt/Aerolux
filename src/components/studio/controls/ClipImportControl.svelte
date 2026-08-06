<!-- src/components/studio/controls/ClipImportControl.svelte -->
<!--
    Kinetic's Clip Import param control -- loads a .mid file, parses it via
    the REBUILT kinetic/clipImport.js (not Velocity's nodes/clipImport.js;
    different parser, different output shape -- Kinetic's clipData feeds
    clipToField directly, it has no relationship to Velocity's gradient
    pipeline). Sets the whole parsed clipData object as this node's
    `clipData` param via the normal onchange(value) contract every other
    control here already follows.

    This is the Inspector-side half of closing the gap flagged in
    KINETIC-NODE-AUTHORING-GUIDE.md §4.1 ("clipData param control is not
    yet wired into the Inspector") -- paired with NodeInspector.svelte's
    dispatch for type 'clipImport'.
-->
<script>
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { showToast } from '../../../lib/aerolux/toast.js';
import { parseClipFile } from '../../../lib/aerolux/kinetic/clipImport.js';

let { label = 'File', value = null, onchange = () => {} } = $props();

let loading  = $state(false);
let fileName = $state(value ? 'Loaded clip' : 'No file loaded');

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

        fileName = path.split('/').pop() ?? path.split('\\').pop() ?? 'clip.mid';
        onchange(parsed);

        const noteCount = new Set(parsed.noteOns.map(e => e.noteNum)).size;
        showToast(
            `Loaded: ${parsed.numTrks} track(s) · ${parsed.noteOns.length} events · ${noteCount} note(s) · ${Math.round(parsed.bpm)} BPM`,
            'success', 4000
        );
    } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
    } finally {
        loading = false;
    }
}

function clearFile() {
    fileName = 'No file loaded';
    onchange(null);
}

const hasClip = $derived(!!value?.noteOns?.length);
</script>

<div class="cic-wrap">
    <p class="al-label">{label}</p>
    <div class="cic-row">
        <button class="al-btn al-btn-blue" onclick={importFile} disabled={loading}>
            {loading ? 'Loading…' : '⬆ Load .mid'}
        </button>
        {#if hasClip}
            <button class="al-btn al-btn-danger" onclick={clearFile}>✕</button>
        {/if}
    </div>
    <p class="al-hint-text">{fileName}</p>
    {#if hasClip}
        <p class="al-hint-text">
            {value.numTrks} track(s) · {value.noteOns.length} events ·
            {Math.round(value.bpm)} BPM · {value.durationSec.toFixed(1)}s
        </p>
    {/if}
</div>

<style>
.cic-wrap { display: flex; flex-direction: column; gap: 6px; }
.cic-row  { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
</style>