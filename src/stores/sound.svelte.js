import { settings, saveSetting } from './settings.svelte';

export function getMasterVolume() {
    return settings.sound.master ?? 1.0;
}

export async function setMasterVol(v) {
    const value = Math.max(0, Math.min(1, v));
    await saveSetting('sound.master', value);
}

export function getUiVolume() {
    return settings.sound.ui ?? 1.0;
}

export async function setUiVol(v) {
    const value = Math.max(0, Math.min(1, v));
    await saveSetting('sound.ui', value);
}

export function getOstVolume() {
    return settings.sound.ost ?? 0.5;
}

export async function setOstVol(v) {
    const value = Math.max(0, Math.min(1, v));
    await saveSetting('sound.ost', value);
}