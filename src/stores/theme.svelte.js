import { settings, saveSetting } from './settings.svelte.js';

// resolved theme string ('dark' or 'light'). never 'system'
export function getResolvedMode() {
    if (settings.theme.mode !== 'system') return settings.theme.mode;

    if (typeof window === 'undefined') return 'dark';

    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

// resolved hue
export function getResolvedAccentH() {
    if (settings.theme.accentH !== null) return settings.theme.accentH;
    return getResolvedMode() === 'dark' ? 42 : 210;
}

export function applyTheme() {
    document.body.classList.remove('dark', 'light');

    if (settings.theme.mode !== 'system') {
        document.body.classList.add(settings.theme.mode);
    }

    document.documentElement.style.setProperty(
        '--accent-h',
        String(getResolvedAccentH())
    );
}

export async function loadTheme() {
    applyTheme();
}

export async function setMode(mode) {
    await saveSetting('theme.mode', mode);
    applyTheme();
}

export async function setAccentH(h) {
    const value = Math.round(h);
    await saveSetting('theme.accentH', value);

    document.documentElement.style.setProperty('--accent-h', String(value));
}

export async function resetAccent() {
    await saveSetting('theme.accentH', null);

    document.documentElement.style.setProperty(
        '--accent-h',
        String(getResolvedAccentH())
    );
}