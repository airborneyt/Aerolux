<!-- src/components/studio/MultiDevicePreview.svelte -->
<!--
    persistent, full-fidelity multi-device hero preview.
    tiles one real VirtualLP per enabled device, reading each device's
    frame from kineticPreview.framesByDevice; same data source the Stage
    modal's lightweight thumbnail tiling reads, but rendered here at full
    WebGL fidelity, since this is the always-visible hero view (as opposed
    to the stage's css preview grid. this allows for smooth performance
    even at high device numbers).

    every device is positioned absolutely within a shared canvas using its 
    real device.position (same coordinate space & convention StageModal.svelte 
    uses; position.y feeds CSS `top` directly, see that file's header comment) 
    and rotated via a CSS transform driven by device.rotation (VirtualLP.svelte
    itself has no rotation prop). the whole arrangement's bounding box is then 
    scaled ("zoom to fit", like `object-fit: contain`) to the panel's actual 
    measured size, computed via computeFitScale() below; a small pure function 
    kept separate from the reactive functions.
-->
<script>
import { onMount, onDestroy } from 'svelte';
import { kinetic, deviceLabel } from '../../stores/kinetic.svelte.js';
import { kineticPreview } from '../../stores/kineticPreview.svelte.js';
import { DEVICE_FOOTPRINT } from '../../lib/aerolux/kinetic/devicePlacement.js';
import VirtualLP from '../shared/VirtualLP.svelte';

const PADDING_PX = 28;  // breathing room so a device isn't flush against the panel edge
const MIN_SCALE  = 8;   // px per canvas unit; floor, so an overcrowded arrangement stays legible
const MAX_SCALE  = 72;  // px per canvas unit; ceiling, so one lone device doesn't balloon absurdly

/**
    bounding box (canvas-space units) spanning every device's footprint.
    DEVICE_FOOTPRINT is a fixed 10x10 square for every model and rotation
    (devicePlacement.js); rotating a square never changes its bounding
    size, only what's drawn inside it, so no rotation-dependent swap is
    needed here. this will need to be changed to support diagonal rotations
    in the future
 
@param {Array<{position:{x:number,y:number}}>} devices
@returns {{minX:number, minY:number, width:number, height:number}}
*/
export function computeBounds(devices) {
    if (!devices.length) {
        return { minX: 0, minY: 0, width: DEVICE_FOOTPRINT.width, height: DEVICE_FOOTPRINT.height };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of devices) {
        minX = Math.min(minX, d.position.x);
        minY = Math.min(minY, d.position.y);
        maxX = Math.max(maxX, d.position.x + DEVICE_FOOTPRINT.width);
        maxY = Math.max(maxY, d.position.y + DEVICE_FOOTPRINT.height);
    }
    return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
    "Zoom to fit": the largest uniform px-per-canvas-unit scale (preserving
    aspect ratio, i.e. `object-fit: contain`, never stretching) that fits
    the whole bounding box inside the measured container, clamped to a sane
    [MIN_SCALE, MAX_SCALE] range. falls back to MIN_SCALE before the
    container has been measured at all (containerW/H still 0), so nothing
    divides by zero or renders at an enormous size for one frame.

@param {number} containerW
@param {number} containerH
@param {number} boundsW
@param {number} boundsH
@param {{padding?:number, min?:number, max?:number}} [opts]
@returns {number}
*/
export function computeFitScale(containerW, containerH, boundsW, boundsH, opts = {}) {
    const { padding = PADDING_PX, min = MIN_SCALE, max = MAX_SCALE } = opts;
    if (containerW <= 0 || containerH <= 0) return min;
    const availW = Math.max(1, containerW - padding * 2);
    const availH = Math.max(1, containerH - padding * 2);
    const fit = Math.min(availW / Math.max(1, boundsW), availH / Math.max(1, boundsH));
    return Math.max(min, Math.min(max, fit));
}

const enabledDevices = $derived(kinetic.devices.filter(d => d.enabled));
const bounds = $derived(computeBounds(enabledDevices));

// container measurement ––––––––––––––––––––––––––––––––––––––––––––
// same bind:clientWidth/clientHeight + resize-listener pattern already
// used by RecentProjectsList.svelte elsewhere in this codebase, for
// consistency.
let wrapEl    = $state(null);
let containerW = $state(0);
let containerH = $state(0);

function measure() {
    if (wrapEl) { containerW = wrapEl.clientWidth; containerH = wrapEl.clientHeight; }
}

onMount(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
});

const scale = $derived(computeFitScale(containerW, containerH, bounds.width, bounds.height));
</script>

<div class="mdp-wrap" bind:this={wrapEl} bind:clientWidth={containerW} bind:clientHeight={containerH}>
    {#if !enabledDevices.length}
        <p class="al-hint-text">No enabled devices. Add one from the Stage.</p>
    {:else}
        <div class="mdp-canvas" style="width:{bounds.width * scale}px; height:{bounds.height * scale}px">
            {#each enabledDevices as device (device.id)}
                {@const tileSize = DEVICE_FOOTPRINT.width * scale}
                <div
                    class="mdp-device"
                    style="left:{(device.position.x - bounds.minX) * scale}px;
                           top:{(device.position.y - bounds.minY) * scale}px;
                           width:{tileSize}px; height:{tileSize}px;"
                >
                    <div class="mdp-rotator" style="transform:rotate({device.rotation}deg)">
                        <VirtualLP
                            sysexColors={kineticPreview.framesByDevice.get(device.id) ?? new Map()}
                            size={tileSize}
                            interactive={false}
                        />
                    </div>
                    <div class="mdp-device-label">
                        {deviceLabel(device)}
                        {#if device.rotation}<span class="mdp-rotation-badge">↻{device.rotation}°</span>{/if}
                        {#if device.isPrimary}<span class="mdp-primary-badge">★</span>{/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
.mdp-wrap {
    display:         flex;
    align-items:     center;
    justify-content: center;
    width:           100%;
    flex:            1;
    min-height:      0;
    overflow:        hidden;
    padding:         16px;
    box-sizing:      border-box;
}

.mdp-canvas { position: relative; flex-shrink: 0; }

.mdp-device {
    position:        absolute;
    display:         flex;
    align-items:     center;
    justify-content: center;
}

.mdp-rotator {
    display:         flex;
    align-items:     center;
    justify-content: center;
    transition:      transform var(--duration-base, 200ms) var(--ease-smooth, ease);
}

.mdp-device-label {
    position:        absolute;
    left: 0; right: 0; bottom: 0;
    display:         flex;
    align-items:     center;
    justify-content: center;
    gap:             4px;
    padding:         2px 4px;
    background:      rgba(0,0,0,0.45);
    font-size:       10px;
    font-family:     'Geist Mono', monospace;
    color:           rgba(255,255,255,0.75);
    pointer-events:  none;
}
.mdp-rotation-badge { color: rgba(255,255,255,0.5); }
.mdp-primary-badge  { color: var(--color-accent); }
</style>