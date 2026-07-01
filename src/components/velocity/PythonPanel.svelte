<!-- src/components/velocity/PythonPanel.svelte -->
<!-- 
  handles the python part that within automation panel
  all the controls here are later sent to the python script generator
-->
<script>
import { onMount } from 'svelte';
import { editor } from '../../stores/velocity.svelte.js';
import { initPythonPanel } from '../../lib/aerolux/python-panel.js';
import { toHex } from '../../lib/aerolux/palette.js';
import { showToast } from '../../lib/aerolux/toast.js';
import { playSound } from '../../lib/aerolux/sound.js';

onMount(() => {
    initPythonPanel({
        getEditorState: () => ({
            stops:    editor.stops,
            steps:    editor.steps,
            algorithm: editor.algorithm,
            easing:   editor.easing,
            hslDir:   editor.hslDir,
            tint:     editor.tint,
            envelope: editor.envelope,
        }),
        getPalette: () => editor.palette,
        toHex,
        showToast,
        playSound,
    });
});
</script>

<div id="auto-python-panel">
  <p class="al-hint-text" style="margin-bottom:12px">
    Configures a batch file from the current gradient. Download the script and run it locally.
  </p>

  <!-- output dir -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <span class="al-label" style="margin:0;min-width:100px">Output folder</span>
    <input type="text" id="py-out-dir" class="al-text-input" value="aerolux_output" style="max-width:200px" />
  </div>

  <!-- base tweak settings -->
  <div class="al-card" style="margin-bottom:12px;padding:12px 14px">
    <p class="al-label" style="margin-bottom:8px">Base file</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">

      <div>
        <p class="al-label">File name</p>
        <input type="text" id="py-job-name" class="al-text-input" style="font-size: 10px; margin: 0 0 5px;" value="my_gradient" />
      </div>

      <div>
        <p class="al-label">Algorithm</p>
        <select id="py-algo" class="al-select">
          <option value="current">Current (from editor)</option>
          <option value="rgb">RGB nearest</option>
          <option value="lab">Perceptual (LAB)</option>
          <option value="hsl">HSL path</option>
          <option value="vivid">Vivid</option>
          <option value="stepped">Stepped</option>
        </select>
      </div>

      <div>
        <p class="al-label">Easing</p>
        <select id="py-easing" class="al-select">
          <option value="current">Current (from editor)</option>
          <option value="linear">Linear</option>
          <option value="ease_in">Ease in</option>
          <option value="ease_out">Ease out</option>
          <option value="s_curve">S-curve</option>
          <option value="cubic_in">Cubic in</option>
          <option value="cubic_out">Cubic out</option>
          <option value="sine_in">Sine in</option>
          <option value="sine_out">Sine out</option>
          <option value="sine_both">Sine both</option>
          <option value="expo_in">Expo in</option>
          <option value="expo_out">Expo out</option>
          <option value="bounce">Bounce</option>
          <option value="elastic">Elastic</option>
        </select>
      </div>

      <div>
        <p class="al-label">HSL direction</p>
        <select id="py-hsl-dir" class="al-select">
          <option value="current">Current (from editor)</option>
          <option value="shortest">Shortest</option>
          <option value="longest">Longest</option>
        </select>
      </div>

      <div>
        <p class="al-label">Steps</p>
        <input type="number" id="py-steps" class="al-text-input"
          min="2" max="16" value="" placeholder="current" style="width:70px;font-size: 10px; margin: 0 0 5px;" />
      </div>

    </div>
  </div>

  <!-- tint -->
  <div class="al-card" style="margin-bottom:12px;padding:12px 14px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <p class="al-label" style="margin:0">Tint</p>
      <select id="py-tint-mode" class="al-select" style="max-width:160px">
        <option value="none">None</option>
        <option value="current">Current (from editor)</option>
        <option value="white">White</option>
        <option value="black">Black</option>
        <option value="custom">Custom hex</option>
      </select>
    </div>
    <div id="py-tint-options" style="display:none;gap:10px;flex-wrap:wrap;align-items:center">
      <div>
        <p class="al-label">Colour</p>
        <input type="text" id="py-tint-hex" class="al-text-input"
        placeholder="#ff8800" style="max-width:110px" />
      </div>
      <div>
        <p class="al-label">Strength</p>
        <input type="number" id="py-tint-str" class="al-num-input"
          min="0" max="100" value="30" style="width:60px" />
        <span class="al-dim">%</span>
      </div>
      <div>
        <p class="al-label">Fade</p>
        <select id="py-tint-fade" class="al-select" style="max-width:120px">
          <option value="none">None</option>
          <option value="in">Fade in</option>
          <option value="out">Fade out</option>
          <option value="centre">Centre bell</option>
        </select>
      </div>
    </div>
  </div>

  <!-- envelope -->
  <div class="al-card" style="margin-bottom:12px;padding:12px 14px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <p class="al-label" style="margin:0">Brightness envelope</p>
      <select id="py-env-shape" class="al-select" style="max-width:160px">
        <option value="none">None</option>
        <option value="fade_in">Fade in</option>
        <option value="fade_out">Fade out</option>
        <option value="fade_both">Fade both ends</option>
        <option value="bell">Bell (bright centre)</option>
        <option value="valley">Valley (dim centre)</option>
      </select>
    </div>
    <div id="py-env-options" style="display:none;gap:10px;flex-wrap:wrap;align-items:center">
      <div>
        <p class="al-label">Attack</p>
        <input type="number" id="py-env-attack" class="al-num-input"
          min="0" max="100" value="25" style="width:60px" />
        <span class="al-dim">%</span>
      </div>
      <div>
        <p class="al-label">Release</p>
        <input type="number" id="py-env-release" class="al-num-input"
          min="0" max="100" value="25" style="width:60px" />
        <span class="al-dim">%</span>
      </div>
      <div>
        <p class="al-label">Floor</p>
        <input type="number" id="py-env-floor" class="al-num-input"
          min="0" max="100" value="0" style="width:60px" />
        <span class="al-dim">%</span>
      </div>
    </div>
  </div>

  <!-- variation packs -->
  <div class="al-card" style="margin-bottom:12px;padding:12px 14px">
    <p class="al-label" style="margin-bottom:10px">Variation packs. Tick any to include</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">

      <label class="al-checkbox-label" style="flex-direction:column;align-items:flex-start;gap:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="py-var-hue" />
          <span style="font-size:12px">Hue rotation</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;padding-left:20px">
          <span class="al-dim">Count</span>
          <input type="number" id="py-var-hue-count" class="al-num-input"
            min="2" max="36" value="12" style="width:48px" />
          <span class="al-dim">Step °</span>
          <input type="number" id="py-var-hue-step" class="al-num-input"
            min="1" max="180" value="30" style="width:48px" />
        </div>
      </label>

      <label class="al-checkbox-label" style="flex-direction:column;align-items:flex-start;gap:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="py-var-sat" />
          <span style="font-size:12px">Saturation sweep</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;padding-left:20px;flex-wrap:wrap">
          <span class="al-dim">Values</span>
          <input type="text" id="py-var-sat-vals" class="al-text-input"
            value="1.0, 0.6, 0.3, 0.05" style="max-width:160px;font-size:11px" />
        </div>
      </label>

      <label class="al-checkbox-label" style="flex-direction:column;align-items:flex-start;gap:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="py-var-lum" />
          <span style="font-size:12px">Luminance sweep</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;padding-left:20px;flex-wrap:wrap">
          <span class="al-dim">Values</span>
          <input type="text" id="py-var-lum-vals" class="al-text-input"
          value="1.4, 1.0, 0.6, 0.3" style="max-width:160px;font-size:11px" />
        </div>
      </label>

      <label class="al-checkbox-label" style="flex-direction:column;align-items:flex-start;gap:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="py-var-steps" />
          <span style="font-size:12px">Length sweep</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;padding-left:20px;flex-wrap:wrap">
          <span class="al-dim">Lengths</span>
          <input type="text" id="py-var-steps-vals" class="al-text-input"
            value="4, 8, 12, 16" style="max-width:140px;font-size:11px" />
        </div>
      </label>

      <label class="al-checkbox-label" style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" id="py-var-algo" />
        <span style="font-size:12px">Algorithm comparison (all 6)</span>
      </label>

      <label class="al-checkbox-label" style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" id="py-var-easing" />
        <span style="font-size:12px">Easing comparison (all 13)</span>
      </label>

      <label class="al-checkbox-label" style="flex-direction:column;align-items:flex-start;gap:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="py-var-tint-str" />
          <span style="font-size:12px">Tint strength sweep</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;padding-left:20px;flex-wrap:wrap">
          <span class="al-dim">Strengths %</span>
          <input type="text" id="py-var-tint-str-vals" class="al-text-input"
            value="10, 25, 50, 75" style="max-width:140px;font-size:11px" />
        </div>
      </label>

      <label class="al-checkbox-label" style="flex-direction:column;align-items:flex-start;gap:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="py-var-env" />
          <span style="font-size:12px">Envelope suite (all shapes)</span>
        </div>
      </label>

    </div>
  </div>

  <!-- output estimate -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
    <span class="al-label" style="margin:0">Estimated output:</span>
    <span id="py-estimate" class="al-dim">—</span>
  </div>

  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="al-btn al-btn-blue" id="auto-gen-script-btn">⬇ Generate Python script</button>
    <label class="al-checkbox-label" style="font-size:12px;display:flex;align-items:center;gap:6px">
      <input type="checkbox" id="py-include-examples" />
      <span>Also include example tweaks</span>
    </label>
  </div>
</div>