// src/lib/aerolux/python-panel.js
// python batch script generator UI
// reads editor state, builds and downloads a self-contained python file
// call initPythonPanel(callbacks) once after the DOM is ready

import { generatePythonScript, stopToCode } from './pythongen.js';
import { downloadText } from './utils.js';

export function initPythonPanel({
  getEditorState,   // () => { stops, steps, algorithm, easing, hslDir, tint, envelope }
  getPalette,       // () => palette array
  toHex,            // (r,g,b) => string
  showToast,        // (msg, type, duration) => void
  playSound,        // (name) => void
}) {

  // tint serialiser ─────────────────────────────────────────────────

  function _tintToCode() {
    const { tint } = getEditorState();
    const { getPalette: _p } = { getPalette }; // keep lint happy
    const palette  = getPalette();
    const mode     = document.getElementById('py-tint-mode').value;
    if (mode === 'none') return 'None';
    const fadeRaw  = document.getElementById('py-tint-fade')?.value || 'none';
    const fadeArg  = fadeRaw === 'none' ? '' : `, fade='${fadeRaw}'`;
    if (mode === 'white') {
      const str = (parseInt(document.getElementById('py-tint-str').value) || 30) / 100;
      return `tint_white(${str.toFixed(2)}${fadeArg})`;
    }
    if (mode === 'black') {
      const str = (parseInt(document.getElementById('py-tint-str').value) || 30) / 100;
      return `tint_black(${str.toFixed(2)}${fadeArg})`;
    }
    if (mode === 'current' && tint.ci !== null) {
      const c   = palette[tint.ci] || palette[0];
      const str = tint.str / 100;
      return `Tint((${c.r}, ${c.g}, ${c.b}), ${str.toFixed(2)}${fadeArg})`;
    }
    if (mode === 'custom') {
      const hex = document.getElementById('py-tint-hex').value.trim() || '#ffffff';
      const str = (parseInt(document.getElementById('py-tint-str').value) || 30) / 100;
      return `tint_hex('${hex}', ${str.toFixed(2)}${fadeArg})`;
    }
    return 'None';
  }

  // envelope serialiser ─────────────────────────────────────────────

  function _envelopeToCode() {
    const shape = document.getElementById('py-env-shape').value;
    if (shape === 'none') return 'None';
    if (['bell', 'valley'].includes(shape)) {
      const floor = (parseInt(document.getElementById('py-env-floor').value) || 0) / 100;
      return `Envelope(shape='${shape}', floor=${floor.toFixed(2)})`;
    }
    const attack  = (parseInt(document.getElementById('py-env-attack').value)  || 25) / 100;
    const release = (parseInt(document.getElementById('py-env-release').value) || 25) / 100;
    const floor   = (parseInt(document.getElementById('py-env-floor').value)   ||  0) / 100;
    return `Envelope(shape='${shape}', attack=${attack.toFixed(2)}, release=${release.toFixed(2)}, floor=${floor.toFixed(2)})`;
  }

  // estimate counter ────────────────────────────────────────────────

  function _updateEstimate() {
    let count = 1;
    if (document.getElementById('py-var-hue').checked)
      count += parseInt(document.getElementById('py-var-hue-count').value) || 12;
    if (document.getElementById('py-var-sat').checked)
      count += document.getElementById('py-var-sat-vals').value.split(',').filter(Boolean).length;
    if (document.getElementById('py-var-lum').checked)
      count += document.getElementById('py-var-lum-vals').value.split(',').filter(Boolean).length;
    if (document.getElementById('py-var-steps').checked)
      count += document.getElementById('py-var-steps-vals').value.split(',').filter(Boolean).length;
    if (document.getElementById('py-var-algo').checked)    count += 6;
    if (document.getElementById('py-var-easing').checked)  count += 13;
    if (document.getElementById('py-var-tint-str').checked)
      count += document.getElementById('py-var-tint-str-vals').value.split(',').filter(Boolean).length;
    if (document.getElementById('py-var-env').checked)     count += 6;
    document.getElementById('py-estimate').textContent = `${count} gradient file${count !== 1 ? 's' : ''}`;
  }

  // wire estimate listeners
  ['py-var-hue','py-var-sat','py-var-lum','py-var-steps',
   'py-var-algo','py-var-easing','py-var-tint-str','py-var-env']
    .forEach(id => document.getElementById(id)?.addEventListener('change', _updateEstimate));
  ['py-var-hue-count','py-var-hue-step','py-var-sat-vals','py-var-lum-vals',
   'py-var-steps-vals','py-var-tint-str-vals']
    .forEach(id => document.getElementById(id)?.addEventListener('input', _updateEstimate));

  // sub-option visibility
  document.getElementById('py-tint-mode').addEventListener('change', e => {
    document.getElementById('py-tint-options').style.display =
      e.target.value === 'custom' ? 'flex' : 'none';
  });
  document.getElementById('py-env-shape').addEventListener('change', e => {
    document.getElementById('py-env-options').style.display =
      ['fade_in','fade_out','fade_both'].includes(e.target.value) ? 'flex' : 'none';
  });

  _updateEstimate();

  // generate ────────────────────────────────────────────────────────

  document.getElementById('auto-gen-script-btn').addEventListener('click', () => {
    const state   = getEditorState();
    const palette = getPalette();

    const jobName  = document.getElementById('py-job-name').value.trim() || 'my_gradient';
    const outDir   = document.getElementById('py-out-dir').value.trim()  || 'aerolux_output';
    const pyAlgo   = document.getElementById('py-algo').value;
    const pyEasing = document.getElementById('py-easing').value;
    const pyHslDir = document.getElementById('py-hsl-dir').value;
    const pyStepsRaw = document.getElementById('py-steps').value;
    const pySteps    = pyStepsRaw ? parseInt(pyStepsRaw) : null;
    const inclExamples = document.getElementById('py-include-examples').checked;

    const effAlgo   = pyAlgo   === 'current' ? state.algorithm : pyAlgo;
    const effEasing = pyEasing === 'current' ? state.easing    : pyEasing;
    const effHslDir = pyHslDir === 'current' ? state.hslDir    : pyHslDir;
    const effSteps  = pySteps  ?? state.steps;

    const sortedStops = [...state.stops].sort((a, b) => a.pos - b.pos);
    const stopsCode   = sortedStops.map(s => stopToCode(s, palette, toHex)).join('\n');

    // variation blocks ───────────────────────────────────────────────
    const varBlocks = [];
    const hasAnyVariation = ['py-var-hue','py-var-sat','py-var-lum','py-var-steps',
      'py-var-algo','py-var-easing','py-var-tint-str','py-var-env']
      .some(id => document.getElementById(id).checked);
    const nameStar = hasAnyVariation ? '*' : '';

    if (document.getElementById('py-var-hue').checked) {
      const count   = parseInt(document.getElementById('py-var-hue-count').value) || 12;
      const hueStep = parseInt(document.getElementById('py-var-hue-step').value)  || 30;
      const entries = Array.from({ length: count }, (_, i) => {
        const deg = i * hueStep;
        return `        Variation(name_suffix='_h${deg}', hue_shift=${deg}),`;
      }).join('\n');
      varBlocks.push(`    # Hue rotation (${count} variations, ${hueStep}° each)\n${entries}`);
    }

    if (document.getElementById('py-var-sat').checked) {
      const vals = document.getElementById('py-var-sat-vals').value
        .split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      const entries = vals.map(v =>
        `        Variation(name_suffix='_sat${Math.round(v*100)}', sat_mult=${v.toFixed(2)}),`
      ).join('\n');
      varBlocks.push(`    # Saturation sweep\n${entries}`);
    }

    if (document.getElementById('py-var-lum').checked) {
      const vals = document.getElementById('py-var-lum-vals').value
        .split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      const entries = vals.map(v =>
        `        Variation(name_suffix='_lum${Math.round(v*100)}', lum_mult=${v.toFixed(2)}),`
      ).join('\n');
      varBlocks.push(`    # Luminance sweep\n${entries}`);
    }

    if (document.getElementById('py-var-steps').checked) {
      const vals = document.getElementById('py-var-steps-vals').value
        .split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v) && v >= 2 && v <= 16);
      const entries = vals.map(v =>
        `        Variation(name_suffix='_${v}steps', steps=${v}),`
      ).join('\n');
      varBlocks.push(`    # Length sweep\n${entries}`);
    }

    if (document.getElementById('py-var-algo').checked) {
      const algos = ['rgb','lab','hsl','vivid','stepped'];
      const entries = [
        ...algos.map(a => `        Variation(name_suffix='_${a}', algorithm='${a}'),`),
        `        Variation(name_suffix='_hsl_long', algorithm='hsl', hsl_direction='longest'),`,
      ].join('\n');
      varBlocks.push(`    # Algorithm comparison\n${entries}`);
    }

    if (document.getElementById('py-var-easing').checked) {
      const easings = ['linear','ease_in','ease_out','s_curve','cubic_in','cubic_out',
                       'sine_in','sine_out','sine_both','expo_in','expo_out','bounce','elastic'];
      const entries = easings.map(e =>
        `        Variation(name_suffix='_${e}', easing='${e}'),`
      ).join('\n');
      varBlocks.push(`    # Easing comparison\n${entries}`);
    }

    if (document.getElementById('py-var-tint-str').checked) {
      const vals    = document.getElementById('py-var-tint-str-vals').value
        .split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
      const baseTint = _tintToCode() !== 'None' ? _tintToCode() : 'tint_white(0.3)';
      const entries = vals.map(v => {
        const s  = (v / 100).toFixed(2);
        const tc = baseTint.replace(/(\d+\.\d+)/, s);
        return `        Variation(name_suffix='_tint${v}', tint=${tc}),`;
      }).join('\n');
      varBlocks.push(`    # Tint strength sweep\n${entries}`);
    }

    if (document.getElementById('py-var-env').checked) {
      const envs  = [
        `Envelope(shape='none')`,
        `Envelope(shape='fade_in',  attack=0.4, release=0.0, floor=0.0)`,
        `Envelope(shape='fade_out', attack=0.0, release=0.4, floor=0.0)`,
        `Envelope(shape='fade_both',attack=0.3, release=0.3, floor=0.0)`,
        `Envelope(shape='bell',     floor=0.05)`,
        `Envelope(shape='valley',   floor=0.05)`,
      ];
      const names = ['none','fade_in','fade_out','fade_both','bell','valley'];
      const entries = envs.map((e, i) =>
        `        Variation(name_suffix='_env_${names[i]}', envelope=${e}),`
      ).join('\n');
      varBlocks.push(`    # Envelope suite\n${entries}`);
    }

    const variationsCode = varBlocks.length
      ? `    variations = [\n${varBlocks.join('\n\n')}\n    ],`
      : '';

    const generatedJob = `
    # Generated from Aerolux editor. ${new Date().toLocaleString()}
    GradientJob(
        name      = '${jobName}${nameStar}',
        steps     = ${effSteps},
        algorithm = '${effAlgo}',
        easing    = '${effEasing}',
        hsl_direction = '${effHslDir}',
        stops     = [
${stopsCode}
        ],
        tint      = ${_tintToCode()},
        envelope  = ${_envelopeToCode()},
        anti_repeat = True,
${variationsCode}
    ),`;

    // pass '' to omit examples, or reconstruct the block here if needed.
    const examplesBlock = inclExamples ? _buildExamplesBlock() : '';

    const script = generatePythonScript('', outDir, generatedJob, examplesBlock);
    downloadText(script, 'aerolux_batch.py');
    showToast('Python script downloaded', 'success');
    playSound('downloadSuccess');
  });

  // examples block ──────────────────────────────────────────────────

  function _buildExamplesBlock() {
    return `

    # EXAMPLE JOBS

    # example 1: simple two-stop gradient
    GradientJob(
        name      = 'red_to_blue',
        steps     = 16,
        algorithm = 'lab',
        easing    = 's_curve',
        stops     = [
            stop(0.0, 63, 0, 0),   # deep red
            stop(1.0, 0, 0, 63),   # deep blue
        ],
    ),
 
    # example 2: multi-stop with a midpoint
    GradientJob(
        name      = 'fire',
        steps     = 16,
        algorithm = 'lab',
        easing    = 'ease_in',
        stops     = [
            stop(0.0, 16, 0, 0),   # near black-red
            stop(0.4, 63, 10, 0),  # deep orange
            stop(0.7, 63, 50, 0),  # warm yellow
            stop(1.0, 63, 63, 63), # white-hot
        ],
    ),
 
    # example 3: hex colour stops
    GradientJob(
        name      = 'sunset_hex',
        steps     = 14,
        algorithm = 'hsl',
        hsl_direction = 'shortest',
        easing    = 's_curve',
        stops     = [
            stop_hex(0.0, '#ff2200'),
            stop_hex(0.5, '#ff8800'),
            stop_hex(1.0, '#9900ff'),
        ],
    ),
 
    # example 4: hsl stops (hue in degrees)
    GradientJob(
        name      = 'rainbow',
        steps     = 16,
        algorithm = 'hsl',
        hsl_direction = 'longest',  # take the long way around
        easing    = 'linear',
        stops     = [
            stop_hsl(0.0,   0, 1.0, 0.5),  # red
            stop_hsl(1.0, 360, 1.0, 0.5),  # back to red via full wheel
        ],
    ),
 
    # example 5: white tint (deep → pastel)
    GradientJob(
        name      = 'pastel_blue',
        steps     = 12,
        algorithm = 'rgb',
        easing    = 'ease_out',
        stops     = [
            stop(0.0, 0, 0, 63),
            stop(1.0, 0, 50, 63),
        ],
        tint = tint_white(strength=0.45),
    ),
 
    # example 6: fade-off envelope
    GradientJob(
        name      = 'pulse_blue',
        steps     = 16,
        algorithm = 'rgb',
        easing    = 'linear',
        stops     = [
            stop(0.0, 0, 0, 63),
            stop(1.0, 0, 32, 63),
        ],
        envelope = Envelope(
            shape   = 'bell',   # bright in middle, dark at edges
            floor   = 0.05,     # never fully black
        ),
    ),
 
    # example 9: palette index stops
    GradientJob(
        name      = 'palette_pin',
        steps     = 8,
        algorithm = 'lab',
        easing    = 'linear',
        stops     = [
            stop_palette(0.0,  1),   # palette index 1  (bright white)
            stop_palette(0.5, 48),   # palette index 48 (deep blue)
            stop_palette(1.0,  8),   # palette index 8  (deep red)
        ],
    ),
 
    # example 10: hue rotation variations
    # '*' at end of the name means skip the base and only output variations
    GradientJob(
        name      = 'hue_sweep*',
        steps     = 16,
        algorithm = 'lab',
        easing    = 's_curve',
        stops     = [
            stop_hsl(0.0,   0, 1.0, 0.4),
            stop_hsl(0.5,  30, 0.9, 0.5),
            stop_hsl(1.0,   0, 0.5, 0.3),
        ],
        variations = [
            Variation(name_suffix='_red',    hue_shift=0),
            Variation(name_suffix='_orange', hue_shift=30),
            Variation(name_suffix='_yellow', hue_shift=60),
            Variation(name_suffix='_green',  hue_shift=120),
            Variation(name_suffix='_cyan',   hue_shift=180),
            Variation(name_suffix='_blue',   hue_shift=240),
            Variation(name_suffix='_violet', hue_shift=300),
        ],
    ),
 
    # example 11: saturation variations
    GradientJob(
        name      = 'sat_sweep*',
        steps     = 12,
        algorithm = 'lab',
        easing    = 'ease_out',
        stops     = [
            stop_hsl(0.0, 200, 1.0, 0.3),
            stop_hsl(1.0, 220, 0.8, 0.5),
        ],
        variations = [
            Variation(name_suffix='_vivid',  sat_mult=1.0),
            Variation(name_suffix='_mid',    sat_mult=0.5),
            Variation(name_suffix='_pastel', sat_mult=0.25),
            Variation(name_suffix='_grey',   sat_mult=0.05),
        ],
    ),
 
    # example 12: length variations
    GradientJob(
        name      = 'length_test*',
        steps     = 16,
        algorithm = 'rgb',
        easing    = 'linear',
        stops     = [
            stop(0.0, 0, 63, 0),
            stop(1.0, 63, 0, 63),
        ],
        variations = [
            Variation(name_suffix='_2',  steps=2),
            Variation(name_suffix='_4',  steps=4),
            Variation(name_suffix='_8',  steps=8),
            Variation(name_suffix='_12', steps=12),
            Variation(name_suffix='_16', steps=16),
        ],
    ),
 
    # example 13: algorithm comparison
    GradientJob(
        name      = 'algo_compare*',
        steps     = 16,
        algorithm = 'rgb',
        easing    = 'linear',
        stops     = [
            stop(0.0, 63, 0, 0),
            stop(1.0, 0, 0, 63),
        ],
        variations = [
            Variation(name_suffix='_rgb',     algorithm='rgb'),
            Variation(name_suffix='_lab',     algorithm='lab'),
            Variation(name_suffix='_hsl_sht', algorithm='hsl', hsl_direction='shortest'),
            Variation(name_suffix='_hsl_lng', algorithm='hsl', hsl_direction='longest'),
            Variation(name_suffix='_vivid',   algorithm='vivid'),
            Variation(name_suffix='_stepped', algorithm='stepped'),
        ],
    ),
 
    # example 14: easing comparison
    GradientJob(
        name      = 'easing_compare*',
        steps     = 16,
        algorithm = 'lab',
        easing    = 'linear',
        stops     = [
            stop(0.0, 63, 0, 25),
            stop(1.0, 0, 25, 63),
        ],
        variations = [
            Variation(name_suffix=f'_{k}', easing=k)
            for k in EASINGS
        ],
    ),
 
    # example 15: tint colour sweep
    GradientJob(
        name      = 'tint_sweep*',
        steps     = 12,
        algorithm = 'lab',
        easing    = 's_curve',
        stops     = [
            stop(0.0, 0, 32, 63),
            stop(1.0, 0, 0, 63),
        ],
        variations = [
            Variation(name_suffix='_no_tint',    tint=False),
            Variation(name_suffix='_white_10',   tint=tint_white(0.10)),
            Variation(name_suffix='_white_30',   tint=tint_white(0.30)),
            Variation(name_suffix='_white_60',   tint=tint_white(0.60)),
            Variation(name_suffix='_warm_fade',  tint=Tint((63,30,0), 0.5, fade='in')),
            Variation(name_suffix='_cold_fade',  tint=Tint((0,30,63), 0.5, fade='out')),
            Variation(name_suffix='_gold_bell',  tint=Tint((63,50,0), 0.6, fade='centre')),
        ],
    ),
 
    # example 16: luminance variations
    GradientJob(
        name      = 'lum_sweep*',
        steps     = 16,
        algorithm = 'lab',
        easing    = 'ease_out',
        stops     = [
            stop_hsl(0.0, 240, 1.0, 0.5),
            stop_hsl(1.0, 260, 0.8, 0.4),
        ],
        variations = [
            Variation(name_suffix='_bright', lum_mult=1.4),
            Variation(name_suffix='_normal', lum_mult=1.0),
            Variation(name_suffix='_dark',   lum_mult=0.6),
            Variation(name_suffix='_dim',    lum_mult=0.3),
        ],
    ),
 
    # example 17: full envelope suite
    GradientJob(
        name      = 'envelope_suite*',
        steps     = 16,
        algorithm = 'lab',
        easing    = 'linear',
        stops     = [
            stop_hsl(0.0, 120, 1.0, 0.4),
            stop_hsl(1.0, 160, 0.8, 0.5),
        ],
        variations = [
            Variation(name_suffix='_none',      envelope=Envelope(shape='none')),
            Variation(name_suffix='_fade_in',   envelope=Envelope(shape='fade_in',  attack=0.5,  floor=0.0)),
            Variation(name_suffix='_fade_out',  envelope=Envelope(shape='fade_out', release=0.5, floor=0.0)),
            Variation(name_suffix='_fade_both', envelope=Envelope(shape='fade_both', attack=0.3, release=0.3, floor=0.0)),
            Variation(name_suffix='_bell',      envelope=Envelope(shape='bell',     floor=0.05)),
            Variation(name_suffix='_valley',    envelope=Envelope(shape='valley',   floor=0.05)),
        ],
    ),
 
    # example 18: multi-property variations
    # every combination of two hue offsets and two easing modes
    GradientJob(
        name      = 'matrix*',
        steps     = 16,
        algorithm = 'lab',
        easing    = 'linear',
        stops     = [
            stop_hsl(0.0,  30, 1.0, 0.4),
            stop_hsl(0.5,  60, 0.9, 0.5),
            stop_hsl(1.0,  30, 0.6, 0.3),
        ],
        variations = [
            Variation(
                name_suffix = f'_h{int(h)}_e{e}',
                hue_shift   = h,
                easing      = e,
            )
            for h, e in itertools.product([0, 90, 180, 270],
                                          ['linear', 's_curve', 'bounce'])
        ],
    ),`;
  }
}