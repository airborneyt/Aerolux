// src/stores/updater.svelte.js
// update availability checker, version history, download manager

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { settings, saveSetting } from './settings.svelte.js';
import { showToast } from '../lib/aerolux/toast.js';

export const updater = $state({
    checking:     false,
    downloading:  false,
    progress:     0,
    available:    false,
    version:      null,
    currentVersion: null,
    notes:        null,
    error:        null,
    update:       null,
    modalOpen:    false,
});

// check for update
// yes -> open modal / show button in settings
export async function checkForUpdate({ promptIfNew = false } = {}) {
    updater.checking = true;
    updater.error = null;
    try {
        const result = await check();
        updater.update = result ?? null;

        if (result) {
            updater.available = true;
            updater.version = result.version;
            updater.currentVersion = result.currentVersion;
            updater.notes = result.body ?? null;

            const skipped = settings.updates?.skippedVersion ?? null;
            if (promptIfNew && result.version !== skipped) {
                updater.modalOpen = true;
            }
        } else {
            updater.available = false;
            updater.version = null;
            updater.notes = null;
        }
    } catch (err) {
        updater.error = err?.message ?? String(err);
        updater.available = false;
    } finally {
        updater.checking = false;
    }
    return updater.available;
}

// download, install and relaunch
export async function installUpdate() {
    if (!updater.update) return false;
    updater.downloading = true;
    updater.progress = 0;
    updater.error = null;
    try {
        let downloaded = 0;
        let contentLength = 0;
        await updater.update.downloadAndInstall((event) => {
            switch (event.event) {
                case 'Started':
                    contentLength = event.data.contentLength ?? 0;
                    break;
                case 'Progress':
                    downloaded += event.data.chunkLength ?? 0;
                    updater.progress = contentLength
                        ? Math.min(100, Math.round((downloaded / contentLength) * 100))
                        : updater.progress;
                    break;
                case 'Finished':
                    updater.progress = 100;
                    break;
            }
        });
        updater.modalOpen = false;
        await relaunch();
        return true;
    } catch (err) {
        updater.error = err?.message ?? String(err);
        showToast(`Update failed: ${updater.error}`, 'error', 6000);
        return false;
    } finally {
        updater.downloading = false;
    }
}

// skip and persist skipped version in settings
export async function skipUpdate() {
    if (updater.version) {
        await saveSetting('updates.skippedVersion', updater.version);
    }
    updater.modalOpen = false;
}

// remind me later = close modal
export function remindLater() {
    updater.modalOpen = false;
}

export function closeUpdateModal() {
    updater.modalOpen = false;
}

// ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

export const newUpdate = $state({
    open: false,
    update: null,
    choice: null,
    skippedVersion: null
});
let resolveUpdate = null;

export function askToUpdate(update) {
    return new Promise(resolve => {
        newUpdate.update = update;
        newUpdate.open = true;
        resolveUpdate = resolve;
    });
}

export async function resolveNewUpdate(choice) {
    const update = newUpdate.update;
    newUpdate.open = false;
    newUpdate.choice = choice;
    resolveUpdate?.(choice);
    resolveUpdate = null;
    if (choice === 'update') {
        await installUpdate();
    }
    if (choice === 'skip') {
        // persist skipped version.
    }
    newUpdate.update = null;
}