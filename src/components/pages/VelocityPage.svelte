<script>
import { onMount, onDestroy } from 'svelte';
import { editor } from '../../stores/velocity.svelte.js';
import { undo, redo, undoState } from '../../stores/velocityActions.svelte.js';
import { initSound } from '../../lib/aerolux/sound.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { initKeyboardShortcuts } from '../../lib/aerolux/keyboard.js';

import GradientEditor  from '../velocity/GradientEditor.svelte';
import HueShiftRow     from '../velocity/HueShiftRow.svelte';
import PalettePanel    from '../velocity/PalettePanel.svelte';
import StepsAndCurve   from '../velocity/StepsAndCurve.svelte';
import AlgorithmPanel  from '../velocity/AlgorithmPanel.svelte';
import AirbotPanel     from '../velocity/AirbotPanel.svelte';
import TintPanel       from '../velocity/TintPanel.svelte';
import OutputCard      from '../velocity/OutputCard.svelte';
import AutomationPanel from '../velocity/AutomationPanel.svelte';
import HistoryPanel    from '../velocity/HistoryPanel.svelte';
import MidiPanel       from '../velocity/MidiPanel.svelte';
import PresetOverlay   from '../preset/PresetOverlay.svelte';
import HelpModal       from '../modals/HelpModal.svelte';
import ImportModal     from '../modals/ImportModal.svelte';

import { gradResult } from '../../stores/velocity.svelte.js';

// $state(null). reactive so keyboard shortcuts see the API after mount
let palettePanel = $state(null);

let saveGradient      = $state(null);
let presetOpen        = $state(false);
let presetInitialName = $state('');
let helpOpen          = $state(false);
let importOpen        = $state(false);

function openPresets(name = '') {
    presetInitialName = name;
    presetOpen = true;
}

// push named presets when they are saved:
// (call this from saveCurrentGradient in preset-manager.js)

onMount(() => {
    initSound();

    // keyboard shortcuts, uses $state palettePanel so closure
    // sees the real API after PalettePanel.svelte sets it via bind:api
    initKeyboardShortcuts({
        undo,
        redo,
        focusSwatch:         (idx) => palettePanel?.focusSwatch(idx),
        getHoveredSwatchIdx: ()    => palettePanel?.getHoveredSwatchIdx() ?? 0,
        getGridCols:         ()    => palettePanel?.getGridCols() ?? 16,
        getSwatchEls:        ()    => palettePanel?.getSwatchEls() ?? [],
        setPickingTint:      (v)   => { editor.pickingTint = v; },
        showToast,
    });
});

onDestroy(stop);
</script>

    <header class="al-header">
        <div class="al-header-brand">
            <span class="al-logo-text">Velo<span class="al-logo-accent">city</span></span>
            <span class="al-logo-sub" style="font-size:8px">Gradient editor</span>
        </div>
        <div class="al-header-actions">
            <button class="al-btn" onclick={() => presetOpen = true}>Presets</button>
            <button class="al-btn" onclick={() => importOpen = true}>↑ Import</button>
            <button class="al-btn" onclick={() => helpOpen = true}>? Help</button>
        </div>
    </header>

    <div class="al-main">
        <div class="al-left">
            <PalettePanel bind:api={palettePanel} />
            <div class="al-card" style="grid-column:1/-1">
                <AutomationPanel />
            </div>
        </div>
        <div class="al-right">
            <div class="al-card">
                <GradientEditor onUndo={undo} onRedo={redo} />
                <HueShiftRow />
            </div>
            <div class="al-settings-row">
                <StepsAndCurve />
                <AlgorithmPanel />
                <TintPanel />
            </div>
            <OutputCard onOpenPresets={openPresets} {saveGradient} />
        </div>
    </div>

    <div class="al-bottom-grid">
        <MidiPanel />
        <div class="al-card">
            <AirbotPanel />
        </div>
        <HistoryPanel />
    </div>

    <HelpModal   bind:open={helpOpen} />
    <ImportModal bind:open={importOpen} />
    <PresetOverlay bind:open={presetOpen} bind:saveGradient initialName={presetInitialName} />