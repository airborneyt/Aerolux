<script>
import { onMount } from 'svelte';
import { setDiscordContext } from '../../lib/aerolux/discord.js';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { showToast } from '../../lib/aerolux/toast.js';
import { clearAllPresets, exportPresetsJSON, importPresetsJSON } from '../../lib/aerolux/presets.js';
import { settings, saveSetting, resetSettings } from '../../stores/settings.svelte.js';
import { setMode, getResolvedAccentH, setAccentH, resetAccent, applyTheme } from '../../stores/theme.svelte.js';
import { audio, audioState } from '../../lib/aerolux/audio/index.js';
import { setMotionTier, applyMotion } from '../../stores/motion.svelte.js';
import PaletteImportModal from '../modals/PaletteImportModal.svelte';
import { editor, invalidatePaletteCache } from '../../stores/velocity.svelte.js';
import { DEFAULT_PALETTE } from '../../lib/aerolux/palette.js';
import { updater, checkForUpdate } from '../../stores/updater.svelte.js';
import { setDiscordActivityEnabled } from '../../lib/aerolux/discord.js'
import { hapticTick } from '../../lib/aerolux/haptics.js';

// Active section
let activeSection = $state('general');

const sections = [
    { id: 'general',     icon: '🎨', label: 'General'           },
    { id: 'editor',      icon: '🖌️', label: 'Editor'            },
    { id: 'sound',       icon: '🔊', label: 'Sound & Haptics'   },
    { id: 'storage',     icon: '💾', label: 'Storage'           },
    { id: 'about',       icon: 'ℹ',  label: 'About'             },
];

// appearance –––––––––––––––––––––––––––––––––––––––––––––––––––––––

let draftH = $state(getResolvedAccentH());
$effect(() => { draftH = getResolvedAccentH(); });

function onHueInput(e) {
    draftH = parseInt(e.target.value);
    document.documentElement.style.setProperty('--accent-h', String(draftH));
}
async function onHueCommit(e) { await setAccentH(parseInt(e.target.value)); }

async function toggleTransparency(event) {
    const enabled = event.currentTarget.checked;
    await saveSetting('theme.transparency', enabled);
}

// sound ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

const VOLUME_BUSES = [
    { id: 'master',         label: 'Master' },
    { id: 'ost',            label: 'Soundtrack' },
    { id: 'sfx',            label: 'Sound effects' },
];
 
let volumeDrafts = $state({ ...settings.sound });
$effect(() => { volumeDrafts = { ...settings.sound }; });
 
function onVolumeInput(bus, e) {
    const value = parseFloat(e.target.value);
    volumeDrafts[bus] = value;
    audio.previewVolume(bus, value);
}
function onVolumeCommit(bus, e) {
    audio.setVolume(bus, parseFloat(e.target.value));
}

async function chooseProjectDirectory() {
    const path = await open({ directory: true, multiple: false });
    if (!path) return;
    await saveSetting('paths.lastProjectDir', path);
    showToast('Default project folder saved', 'success', 2000);
}

