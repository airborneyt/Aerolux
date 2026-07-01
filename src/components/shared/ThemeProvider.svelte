<!-- src/components/shared/ThemeProvider.svelte -->
<script>
import { onMount } from 'svelte';
import { getResolvedMode, loadTheme, applyTheme } from '../../stores/theme.svelte.js';
import { settings } from '../../stores/settings.svelte.js';
import { detectMotion } from '../../stores/motion.svelte.js';

onMount(async () => {
    // listen for OS theme change while app is open
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (settings.theme.mode === 'system') applyTheme(); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
});

// keep DOM in sync reactively whenever theme state changes
$effect(() => {
    const _deps = [settings.theme.mode, settings.theme.accentH];
    applyTheme();
});
</script>