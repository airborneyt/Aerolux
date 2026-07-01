<!-- src/components/modals/previews/VelocityPreviewCard.svelte -->
<!--
    self-contained illustrated preview of Velocity.
    uses fake, hardcoded gradient data
-->
<script>
import { toHex } from '../../../lib/aerolux/palette.js';
import { buildGradient } from '../../../lib/aerolux/gradient.js';
import { DEFAULT_PALETTE } from '../../../lib/aerolux/palette.js';

const fakePalette = DEFAULT_PALETTE.map((c, i) => ({ i, r: c[0], g: c[1], b: c[2] }));

const fakeStops = [
    { id: 0, pos: 0.00, ci: 1 },
    { id: 1, pos: 0.25, ci: 16 },
    { id: 2, pos: 0.50, ci: 64 },
    { id: 3, pos: 0.75, ci: 57 },
    { id: 4, pos: 1.00, ci: 51  },
];

const fakeResult = buildGradient(
    fakeStops, fakePalette, 'vivid', 'linear', 10,
    { ci: null, str: 0, fade: null },
    { shape: null, attack: 0, release: 0, floor: 0 },
    true, 0, 'shortest',
);

const barSegments = fakeResult.map(({ velocity }) => {
    const c = fakePalette[velocity] ?? fakePalette[0];
    return toHex(c.r, c.g, c.b);
});

const stopColours = fakeStops.map(s => {
    const c = fakePalette[s.ci];
    return toHex(c.r, c.g, c.b);
});
</script>

<div class="vpc-wrap">
    <!-- large gradient bar with overlaid stop markers -->
    <div class="vpc-bar-wrap">
        <div class="vpc-bar">
            {#each barSegments as col}
                <div style="background:{col}"></div>
            {/each}
        </div>
        <div class="vpc-stops">
            {#each fakeStops as stop, i}
                <div class="vpc-stop" style="left:{stop.pos * 100}%; --sc:{stopColours[i]}"></div>
            {/each}
        </div>
    </div>

    <!-- slim palette texture strip -->
    <div class="vpc-palette">
        {#each fakePalette.slice(8, 8 + 48) as c}
            <div style="background:{toHex(c.r, c.g, c.b)}"></div>
        {/each}
    </div>
</div>

<style>
.vpc-wrap {
    display:        flex;
    flex-direction: column;
    gap:            8px;
    padding:        14px;
    width:          100%;
}

.vpc-bar-wrap {
    position: relative;
    width:    100%;
}

.vpc-bar {
    height:        46px;
    width:         100%;
    display:       flex;
    border-radius: var(--radius-sm);
    overflow:      hidden;
    box-shadow:    inset 0 0 0 1px rgba(255,255,255,0.08), var(--shadow-card);
}
.vpc-bar > div { flex: 1; }

.vpc-stops {
    position: absolute;
    top:      -5px;
    left:     0;
    right:    0;
    height:   10px;
    pointer-events: none;
}
.vpc-stop {
    position:      absolute;
    top:           0;
    width:         9px;
    height:        9px;
    border-radius: 2px;
    background:    var(--sc);
    border:        1.5px solid rgba(255,255,255,0.55);
    transform:     translateX(-50%) rotate(45deg);
    box-shadow:    0 1px 4px rgba(0,0,0,0.45);
}

.vpc-palette {
    display:               grid;
    grid-template-columns: repeat(24, 1fr);
    gap:                   1.5px;
    width:                 100%;
}
.vpc-palette > div {
    aspect-ratio:  1;
    border-radius: 1px;
    opacity:       0.85;
}
</style>