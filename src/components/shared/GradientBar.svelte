<script>
import { toHex } from '../../lib/aerolux/palette.js';
let { gradResult, palette, height = '28px' } = $props();
</script>

<div class="grad-bar" style="height:{height}">
    {#each gradResult as { velocity }}
        {@const c = palette[velocity] ?? palette[0]}
        <div style="background:{toHex(c.r, c.g, c.b)}"></div>
    {/each}
</div>

<style>
.grad-bar {
    display: flex;
    width: 100%;
    border-radius: 4px;
    overflow: hidden;
}
.grad-bar > div { flex: 1; }
</style>