// ════════════════════════════════════════════════════════════════════
// compat.js
// hardware compatibility checker for Aerolux AI features.
//
// replaces the old WebGPU adapter-sniffing approach with a single
// invoke('get_hardware_info') call to the rust backend, which returns
// real OS-level data: GPU vendor/name/VRAM, system RAM, CPU threads,
// and whether a llama.cpp acceleration backend (Metal/Vulkan/CUDA) is
// actually available.
//
// two public exports:
//   runCompatCheck()          — renders the full UI check into the
//                               #ai-compat-box DOM elements. called
//                               when the user clicks "Compatibility check".
//   isAccelerationAvailable() — fast boolean gate, called by AirbotPanel
//                               before attempting a binary download. returns
//                               true if hardware.rs says acceleration is
//                               available. does not render any UI.
//
// VRAM override: when rust returns gpu_vram_mb = null (Linux non-NVIDIA,
// or Apple Silicon where unified memory can't be auto-detected per-GPU),
// the UI pauses and asks the user to enter their VRAM manually, then
// saves it to settings under 'vram'. subsequent calls use
// the saved value without prompting.
// ════════════════════════════════════════════════════════════════════

import { invoke }      from '@tauri-apps/api/core';
import { showToast }   from './toast.js';
import { settings, saveSetting } from '../../stores/settings.svelte.js'

// Gemma 4 E4B Q4_K_M is a ~5 GB model — treat as 'large' for scoring.
const AI_MODEL_LABEL = '4B (E4B Q4_K_M)';
const MODEL_SIZE_TIER = 'medium';
// isAccelerationAvailable ───────────────────────────────────────────
// called by AirbotPanel before any download attempt

export async function isAccelerationAvailable() {
    try {
        const info = await invoke('get_hardware_info');
        return info.acceleration_available === true;
    } catch {
        // fail safe if tauri command unavailable (e.g. running in browser devtools)
        return false;
    }
}

// runCompatCheck ────────────────────────────────────────────────────