async function exportPresetBackup() {
    const path = await save({ defaultPath: 'aerolux-presets.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    const json = await exportPresetsJSON();
    await writeTextFile(path, json);
    showToast('Preset backup exported', 'success', 2000);
}

async function importPresetBackup() {
    const path = await open({ directory: false, multiple: false });
    if (!path) return;
    const result = await importPresetsJSON(await readTextFile(path), path.split('/').pop() ?? 'Imported preset');
    showToast(`Imported ${result.imported ?? 0} preset(s)`, 'success', 2500);
}

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
    const confirmed = window.confirm(
        'Delete ALL saved presets?\n\nThis permanently removes every local preset and cannot be undone. Export a backup first if you may need them later.'
    );
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
    invalidatePaletteCache();
    if (persist) {
        saveSetting('editor.customPalette', nextPalette.map(c => [
            Array.isArray(c) ? c[0] : c?.r ?? 0,
            Array.isArray(c) ? c[1] : c?.g ?? 0,
            Array.isArray(c) ? c[2] : c?.b ?? 0,
        ]));
    }
}

// check for update –––––––––––––––––––––––––––––––––––––––––––––––––
let checkingManually = false;
async function handleManualCheck() {
    checkingManually = true;
    const found = await checkForUpdate({ promptIfNew: false });
    checkingManually = false;
    showToast(found ? `Update ${updater.version} available` : "You're up to date", found ? 'info' : 'success', 3000);
}

onMount(() => {
    setDiscordContext('settings');
    const saved = settings?.editor?.customPalette;
    if (Array.isArray(saved) && saved.length) {
        applyImportedPalette(saved.map(entry => Array.isArray(entry) ? entry : [entry?.r ?? 0, entry?.g ?? 0, entry?.b ?? 0]), false);
    }
});

// reset all settings
async function resetAllSettings() {
    const confirmed = window.confirm(
        'Reset all Aerolux settings?\n\nThis restores appearance, editor defaults, sound, haptics, activity, and storage preferences. Project files and presets will not be deleted.'
    );
    if (!confirmed) return;
    try {
        await resetSettings();
        applyImportedPalette(DEFAULT_PALETTE, false);
        applyTheme();
        applyMotion();
        await setDiscordActivityEnabled(true);

        showToast('All settings reset', 'success', 2000);
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

</script>

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

        <!-- ── General ── -->
        {#if activeSection === 'general'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">General</div>

                <div class="al-settings-subgroup-title">Theme & Appearance</div>
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
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Window transparency</div>
                            <div class="al-setting-desc">
                                Disable if you experience window rendering issues.<br>
                                Or even if you just prefer a solid background, that works too.
                            </div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input
                                type="checkbox"
                                checked={settings.theme.transparency !== false}
                                onchange={toggleTransparency}
                            />
                            <span class="al-dim">{settings.theme.transparency !== false ? "Enabled" : "Disabled"}</span>
                        </label>
                    </div>
                </div>
                <div class="al-settings-subgroup-title">Motion & Animation</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Animation level</div>
                            <div class="al-setting-desc">
                                Change this setting if you are facing performance issues, or for accessibility preferences.
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
                </div>
                <div class="al-settings-subgroup-title">Activity</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Discord Rich Presence</div>
                            <div class="al-setting-desc">
                                Show your current activity in Aerolux on Discord.
                            </div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input
                            type="checkbox"
                            checked={settings.activity.enabled}
                            onchange={e => { hapticTick(); setDiscordActivityEnabled(e.currentTarget.checked); }} />
                            <span class="al-dim">{settings.activity.enabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                    </div>
                </div>

            </div>
        {/if}

        <!-- editor -->

        {#if activeSection === 'editor'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">Editor</div>

                <div class="al-settings-subgroup-title">Global</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default editor</div>
                            <div class="al-setting-desc">Highlights your preferred editor in the New Project prompt.</div>
                        </div>
                        <select class="al-select" value={settings.constants.defaultEditor ?? ''}
                            onchange={e => saveSetting('constants.defaultEditor', e.target.value || null)}>
                            <option value="">Ask every time</option>
                            <option value="velocity">Velocity</option>
                            <option value="kinetic">Kinetic</option>
                        </select>
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default Palette</div>
                            <div class="al-setting-desc">
                                Upload a custom palette to be used throughout Aerolux.
                            </div>
                        </div>
                        <div class="al-setting-control">
                            <button class="al-btn" onclick={() => paletteOpen = true}>Upload Palette</button>
                        </div>
                    </div>
                </div>

                <div class="al-settings-subgroup-title">Velocity</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default gradient steps</div>
                            <div class="al-setting-desc">Number of generated colour steps for new Velocity projects.</div>
                        </div>
                        <input class="al-num-input" type="number" min="2" max="16"
                            value={settings.editor.velocitySteps}
                            onchange={e => saveSetting('editor.velocitySteps', Math.max(2, Math.min(16, Number(e.target.value) || 16)))} />
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default algorithm</div>
                            <div class="al-setting-desc">Interpolation algorithm used when creating a new gradient.</div>
                        </div>
                        <select class="al-select" value={settings.editor.velocityAlgorithm}
                            onchange={e => saveSetting('editor.velocityAlgorithm', e.target.value)}>
                            <option value="rgb">RGB</option>
                            <option value="lab">LAB</option>
                            <option value="hsl">HSL</option>
                            <option value="vivid">Vivid</option>
                            <option value="stepped">Stepped</option>
                        </select>
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default easing</div>
                            <div class="al-setting-desc">Curve used for new Velocity gradients.</div>
                        </div>
                        <select class="al-select" value={settings.editor.velocityEasing}
                            onchange={e => saveSetting('editor.velocityEasing', e.target.value)}>
                            <option value="linear">Linear</option>
                            <option value="easeIn">Ease in</option>
                            <option value="easeOut">Ease out</option>
                            <option value="easeInOut">Ease in/out</option>
                        </select>
                    </div>
                </div>

                <div class="al-settings-subgroup-title">Kinetic</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default BPM</div>
                            <div class="al-setting-desc">Transport tempo for new Kinetic projects.</div>
                        </div>
                        <input class="al-num-input" type="number" min="1" max="999"
                            value={settings.editor.kineticBpm}
                            onchange={e => saveSetting('editor.kineticBpm', Math.max(1, Number(e.target.value) || 120))} />
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default time division</div>
                            <div class="al-setting-desc">Ticks per quarter note for new Kinetic transports.</div>
                        </div>
                        <input class="al-num-input" type="number" min="1" max="960"
                            value={settings.editor.kineticTimeDiv}
                            onchange={e => saveSetting('editor.kineticTimeDiv', Math.max(1, Math.round(Number(e.target.value) || 96)))} />
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Default duration</div>
                            <div class="al-setting-desc">Authoring window in MIDI ticks for new Kinetic projects.</div>
                        </div>
                        <input class="al-num-input" type="number" min="16"
                            value={settings.editor.kineticDuration}
                            onchange={e => saveSetting('editor.kineticDuration', Math.max(16, Math.round(Number(e.target.value) || 768)))} />
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Add Output node to new projects</div>
                            <div class="al-setting-desc">Creates a canvas output automatically so new Kinetic graphs are immediately renderable.</div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input type="checkbox" checked={settings.editor.kineticDefaultOutput}
                                onchange={e => saveSetting('editor.kineticDefaultOutput', e.currentTarget.checked)} />
                            <span class="al-dim">{settings.editor.kineticDefaultOutput ? 'Enabled' : 'Disabled'}</span>
                        </label>
                    </div>
                </div>
            </div>
        {/if}

        <!-- sound & haptics -->
         
        {#if activeSection === 'sound'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">Sound & Haptics</div>

                <div class="al-settings-subgroup-title">Sound</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Global Toggle</div>
                            <div class="al-setting-desc">
                                Mute everything while preserving volume levels.
                            </div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input type="checkbox" checked={settings.sound.enabled}
                                onchange={e => audio.setEnabled(e.target.checked)} />
                            <span class="al-dim">{settings.sound.enabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                    </div>
 
                    {#each VOLUME_BUSES as b}
                        <div class="al-setting-row">
                            <div>
                                <div class="al-setting-label">{b.label} volume</div>
                            </div>
                            <div class="al-setting-control" style="gap:10px;min-width:220px">
                                <input type="range" min="0" max="1" step="0.01"
                                    value={volumeDrafts[b.id] ?? 1}
                                    oninput={e => onVolumeInput(b.id, e)}
                                    onchange={e => onVolumeCommit(b.id, e)}
                                    style="flex:1"
                                />
                                <span class="al-val">{Math.round((volumeDrafts[b.id] ?? 1) * 100)}%</span>
                            </div>
                        </div>
                    {/each}
                </div>
 
                <div class="al-card" style="margin-top:var(--space-4)">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Soundtrack</div>
                            <div class="al-setting-desc">
                                Plays an hourly soundtrack synced to your local time.
                                {#if audioState.ost.track}
                                    Currently playing: <span class="al-mono">{audioState.ost.track}</span>
                                {/if}
                            </div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input type="checkbox" checked={settings.ost.enabled}
                                onchange={e => e.target.checked ? audio.ost.enable() : audio.ost.disable()} />
                            <span class="al-dim">{settings.ost.enabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                    </div>
                </div>

                <div class="al-settings-subgroup-title">Haptics</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Haptics</div>
                            <div class="al-setting-desc">
                                Enable/disable Aerolux-specific haptics.<br>
                                Requires a <strong>Mac</strong> with a <strong>Force Touch Trackpad</strong>.
                            </div>
                        </div>
                        <label class="al-toggle-wrap">
                            <input type="checkbox" checked={settings.haptics.enabled}
                                onchange={e => saveSetting('haptics.enabled', e.currentTarget.checked)} />
                            <span class="al-dim">{settings.haptics.enabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                    </div>
                </div>
            </div>
        {/if}

        <!-- storage -->

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
                                value={settings.paths.lastProjectDir ?? ''}
                                placeholder="No folder selected" readonly />
                            <button class="al-btn al-btn-sm" onclick={chooseProjectDirectory}>Browse</button>
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
                            <button class="al-btn al-btn-sm" onclick={exportPresetBackup}>⬇ Export JSON</button>
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
                            <button class="al-btn al-btn-sm" onclick={importPresetBackup}>⬆ Import JSON</button>
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

        <!-- about -->
        {#if activeSection === 'about'}
            <div class="al-settings-group">
                <div class="al-settings-group-title">About</div>
                <div class="al-card">
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Version</div>
                        </div>
                        <span class="al-mono">2.0.0-alpha.5</span>
                    </div>
                    <div class="al-setting-row">
                        <div>
                            <div class="al-setting-label">Check for updates</div>
                        </div>
                        <button class="al-btn al-btn-sm" onclick={handleManualCheck}>Check now</button>
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
                </div>
                <p class="al-dim" style="text-align:center;margin-top:auto;padding-top:var(--space-8)">
                    &copy; 2026 airborneyt
                </p>
            </div>
        {/if}
    </div>
</div>

<PaletteImportModal bind:open={paletteOpen} onImport={applyImportedPalette} />
