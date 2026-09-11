// src/lib/aerolux/menu.js
/**
    this is the all-in one place for handling native menu events
    across both editors; including undo/redo and export for both

    this also listens for stuff like file -> new/open/save/save as
    and app-exit-requested events from rust

    if there are unsaved changes, it will route them into projects.svelte.js
    and trigger the "unsaved changes?" confirmation flow

    this file will first deal with the unsaved changes flow, then move
    on to building the menu
*/

import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { exit } from '@tauri-apps/plugin-process';
import { openUrl } from '@tauri-apps/plugin-opener';
import { navigate } from '../../stores/router.svelte';
import { newProject, openProject, projects, saveProject, saveProjectAs } from '../../stores/projects.svelte';
import { router } from '../../stores/router.svelte';
import { markCleanExit } from './crash-recovery.svelte';
import { undoKinetic, redoKinetic } from '../../stores/kinetic.svelte';
import { undo, redo } from '../../stores/velocityActions.svelte';
import { updater, checkForUpdate, installUpdate, newUpdate, askToUpdate, resolveNewUpdate } from '../../stores/updater.svelte.js';
import { showToast } from './toast';

// unsaved changes modal state ––––––––––––––––––––––––––––––––––––––
// this is a single shared piece of state that any component can read
// to render the confimation model.

export const unsavedPrompt = $state({
    open: false,
    pending: null, // 'new' | 'open' | 'exit' | null
});

let resolvePrompt = null;

/**  
    this shows the unsaved changes modal and resolves once the user
    picks one of the functions available
*/
function askToSave(trigger) {
    return new Promise(resolve => {
        unsavedPrompt.pending = trigger;
        unsavedPrompt.open    = true;
        resolvePrompt = resolve;
    });
}

/**
    this is called by the modal's three buttons
*/
export function resolveUnsavedPrompt(choice) {
    unsavedPrompt.open    = false;
    unsavedPrompt.pending = null;
    resolvePrompt?.(choice);
    resolvePrompt = null;
}

/**
    this checks whether a project is dirty or not before any action that 
    would discard the current project (new project, opening another, 
    quitting).
*/
async function guardUnsavedChanges(trigger) {
    if (!projects.isDirty) return 'discard';

    const choice = await askToSave(trigger);
    if (choice === 'save') {
        const ok = await saveProject();
        return ok ? 'discard' : 'cancel';
    }
    return choice;
}

export async function startNewProject(type = 'velocity') {
    const result = await guardUnsavedChanges('new');
    if (result === 'cancel') return false;
    newProject(type);
    navigate(type === 'kinetic' ? 'kinetic' : 'velocity');
    return true;
}

export async function openNewProjectPicker() {
    const result = await guardUnsavedChanges('new');
    if (result === 'cancel') return false;
    navigate('home', 'newProject');
    return true;
}

// global undo/redo –––––––––––––––––––––––––––––––––––––––––––––––––

function chooseUndo() {
    if (router.page === 'velocity') {
        undo();
    } else if (router.page === 'kinetic') {
        undoKinetic();
    }
}

function chooseRedo() {
    if (router.page === 'velocity') {
        redo();
    } else if (router.page === 'kinetic') {
        redoKinetic();
    }
}

// sidebar toggle –––––––––––––––––––––––––––––––––––––––––––––––––––

export const sidebar = $state({
    sidebarVisible: true
});

export function toggleSidebar() {
    sidebar.sidebarVisible = !sidebar.sidebarVisible;
}

export function showSidebar() {
    sidebar.sidebarVisible = true;
}

export function hideSidebar() {
    sidebar.sidebarVisible = false;
}

// menu handler –––––––––––––––––––––––––––––––––––––––––––––––––––––

let appMenu = null;

let menuItems = {
    save: saveProject,
    saveAs: saveProjectAs,
    undo: chooseUndo,
    redo: chooseRedo,
    export: null,
};

// This is the editor that currently owns keyboard/menu operations.
let activeEditor = null;

// These should be replaced with your real editor operations.
let commands = {
    newProject,
    openProject,

    save: saveProject,
    saveAs: saveProjectAs,

    velocityUndo: undo,
    velocityRedo: redo,

    kineticUndo: undoKinetic,
    kineticRedo: redoKinetic,

    openHome: () => navigate('home'),
    openVelocity: () => navigate('velocity'),
    openKinetic: () => navigate('kinetic'),
    openSettings: () => navigate('settings'),
};

async function createAeroluxMenu() {
    return await Submenu.new({
        text: 'Aerolux',
        items: [
            await MenuItem.new({
                id: 'airborne', text: 'Aerolux By Airborne',
            }),
            { item: 'Separator' },
            await MenuItem.new({
                id: 'home', text: 'Home', accelerator: 'CmdOrCtrl+1',
                action: () => {
                    commands.openHome?.();
                },
            }),
            await MenuItem.new({
                id: 'velocity', text: 'Velocity', accelerator: 'CmdOrCtrl+2',
                action: () => {
                    commands.openVelocity?.();
                },
            }),
            await MenuItem.new({
                id: 'kinetic', text: 'Kinetic', accelerator: 'CmdOrCtrl+3',
                action: () => {
                    commands.openKinetic?.();
                },
            }),
            await MenuItem.new({
                id: 'preferences', text: 'Settings…', accelerator: 'CmdOrCtrl+,',
                action: () => {
                    commands.openSettings?.();
                },
            }),
            { item: 'Separator' },
            await PredefinedMenuItem.new({
                item: 'Services',
            }),
            { item: 'Separator' },
            await PredefinedMenuItem.new({
                item: 'Hide',
            }),
            await PredefinedMenuItem.new({
                item: 'HideOthers',
            }),
            await PredefinedMenuItem.new({
                item: 'ShowAll',
            }),
            { item: 'Separator' },
            await MenuItem.new({
                id: 'quit', text: 'Quit Aerolux', accelerator: 'CmdOrCtrl+Q',
                action: async () => {
                    const result = await guardUnsavedChanges('exit');
                    if (result === 'cancel') return;
                    await markCleanExit();
                    await invoke('confirm_quit');
                    await exit(0);
                },
            }),
        ],
    });
}

