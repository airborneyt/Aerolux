// src/stores/motion.svelte.js
// todo: remove gpu tier thing
import { settings, saveSetting } from './settings.svelte.js';

// apply DOM classes based on settings (single source of truth)
export function applyMotion() {
    document.body.classList.remove(
        'motion-full',
        'motion-reduced',
        'motion-none'
    );

    document.body.classList.add(settings.motion.tier);
}

// detect preferred motion + optional GPU tier hint
export async function detectMotion(gpuTier = null) {
    const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let tier;

    if (reduced) {
        tier = 'motion-none';
    } else if (gpuTier === 'high') {
        tier = 'motion-full';
    } else {
        tier = 'motion-reduced';
    }

    await saveSetting('motion.tier', tier);
    applyMotion();
}

// explicit setter (replaces old direct state mutation)
export async function setMotionTier(tier) {
    await saveSetting('motion.tier', tier);
    applyMotion();
}