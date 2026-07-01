<script>
import { onMount } from 'svelte';
import { open } from '@tauri-apps/plugin-dialog';
import { showToast } from '../../lib/aerolux/toast.js';
import { clearAllPresets } from '../../lib/aerolux/presets.js';
import { settings, saveSetting } from '../../stores/settings.svelte.js';
import { setMode, getResolvedAccentH, setAccentH, resetAccent } from '../../stores/theme.svelte.js';
import { setMotionTier } from '../../stores/motion.svelte.js';
import PaletteImportModal from '../modals/PaletteImportModal.svelte';
import { editor } from '../../stores/velocity.svelte.js';

// Active section
let activeSection = $state('theme');

const sections = [
    { id: 'theme',       icon: '🎨', label: 'Theme'       },
    { id: 'editor',      icon: '🖌️', label: 'Editor'      },
    { id: 'performance', icon: '⚡',  label: 'Performance' },
    { id: 'ai',          icon: '🤖', label: 'AI Model'    },
    { id: 'storage',     icon: '💾', label: 'Storage'     },
    { id: 'midi',        icon: '🎹', label: 'MIDI'        },
    { id: 'about',       icon: 'ℹ',  label: 'About'       },
];

let draftH = $state(getResolvedAccentH());
$effect(() => { draftH = getResolvedAccentH(); });

function onHueInput(e) {
    draftH = parseInt(e.target.value);
    document.documentElement.style.setProperty('--accent-h', String(draftH));
}
async function onHueCommit(e) { await setAccentH(parseInt(e.target.value)); }

// vram button
function saveVram() {
    const val = parseFloat(document.getElementById('vram-input').value);
    if (isNaN(val) || val <= 0) {
        showToast('Enter a valid number', 'warning');
        return;
    }
    saveSetting('vram', val);
    showToast(`VRAM saved as ${val} GB`, 'success', 2000);
}

