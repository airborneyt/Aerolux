<!-- src/components/modals/previews/KineticPreviewCard.svelte -->
<!--
    self-contained illustrated preview of Kinetic.
    a few static placeholder nodes connected by wires
    keep colours and nodes accurate to what actually exists
-->
<script>
const nodes = [
    { id: 'a', x: 20,  y: 50,  label: 'Spline',  color: 'hsl(270,65%,60%)' },
    { id: 'b', x: 110, y: 30,  label: 'Hue',  color: 'hsl(38,80%,58%)' },
    { id: 'c', x: 110, y: 75,  label: 'Rotate',  color: 'hsl(210,70%,55%)'  },
    { id: 'd', x: 200, y: 50,  label: 'Merge', color: 'hsl(220,20%,55%)' },
];

const wires = [
    { from: 'a', to: 'b' },
    { from: 'a', to: 'c' },
    { from: 'b', to: 'd' },
    { from: 'c', to: 'd' },
];

function nodeById(id) { return nodes.find(n => n.id === id); }

function wirePath(from, to) {
    const dx = (to.x - from.x) * 0.5;
    return `M ${from.x + 36} ${from.y + 10} C ${from.x + 36 + dx} ${from.y + 10}, ${to.x - dx} ${to.y + 10}, ${to.x} ${to.y + 10}`;
}
</script>

<div class="kpc-wrap">
    <svg class="kpc-svg" viewBox="0 0 230 100" preserveAspectRatio="xMidYMid meet">
        <!-- background grid dots -->
        <defs>
            <pattern id="kpc-grid" width="14" height="14" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.6" fill="rgba(255,255,255,0.07)" />
            </pattern>
        </defs>
        <rect width="230" height="100" fill="url(#kpc-grid)" />

        <!-- wires -->
        {#each wires as wire}
            {@const from = nodeById(wire.from)}
            {@const to   = nodeById(wire.to)}
            <path d={wirePath(from, to)} class="kpc-wire" />
        {/each}

        <!-- nodes -->
        {#each nodes as node}
            <g transform="translate({node.x},{node.y})">
                <rect width="36" height="20" rx="5" class="kpc-node" style="--nc:{node.color}" />
                <rect width="36" height="3" rx="3" fill={node.color} />
                <text x="18" y="14" class="kpc-node-label" text-anchor="middle">{node.label}</text>
            </g>
        {/each}
    </svg>
</div>

<style>
.kpc-wrap {
    padding:         14px;
    display:         flex;
    align-items:     center;
    justify-content: center;
}

.kpc-svg {
    width:         100%;
    height:        auto;
    max-height:    110px;
    border-radius: var(--radius-sm);
    background:    rgba(0,0,0,0.25);
}

.kpc-wire {
    fill:         none;
    stroke:       rgba(255,255,255,0.25);
    stroke-width: 1.5;
}

.kpc-node {
    fill:         rgba(18,22,40,0.92);
    stroke:       color-mix(in srgb, var(--nc) 60%, transparent);
    stroke-width: 1;
}

.kpc-node-label {
    font-size:   7px;
    font-weight: 600;
    fill:        rgba(255,255,255,0.75);
    font-family: inherit;
}
</style>