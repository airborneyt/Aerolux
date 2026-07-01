<script>
import { onMount } from 'svelte';
import NewProjectModal from '../modals/NewProjectModal.svelte';
import RecentProjectsList from '../home/RecentProjectsList.svelte';
import { router, clearIntent } from '../../stores/router.svelte.js';
import { openProject, loadRecentProject } from '../../stores/projects.svelte.js';

let { onNewProject, onOpenProject, onOpenRecent } = $props();
let newProjectModalOpen = $state(false);

const tips = [
    'Velocity: You can hold Shift while dragging a stop to snap it to the nearest 5%.',
    'Velocity: The HSL algorithm on "longest" direction can produce full rainbow gradients with just two stops.',
    'Velocity: You can press R to randomise your gradient instantly.',
    'Velocity: You can export your gradient then inject it into a MIDI file without losing any timing data.',
    'Velocity: The LAB algorithm (Perceptual) is the most colour-accurate. Try it on gradients with large hue jumps!',
    'Velocity: You can drag a .txt gradient file directly onto the import zone.',
    'Velocity: The Python batch script can generate multiple variations in one run.',
    'Velocity: Tint with white at 30–40% strength turns any deep colour into its pastel equivalent.',
    'Velocity: The Bell envelope brightens the middle of the gradient. Great for a glowing effect.',
    'Aerolux was initially made to quickly make a new gradient pack for the airborneyt palette.',
    'Kinetic was designed way before Velocity. Back in 2025! It started as a JUCE project.',
    'Airbot works entirely on-device. Nothing you generate ever leaves your machine.',    
    'Hold Alt/Option to access more information or settings. Try it out here!',
];
const tip = tips[Math.floor(Math.random() * tips.length)];

const eggs = [
    '"Out of all the numbers from 0 to 50... I got a score of 13."',
    'Lightshows bro, lightshows!',
    'choqam olkowk... impressed... 🫪',
    'this is FIRE!!! extinguish it!!!',
    'on the lights, sure, on the song HELL NO.',
    'The world hasn\'t ended yet.',
    'Never stop making great stuff.',
    'Brought to you by TheRealAirborneOfficial',
]
const egg = eggs[Math.floor(Math.random() * eggs.length)];

const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
let konamiIndex = 0;
let showEgg = $state(false);

onMount(() => {
    const handler = (e) => {
        if (e.key === KONAMI[konamiIndex]) {
            konamiIndex++;
            if (konamiIndex === KONAMI.length) {
                showEgg = true;
                konamiIndex = 0;
                setTimeout(() => showEgg = false, 4000);
            }
        } else {
            konamiIndex = 0;
        }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
});

$effect(() => {
    if (router.intent === 'newProject') {
        newProjectModalOpen = true;
        clearIntent();
    } else if (router.intent === 'openProject') {
        openProject();
        clearIntent();
    }
});

async function handleOpenRecent(recent) {
    // navigation to the correct editor now happens inside
    // loadProjectFromPath (projects.svelte.js) itself, so both this
    // and file → open from the native menu behave identically.
    await loadRecentProject(recent.path);
}
</script>

<div class="al-home">

    <!-- header -->
    <div class="al-home-header">
        <div class="al-home-logo">
            Aero<span style="color:var(--color-accent)">lux</span>
        </div>
        <p class="al-home-tagline">Launchpad Light Effect Design Suite</p>
    </div>

    <!-- easter egg -->
    {#if showEgg}
        <div class="al-tip-card" style="border-color:var(--color-success-border);background:var(--color-success-subtle);margin-bottom:var(--space-4);animation:al-slide-up 0.3s ease both">
            <img src="/airborneyt.svg" alt="Made by Airborne" width="25" height="25" />
            <span class="al-tip-label" style="color:var(--color-success)">
                {egg}
            </span>
        </div>
    {/if}

    <!-- tip -->
    <div class="al-tip-card">
        <span class="al-tip-icon">💡</span>
        <p><span class="al-tip-label">Did you know? </span>{tip}</p>
    </div>

    <!-- primary actions -->
    <div class="al-home-actions">
        <div class="al-home-card al-home-card-primary" onclick={() => {newProjectModalOpen = true}}>
            <span class="al-home-card-icon">✦</span>
            <div class="al-home-card-title">New project</div>
            <p class="al-home-card-desc">
                Start from a blank canvas.
            </p>
        </div>

        <div class="al-home-card" onclick={openProject}>
            <span class="al-home-card-icon">📂</span>
            <div class="al-home-card-title">Open project</div>
            <p class="al-home-card-desc">
                Load an existing .alx project file from your filesystem.
            </p>
        </div>
    </div>

    <!-- recently opened -->
    <p class="al-home-section-title">Recently opened</p>
    <RecentProjectsList onOpenRecent={handleOpenRecent} />

    <!-- version stamp -->
    <p class="al-dim" style="text-align:center;padding-top:var(--space-4)">
        Aerolux 2.0.0-alpha.1 · by Airborne
    </p>

    <NewProjectModal bind:open={newProjectModalOpen} />

</div>