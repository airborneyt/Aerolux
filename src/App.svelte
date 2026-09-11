<!-- src/App.svelte -->
<script>
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setDiscordContext } from './lib/aerolux/discord.js';
import { onMount } from 'svelte';
import { audio } from './lib/aerolux/audio';
import { sidebar } from './lib/aerolux/menu.svelte.js';
import { router, navigate } from './stores/router.svelte.js';
import ThemeProvider from './components/shared/ThemeProvider.svelte';
import UnsavedChangesModal from './components/modals/UnsavedChangesModal.svelte';
import RecoveryModal from './components/modals/RecoveryModal.svelte';
import UpdateModal from './components/modals/UpdateModal.svelte';

import HomePage     from './components/pages/HomePage.svelte';
import VelocityPage from './components/pages/VelocityPage.svelte';
import KineticPage  from './components/pages/KineticPage.svelte';
import SettingsPage from './components/pages/SettingsPage.svelte';

import { createAppMenu } from './lib/aerolux/menu.svelte.js';

$effect(() => {
    const page = router.page;
    const context = page === 'velocity' || page === 'kinetic' || page === 'settings' ? page : 'home';
    setDiscordContext(context);
});

// sidebar ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

const navItems = [
    { page: 'home',     icon: '⌂', label: 'Home'     },
    { page: 'velocity', icon: '◈', label: 'Velocity'  },
    { page: 'kinetic',  icon: '⟁', label: 'Kinetic'   },
];

onMount(async () => {
    setDiscordContext(router.page === 'velocity' || router.page === 'kinetic' || router.page === 'settings' ? router.page : 'home');
    audio.sfx.play('aerolux');
    await createAppMenu();
});

</script>

<ThemeProvider />

<div id="aerolux">

<div class="al-app-shell" class:sidebar-hidden={!sidebar.sidebarVisible}>

    <!-- sidebar -->
    <aside class="al-sidebar">
        <div style="height: 36px; width: 36px; padding-bottom:8px;" title="😳">
            <svg width="100%" height="100%" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;">
                <g transform="matrix(0.799607,-0.799607,0.799607,0.799607,-50.123567,407.661071)">
                    <path d="M606.413,96.587C623.91,114.083 501,203.095 501,352C501,379.596 478.596,402 451,402L351,402L301,352L301,252C301,224.404 323.404,202 351,202C499.905,202 588.917,79.09 606.413,96.587Z" style="fill:var(--color-text);"/>
                </g>
                <g transform="matrix(-0.799607,0.799607,-0.799607,-0.799607,1074.123567,616.338929)">
                    <path d="M606.413,96.587C623.91,114.083 501,203.095 501,352C501,379.596 478.596,402 451,402L351,402L301,352L301,252C301,224.404 323.404,202 351,202C499.905,202 588.917,79.09 606.413,96.587Z" style="fill:var(--color-text);"/>
                </g>
                <g transform="matrix(0.799607,0.799607,-0.799607,0.799607,616.338929,-50.123567)">
                    <path d="M606.413,96.587C623.91,114.083 501,203.095 501,352C501,379.596 478.596,402 451,402L351,402L301,352L301,252C301,224.404 323.404,202 351,202C499.905,202 588.917,79.09 606.413,96.587Z" style="fill:var(--color-text);"/>
                </g>
                <g transform="matrix(-0.799607,-0.799607,0.799607,-0.799607,407.661071,1074.123567)">
                    <path d="M606.413,96.587C623.91,114.083 501,203.095 501,352C501,379.596 478.596,402 451,402L351,402L301,352L301,252C301,224.404 323.404,202 351,202C499.905,202 588.917,79.09 606.413,96.587Z" style="fill:var(--color-text);"/>
                </g>
            </svg>
        </div>

        {#each navItems as item}
            <button
                class="al-sidebar-icon {router.page === item.page ? 'active' : ''}"
                onclick={() => navigate(item.page)}
                title={item.label}
            >{item.icon}</button>
        {/each}

        <div class="al-sidebar-spacer"></div>

        <button
            class="al-sidebar-icon {router.page === 'settings' ? 'active' : ''}"
            onclick={() => navigate('settings')}
            title="Settings"
        >⚙</button>

    </aside>

    <main class="al-content">
    {#if router.page === 'home'}
        <HomePage
            onNewProject={() => navigate('velocity')}
            onOpenProject={() => {}}
            onOpenRecent={() => navigate('velocity')}
        />
    {:else if router.page === 'velocity'}
        <VelocityPage />
    {:else if router.page === 'kinetic'}
        <KineticPage />
    {:else if router.page === 'settings'}
        <SettingsPage />
    {/if}

    <UnsavedChangesModal />
    <RecoveryModal />
    <UpdateModal />
</main>

</div>

<div id="al-toasts"></div>

</div>