export async function runCompatCheck() {
    const btn       = document.getElementById('ai-compat-btn');
    const box       = document.getElementById('ai-compat-box');
    const rowsEl    = document.getElementById('ai-compat-rows');
    const verdictEl = document.getElementById('ai-compat-verdict');

    btn.disabled          = true;
    btn.textContent       = 'Checking…';
    box.style.display     = 'block';
    rowsEl.innerHTML      = '<span style="opacity:0.5">Querying hardware…</span>';
    verdictEl.textContent = '';

    // 1. fetch real hardware info from Rust ─────────────────────────

    let info;
    try {
        info = await invoke('get_hardware_info');
    } catch (e) {
        rowsEl.innerHTML      = `✗ Hardware query failed: ${e}`;
        verdictEl.textContent = '✗ Could not read hardware info';
        verdictEl.style.color = 'var(--color-danger)';
        btn.disabled = false; btn.textContent = 'Run again';
        return;
    }

    // 2. hard gate: acceleration backend ────────────────────────────
    // if llama.cpp has no usable GPU backend on this machine, Airbot
    // will not work regardless of other specs. surface this immediately
    // rather than letting the user wait through a download only to fail.

    if (!info.acceleration_available) {
        rowsEl.innerHTML = [
            `GPU: ${info.gpu_name || 'Not detected'}`,
            `Vendor: ${info.gpu_vendor}`,
            `✗ No supported acceleration backend (Metal/Vulkan/CUDA) detected.`,
            `  Airbot requires GPU acceleration and will not run on CPU only.`,
            `  On Linux with an NVIDIA card, ensure the driver is installed.`,
            `  On Linux with AMD/Intel, ensure Vulkan drivers are installed.`,
        ].map(r => `<div>${r}</div>`).join('');
        verdictEl.textContent = '✗ Not compatible — no GPU acceleration available';
        verdictEl.style.color = 'var(--color-danger)';
        btn.disabled = false; btn.textContent = 'Run again';
        return;
    }

    // 3. build rows and score ───────────────────────────────────────

    const rows  = [];
    let   score = 0;

    // GPU identity
    rows.push(`GPU: ${info.gpu_name || 'Not identified'}`);
    rows.push(`Vendor: ${_vendorLabel(info.gpu_vendor)}`);

    if (info.is_unified_memory) {
        rows.push('Note: Apple Silicon uses unified memory shared between CPU and GPU.');
        rows.push('Enter your total system RAM as the practical VRAM ceiling.');
    }

    // 4. VRAM ───────────────────────────────────────────────────────
    // prefer Rust-detected value, fall back to stored override, then prompt.

    const storedVram   = settings.vram;
    let   rustVramGb   = info.gpu_vram_mb != null ? info.gpu_vram_mb / 1024 : null;
    let   detectedVram = null;

    if (rustVramGb != null) {
        // rust gives a real value. use it, but allow override to persist
        // if the user has already set one (they may know better for unified memory).
        if (!isNaN(storedVram)) {
            detectedVram = storedVram;
            rows.push(`VRAM: ${detectedVram.toFixed(1)} GB (saved override. Detected ${rustVramGb.toFixed(1)} GB)`);
        } else {
            detectedVram = rustVramGb;
            rows.push(`VRAM: ${detectedVram.toFixed(1)} GB`);
        }
    } else if (!isNaN(storedVram)) {
        // rust couldn't detect VRAM (Linux non-NVIDIA, Apple unified) but
        // the user already saved an override: use it without prompting.
        detectedVram = storedVram;
        rows.push(`VRAM: ${detectedVram.toFixed(1)} GB (saved override)`);
        document.getElementById('ai-vram-reset-btn').style.display = 'inline-flex';
    } else {
        // need to ask the user. render what we have so far, then pause.
        rowsEl.innerHTML = rows.map(r => `<div>${r}</div>`).join('') + `
            <div style="margin-top:10px;padding:10px;border-radius:8px;
                border:1px solid var(--color-border);background:var(--color-surface-0)">
                <p class="al-label" style="margin-bottom:6px">
                    ${info.is_unified_memory ? 'Total system RAM (used as VRAM ceiling)' : 'GPU VRAM'} (GB)
                </p>
                <p class="al-hint-text" style="margin-bottom:8px">
                    ${info.is_unified_memory
                        ? 'Enter your total system RAM. Apple Silicon allocates GPU memory from the same pool.'
                        : 'Could not detect VRAM automatically. Enter your GPU\'s VRAM in GB.'
                    }<br>This is saved locally and used for future checks.
                </p>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <input type="number" id="vram-input" class="al-num-input"
                        min="1" max="512" step="0.5" placeholder="e.g. 8" style="width:80px" />
                    <span class="al-dim">GB</span>
                    <button class="al-btn al-btn-blue" id="vram-confirm-btn">Confirm and continue</button>
                    <button class="al-btn" id="vram-skip-btn">Skip</button>
                </div>
            </div>`;
        verdictEl.textContent = '';

        detectedVram = await new Promise(resolve => {
            document.getElementById('vram-confirm-btn').addEventListener('click', () => {
                const val = parseFloat(document.getElementById('vram-input').value);
                if (isNaN(val) || val <= 0) { showToast('Enter a valid number', 'warning'); return; }
                saveSetting('vram', val);
                resolve(val);
            });
            document.getElementById('vram-skip-btn').addEventListener('click', () => resolve(null));
        });

        if (detectedVram !== null) {
            rows.push(`VRAM: ${detectedVram.toFixed(1)} GB (user-declared)`);
            showToast(`VRAM saved as ${detectedVram.toFixed(1)} GB`, 'info', 2000);
        } else {
            rows.push('VRAM: Unknown (skipped). Using neutral score');
        }
    }

    // 5. VRAM score ─────────────────────────────────────────────────
    // Gemma 4 E4B Q4_K_M is ~5 GB, so it is tiered as a medium model.

    if (detectedVram !== null) {
        const tiers = MODEL_SIZE_TIER === 'large'
        ? [
            [10, 35, '✓ Comfortable'],
            [7,  24, '✓ Minimum viable. Close other apps'],
            [4,  10, '⚠ Very likely to fail'],
            [0,   2, '✗ Will not run'],
        ]
        : MODEL_SIZE_TIER === 'medium' 
        ? [
            [8, 35, '✓ Excellent'],
            [5, 26, '✓ Comfortable'],
            [3, 12, '⚠ Tight. May run out of memory'],
            [0,  2, '✗ Very likely to fail'],
        ]
        : [
            [6, 35, '✓ Excellent'],
            [3, 26, '✓ Comfortable'],
            [2, 14, '⚠ Minimum viable. Close other apps'],
            [0,  3, '✗ Very likely to fail'],
        ];
        for (const [min, pts, label] of tiers) {
            if (detectedVram >= min) { score += pts; rows.push(`VRAM verdict: ${label}`); break; }
        }

        // bonus for high-VRAM discrete GPUs
        if (info.gpu_vendor === 'nvidia' || info.gpu_vendor === 'amd') {
            if      (detectedVram >= 16) { score += 10; rows.push('GPU tier: ✓ High-end discrete'); }
            else if (detectedVram >= 8)  { score += 6;  rows.push('GPU tier: ✓ Mid-range discrete'); }
            else                         { score += 3;  rows.push('GPU tier: ⚠ Entry-level discrete'); }
        }
        if (info.gpu_vendor === 'apple' && detectedVram >= 8) score += 8;
    } else {
        score += 10; // neutral when unknown
    }

    // 6. system RAM ─────────────────────────────────────────────────

    const ramGb = info.system_ram_mb / 1024;
    rows.push(`System RAM: ${ramGb.toFixed(1)} GB`);

    if (info.is_unified_memory || info.gpu_vendor === 'intel') {
        rows.push(`  Note: ${info.is_unified_memory ? 'Apple Silicon' : 'Intel integrated GPU'} shares system RAM with VRAM`);
        if      (ramGb >= 24) score += 20;
        else if (ramGb >= 16) score += 16;
        else if (ramGb >= 8)  score += 13;
        else if (ramGb >= 4)  score +=  6;
    } else {
        if      (ramGb >= 16) score += 20;
        else if (ramGb >= 8)  score += 13;
        else if (ramGb >= 4)  score += 6;
    }

    // 7. CPU threads ────────────────────────────────────────────────

    rows.push(`CPU threads: ${info.cpu_threads}`);
    if      (info.cpu_threads >= 8)  score += 10;
    else if (info.cpu_threads >= 4)  score +=  6;
    else                             score +=  2;

    // 8. backend bonus ──────────────────────────────────────────────
    // Metal and CUDA are the fastest backends. Vulkan is universal but
    // slightly slower on average.

    if (info.acceleration_backend === 'metal') {
        score += 10;
        rows.push('Backend: ✓ Metal');
    } else if (info.acceleration_backend === 'cuda') {
        score += 8;
        rows.push('Backend: ✓ CUDA');
    } else if (info.acceleration_backend === 'vulkan') {
        score += 5;
        rows.push('Backend: ✓ Vulkan');
    }

    // 9. verdict ────────────────────────────────────────────────────

    let verdictText, verdictColor, expectedTps;

    if (score >= 80) {
        verdictText  = '✓ Excellent. Expect 15–40 tok/s';
        verdictColor = 'var(--color-success)';
        expectedTps  = '15–40';
    } else if (score >= 55) {
        verdictText  = '✓ Good. Expect 6–15 tok/s';
        verdictColor = 'var(--color-success)';
        expectedTps  = '6–15';
    } else if (score >= 35) {
        verdictText  = '⚠ Moderate. Expect 2–6 tok/s';
        verdictColor = 'var(--color-warning)';
        expectedTps  = '2–6';
    } else {
        verdictText  = '✗ Low-end hardware. Expect <2 tok/s or failure';
        verdictColor = 'var(--color-danger)';
        expectedTps  = '<2';
    }

    rowsEl.innerHTML      = rows.map(r => `<div>${r}</div>`).join('');
    verdictEl.textContent = `${verdictText} (score: ${score})`;
    verdictEl.style.color = verdictColor;

    btn.disabled    = false;
    btn.textContent = 'Run again';
    showToast(`Check complete. Expected ${expectedTps} tok/s`, 'info', 4000);
}

// helpers ───────────────────────────────────────────────────────────

function _vendorLabel(vendor) {
    return vendor === 'nvidia' ? 'NVIDIA (discrete)'
         : vendor === 'amd'   ? 'AMD (discrete)'
         : vendor === 'apple' ? 'Apple Silicon (unified memory)'
         : vendor === 'intel' ? 'Intel (integrated)'
         : 'Unknown';
}

function _backendLabel(backend) {
    return backend === 'metal'  ? 'Metal ✓'
         : backend === 'cuda'   ? 'CUDA ✓'
         : backend === 'vulkan' ? 'Vulkan ✓'
         : 'None';
}