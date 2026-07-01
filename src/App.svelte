<!-- src/App.svelte -->
<script>
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { onMount } from 'svelte';
import { router, navigate } from './stores/router.svelte.js';
import ThemeProvider from './components/shared/ThemeProvider.svelte';
import UnsavedChangesModal from './components/modals/UnsavedChangesModal.svelte';
import RecoveryModal from './components/modals/RecoveryModal.svelte';

import HomePage     from './components/pages/HomePage.svelte';
import VelocityPage from './components/pages/VelocityPage.svelte';
import KineticPage  from './components/pages/KineticPage.svelte';
import SettingsPage from './components/pages/SettingsPage.svelte';

const navItems = [
    { page: 'home',     icon: '⌂', label: 'Home'     },
    { page: 'velocity', icon: '◈', label: 'Velocity'  },
    { page: 'kinetic',  icon: '⟁', label: 'Kinetic'   },
];
</script>

<ThemeProvider />

<div id="aerolux">

<div class="al-app-shell">

    <!-- sidebar -->
    <aside class="al-sidebar">
        <div class="al-sidebar-logo">
            <img src="/airborneyt.svg" alt="Made by Airborne" width="26" height="26" />
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
</main>

</div>

<div id="al-toasts"></div>

</div>