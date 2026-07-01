<!-- src/components/velocity/AlgorithmPanel.svelte -->
<!--
    algorithm panel
    controls the active algorithm within velocity
-->

<script>
import { editor } from '../../stores/velocity.svelte.js';

const algos = [
    { value: 'rgb', label: 'RGB nearest' },
    { value: 'lab', label: 'Perceptual' },
    { value: 'hsl', label: 'HSL path' },
    { value: 'stepped', label: 'Stepped' },
    { value: 'vivid', label: 'Vivid' },
];

const hslDirs = [
    { value: 'shortest', label: 'Shortest' },
    { value: 'longest', label: 'Longest' }
];
</script>

<div class="al-card al-settings-card">
    <p class="al-label">Algorithm</p>

    <div class="al-pill-group">
        {#each algos as algo}
            <button
                class="al-pill"
                class:active={editor.algorithm === algo.value}
                onclick={() => editor.algorithm = algo.value}
            >{algo.label}</button>
        {/each}
    </div>

    {#if editor.algorithm === 'hsl'}
        <div style="margin-top:10px">
            <p class="al-label">HSL direction</p>
            <div class="al-pill-group">
                {#each hslDirs as dir}
                    <button
                        class="al-pill"
                        class:active={editor.hslDir === dir.value}
                        onclick={() => editor.hslDir = dir.value}
                    >{dir.label}</button>
                {/each}
            </div>
        </div>
    {/if}
</div>