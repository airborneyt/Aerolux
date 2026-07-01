// src/stores/router.svelte.js
// 'home' | 'velocity' | 'kinetic' | 'settings'

export const router = $state({
    page:   'home',
    intent: null,
    // future: sub-page within kinetic e.g. 'kinetic/timeline'
});

/**
 * navigates to a page. the optional `intent` param lets a caller tell
 * the destination page to do something on arrival. e.g. the menu
 * bridge sends { intent: 'newProject' } so HomePage knows to open the
 * new-project modal immediately rather than just landing idle.
 *
 * `intent` is consumed once: HomePage (or whichever page reads it)
 * should call clearIntent() after acting on it, so navigating away
 * and back doesn't replay a stale intent.
 */
export function navigate(page, intent = null) {
    router.page   = page;
    router.intent = intent;
}

export function clearIntent() {
    router.intent = null;
}