function clearAiCache() {
    try {
        saveSetting('vram', null);
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

async function handleClearPresets() {
    const confirmed = window.confirm('Delete all saved presets? This cannot be undone.');
    if (!confirmed) return;

    try {
        const result = await clearAllPresets();
        if (!result.ok) {
            showToast(result.reason || 'Could not clear presets', 'error');
            return;
        }
        showToast('All presets cleared', 'success', 3000);
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

// palette
let paletteOpen = $state(false);

function applyImportedPalette(palette, persist = true) {
    const nextPalette = Array.isArray(palette) ? palette : [];
    editor.palette.length = 0;
    editor.palette.push(...nextPalette.map((c, index) => ({
        i: index,
        r: Array.isArray(c) ? c[0] : c?.r ?? 0,
        g: Array.isArray(c) ? c[1] : c?.g ?? 0,
        b: Array.isArray(c) ? c[2] : c?.b ?? 0,
    })));
    if (persist) {
        saveSetting('editor.customPalette', nextPalette.map(c => [
            Array.isArray(c) ? c[0] : c?.r ?? 0,
            Array.isArray(c) ? c[1] : c?.g ?? 0,
            Array.isArray(c) ? c[2] : c?.b ?? 0,
        ]));
    }
}

onMount(() => {
    const saved = settings?.editor?.customPalette;
    if (Array.isArray(saved) && saved.length) {
        applyImportedPalette(saved.map(entry => Array.isArray(entry) ? entry : [entry?.r ?? 0, entry?.g ?? 0, entry?.b ?? 0]), false);
    }
});

// reset all settings
async function resetAllSettings() {
    try {
        await clearAiCache();
        await resetAccent();
        await setMotionTier('motion-full');

        showToast('All settings reset', 'success', 2000);
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

</script>
<!-- warning -->
    <div style="display:flex;gap:8px;padding:8px;background:rgba(255,0,0,0.1);align-items:center;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:bolder;">
            The Settings page is due for a rewrite in the next alpha.
        </span>
    </div>    
<div class="al-settings-page">

    <!-- sidebar nav -->
    <nav class="al-settings-nav">
        {#each sections as s}
            <button
                class="al-settings-nav-item {activeSection === s.id ? 'active' : ''}"
                onclick={() => activeSection = s.id}
            >
                <span class="al-settings-nav-icon">{s.icon}</span>
                {s.label}
            </button>
        {/each}
    </nav>

    <!-- content -->
    <div class="al-settings-content">

        <!-- ── Theme ── -->
        {#if activeSection === 'theme'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">Theme</div>
                <div class="al-card">

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Colour mode</div>
                            <div class="al-setting-desc">
                                System follows your OS preference. Falls back to dark.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            {#each ['dark','light','system'] as m}
                                <button
                                    class="al-btn al-btn-sm {settings.theme.mode === m ? 'al-btn-blue' : ''}"
                                    onclick={() => setMode(m)}
                                >{m.charAt(0).toUpperCase()+m.slice(1)}</button>
                            {/each}
                        </div>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Accent colour</div>
                            <div class="al-setting-desc">
                                Any hue. Dark mode default is gold, light mode default is blue.
                            </div>
                        </div>
                        <div class="al-setting-control" style="flex-direction:column;align-items:flex-end;gap:8px;min-width:180px">
                            <div style="display:flex;align-items:center;gap:10px;width:100%">
                                <div class="al-accent-preview"
                                    style="background:hsl({draftH},88%,58%);
                                           box-shadow:0 0 10px hsl({draftH},80%,55%,0.5)">
                                </div>
                                <span class="al-mono" style="color:var(--color-text-secondary);min-width:30px">
                                    {draftH}°
                                </span>
                                {#if settings.theme.accentH !== null}
                                    <button class="al-btn al-btn-ghost al-btn-sm" onclick={resetAccent}>
                                        Reset to default
                                    </button>
                                {/if}
                            </div>
                            <input type="range" min="0" max="359" step="1"
                                value={draftH}
                                class="al-hue-slider"
                                style="width:100%"
                                oninput={onHueInput}
                                onchange={onHueCommit}
                            />
                        </div>
                    </div>

                </div>
            </div>
        {/if}

        {#if activeSection === 'editor'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">Editor</div>
                <div class="al-card">

                    <div class="al-setting-row">
                        <div class="al-setting-label">Default Palette</div>
                        <div class="al-setting-desc">
                            Upload a custom palette to be used throughout Aerolux.
                        </div>
                        <div class="al-setting-control">
                            <button class="al-btn" onclick={() => paletteOpen = true}>Upload Palette</button>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        <!-- ── Performance ── -->
        {#if activeSection === 'performance'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">Performance</div>
                <div class="al-card">

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Animation level</div>
                            <div class="al-setting-desc">
                                Full uses spring physics and all effects.
                                Reduced uses simpler transitions.
                                None disables all animation. Use this if you are facing performance issues, or for accessibility preferences.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            {#each [
                                { tier:'motion-full',    label:'Full'    },
                                { tier:'motion-reduced', label:'Reduced' },
                                { tier:'motion-none',    label:'None'    },
                            ] as t}
                                <button
                                    class="al-btn al-btn-sm {settings.motion.tier === t.tier ? 'al-btn-blue' : ''}"
                                    onclick={() => setMotionTier(t.tier)}
                                >{t.label}</button>
                            {/each}
                        </div>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Window vibrancy</div>
                            <div class="al-setting-desc">
                                Disable if you experience window rendering issues.
                            </div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input type="checkbox" checked />
                            <span class="al-dim">Enabled</span>
                        </label>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">GPU VRAM override</div>
                            <div class="al-setting-desc">
                                Used by the AI compatibility checker. Set this to your
                                GPU VRAM (or total RAM on Apple Silicon).
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <input type="number" class="al-num-input" id="vram-input" placeholder="GB" min="1" max="512" step="0.5" />
                            <span class="al-dim">GB</span>
                            <button class="al-btn al-btn-sm" id="vram-confirm-btn" onclick={saveVram}>Save</button>
                        </div>
                    </div>

                </div>
            </div>
        {/if}

        <!-- ── AI Model ── -->
        {#if activeSection === 'ai'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">AI Model</div>
                <div class="al-card">

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Active model</div>
                            <div class="al-setting-desc">
                                Larger models produce better results but require more VRAM
                                and take longer to load. Check the compatibility checker
                                before selecting a large model.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <select class="al-select al-input--w-md">
                                <option>Qwen3-8B (large, recommended)</option>
                                <option>Qwen3-4B (medium, faster)</option>
                                <option>Phi-3.5-mini (small, fastest)</option>
                            </select>
                        </div>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Model backend</div>
                            <div class="al-setting-desc">
                                llama.cpp runs natively and is faster on supported hardware.
                                WebLLM runs in the webview via WebGPU.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            {#each ['llama.cpp', 'WebLLM'] as b}
                                <button class="al-btn al-btn-sm {b === 'llama.cpp' ? 'al-btn-blue' : ''}">
                                    {b}
                                </button>
                            {/each}
                        </div>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Clear model cache</div>
                            <div class="al-setting-desc">
                                Removes downloaded model files from disk. The model will
                                need to be re-downloaded on next use.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <button class="al-btn al-btn-sm al-btn-danger"
                                onclick={() => {
                                    clearAiCache();
                                    try {
                                        showToast('VRAM override cleared', 'success');
                                    } catch (e) {
                                        showToast('Failed: ' + e.message, 'error');
                                    }
                                }}>
                                Clear cache
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        {/if}

        <!-- ── Storage ── -->
        {#if activeSection === 'storage'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">Storage</div>
                <div class="al-card">

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default project location</div>
                            <div class="al-setting-desc">
                                Where new .alx project files are saved by default.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <input type="text" class="al-input al-input--w-md"
                                placeholder="~/Documents/Aerolux" readonly />
                            <button class="al-btn al-btn-sm">Browse</button>
                        </div>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Export presets</div>
                            <div class="al-setting-desc">
                                Save all your local presets as a JSON backup file.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <button class="al-btn al-btn-sm">⬇ Export JSON</button>
                        </div>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Import presets</div>
                            <div class="al-setting-desc">
                                Merge presets from a JSON backup. Duplicates are skipped.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <button class="al-btn al-btn-sm">⬆ Import JSON</button>
                        </div>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Clear all presets</div>
                            <div class="al-setting-desc">
                                Permanently deletes all local presets. Export first.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <button class="al-btn al-btn-sm al-btn-danger" onclick={handleClearPresets}>Clear presets</button>
                        </div>
                    </div>

                </div>
            </div>
        {/if}

        <!-- ── MIDI ── -->
        {#if activeSection === 'midi'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">MIDI</div>
                <div class="al-card">

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default MIDI output</div>
                            <div class="al-setting-desc">
                                Auto-connect to this device on startup if available.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <select class="al-select al-input--w-md">
                                <option>None (manual connect)</option>
                                <option>Launchpad Pro MK3</option>
                                <option>Launchpad Pro MK2</option>
                            </select>
                        </div>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Auto-send on change</div>
                            <div class="al-setting-desc">
                                Send gradient to connected Launchpad whenever
                                the editor state changes.
                            </div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input type="checkbox" checked />
                            <span class="al-dim">Enabled</span>
                        </label>
                    </div>

                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">SysEx confirmation</div>
                            <div class="al-setting-desc">
                                Show a brief confirmation toast each time
                                SysEx data is sent to hardware.
                            </div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input type="checkbox" />
                            <span class="al-dim">Disabled</span>
                        </label>
                    </div>

                </div>
            </div>
        {/if}

        <!-- ── About ── -->
        {#if activeSection === 'about'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">About</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Version</div>
                        </div>
                        <span class="al-mono">2.0.0</span>
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Check for updates</div>
                        </div>
                        <button class="al-btn al-btn-sm">Check now</button>
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Reset all settings</div>
                            <div class="al-setting-desc">
                                Restores all settings to their defaults.
                                Does not affect presets or project files.
                            </div>
                        </div>
                        <button class="al-btn al-btn-sm al-btn-danger" onclick={resetAllSettings}>Reset</button>
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Thank you, beta testers!</div>
                        </div>
                        <span class="al-dim">Dasherwithalpha, UltraAurora, CrystalSlime, Merlin, <br>
                            and members of Airborne's Discord Server!</span>
                    </div>
                    <div class="al-setting-row">
                    </div>
                </div>
                <p class="al-dim" style="text-align:center;margin-top:auto;padding-top:var(--space-8)">
                    &copy; 2026 airborneyt
                </p>
            </div>
        {/if}
    </div>
</div>

<PaletteImportModal bind:open={paletteOpen} onImport={applyImportedPalette} />