async function createFileMenu() {
    return await Submenu.new({
        text: 'File',
        items: [
            await MenuItem.new({
                id: 'new-project', text: 'New Project', accelerator: 'CmdOrCtrl+N',
                action: async () => {
                    await openNewProjectPicker();
                }
            }),
            await MenuItem.new({
                id: 'open-project', text: 'Open Project...', accelerator: 'CmdOrCtrl+O',
                action: () => {
                    commands.openProject?.();
                }
            }),
            { item: 'Separator' },
            await MenuItem.new({
                id: 'save', text: 'Save Project...', accelerator: 'CmdOrCtrl+S',
                action: () => {
                    commands.save?.();
                }
            }),
            await MenuItem.new({
                id: 'save-as', text: 'Save Project As...', accelerator: 'CmdOrCtrl+Shift+S',
                action: () => {
                    commands.saveAs?.();
                }
            }),
            { item: 'Separator' },

            await PredefinedMenuItem.new({
                item: 'CloseWindow',
                text: 'Close Window',
            }),
        ],
    });
}

async function createEditMenu() {
    return await Submenu.new({
        text: 'Edit',

        items: [
            // await MenuItem.new({
            //     id: 'undo',
            //     text: 'Undo',
            //     accelerator: 'CmdOrCtrl+Z',
            //     enabled: false,
            //     action: () => {
            //         chooseUndo()
            //     }
            // }),
            // await MenuItem.new({
            //     id: 'redo',
            //     text: 'Redo',
            //     accelerator: 'CmdOrCtrl+Shift+Z',
            //     enabled: false,
            //     action: () =>
            //         chooseRedo()
            // }),

            // { item: 'Separator' },

            // ADD FUNCTIONALITY ^^

            await PredefinedMenuItem.new({ item: 'Cut' }),
            await PredefinedMenuItem.new({ item: 'Copy' }),
            await PredefinedMenuItem.new({ item: 'Paste' }),
            await PredefinedMenuItem.new({ item: 'SelectAll' }),
        ],
    });
}

let checkingManually = false;
async function handleManualCheck() {
    checkingManually = true;
    const found = await checkForUpdate({ promptIfNew: false });
    checkingManually = false;
    showToast(found ? `Update ${updater.version} available` : "You're up to date", found ? 'info' : 'success', 3000);
}

export async function createAppMenu() {
    if (appMenu) {
        return appMenu;
    }

    const aeroluxMenu = await createAeroluxMenu();
    const fileMenu = await createFileMenu();
    const editMenu = await createEditMenu();
    const viewMenu = await Submenu.new({
        text: 'View',
        items: [
            await MenuItem.new({
                id: 'toggle-sidebar',
                text: 'Toggle Sidebar',
                accelerator: 'Alt+S',
                action: () => {
                    toggleSidebar();
                },
            }),
            await PredefinedMenuItem.new({
                item: 'Fullscreen',
            }),
        ],
    });
    const windowMenu = await Submenu.new({
        text: 'Window',
        items: [
            await PredefinedMenuItem.new({
                item: 'Minimize',
            }),
            await PredefinedMenuItem.new({
                item: 'Maximize',
            }),
            { item: 'Separator' },
            await PredefinedMenuItem.new({
                item: 'CloseWindow',
            }),
        ],
    });
    const helpMenu = await Submenu.new({
        text: 'Help',
        items: [
            await MenuItem.new({
                id: 'documentation',
                text: 'Aerolux Website',

                action: async () => {
                    await openUrl(
                        'https://airborneyt.vercel.app/aerolux'
                    );
                },
            }),
            await MenuItem.new({
                id: 'discord',
                text: 'Airborne\'s Discord',

                action: async () => {
                    await openUrl(
                        'https://discord.gg/PfktWrR'
                    );
                },
            }),
            await MenuItem.new({
                id: 'feedback',
                text: 'secret menu (super top secret)',

                action: async () => {
                    showToast('🫪', 'info', 6000);
                    await openUrl(
                        'https://airborneyt.neocities.org/troll'
                    );
                },
            }),
            { item: 'Separator' },
            await MenuItem.new({
                id: 'check-updates',
                text: 'Check for Updates…',
                action: async () => {
                    handleManualCheck();
                },
            }),
        ],
    });

    appMenu = await Menu.new({
        items: [
            aeroluxMenu,
            fileMenu,
            editMenu,
            viewMenu,
            windowMenu,
            helpMenu,
        ],
    });

    await appMenu.setAsAppMenu();

    await windowMenu.setAsWindowsMenuForNSApp();
    await helpMenu.setAsHelpMenuForNSApp();

    return appMenu;
}
