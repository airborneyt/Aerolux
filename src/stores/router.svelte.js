// src/stores/router.svelte.js
// 'home' | 'velocity' | 'kinetic' | 'settings'

export const router = $state({
    page:   'home',
    intent: null,
    subPath: null,
});

// navigate to a page
// intent is 'do something upon arrival'
export function navigate(page, intent = null, subPath = null) {
    router.page    = page;
    router.intent  = intent;
    router.subPath = subPath;
}

export function clearIntent() {
    router.intent = null;
}

// convenence for deep-linking straight to a settings menu
export function navigateToSettings(path = null) {
    navigate('settings', null, path);
}