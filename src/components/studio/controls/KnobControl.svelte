<!-- src/components/studio/controls/KnobControl.svelte -->
<script>
let {
    label    = '',
    value    = 0,
    min      = -180,
    max      = 180,
    unit     = '',
    wrap     = false,
    decimals = 1,
    hint     = '',
    onchange = () => {},
} = $props();

// accumulated rotation for wrap mode (not clamped to min/max)
let accumulatedDeg = $state(value);
let dragging       = $state(false);
let startY         = 0;
let startVal       = 0;

// display value (clamped for non-wrap, free for wrap)
const displayVal = $derived(
    wrap ? accumulatedDeg : Math.max(min, Math.min(max, accumulatedDeg))
);

// visual angle for the knob arc (always maps displayVal within min/max to -135°→+135°)
const visualAngle = $derived.by(() => {
    const range = max - min;
    // wrap mode: show position within current min/max cycle
    const clamped = wrap
        ? ((((accumulatedDeg - min) % range) + range) % range) + min
        : Math.max(min, Math.min(max, accumulatedDeg));
    return ((clamped - min) / range) * 270 - 135;  // -135° to +135°
});

// formatted number for input
let inputStr = $state(value.toFixed(decimals));
let editing  = $state(false);

function startDrag(e) {
    dragging = true;
    startY   = e.clientY;
    startVal = accumulatedDeg;
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup',   endDrag);
    e.preventDefault();
}

function onDrag(e) {
    if (!dragging) return;
    // 1px = 1° when range is 360; scale to param range
    const delta = (startY - e.clientY) * ((max - min) / 200);
    const next  = wrap
        ? startVal + delta
        : Math.max(min, Math.min(max, startVal + delta));
    accumulatedDeg = next;
    inputStr = displayVal.toFixed(decimals);
    onchange(displayVal);
}

function endDrag() {
    dragging = false;
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup',   endDrag);
}

function commitInput() {
    editing = false;
    const parsed = parseFloat(inputStr);
    if (!isNaN(parsed)) {
        accumulatedDeg = wrap ? parsed : Math.max(min, Math.min(max, parsed));
        onchange(displayVal);
    }
    inputStr = displayVal.toFixed(decimals);
}

// SVG arc path for the knob track
function arcPath(angleDeg, r = 28) {
    const start = (angleDeg - 135) * Math.PI / 180;
    const end   = (-135) * Math.PI / 180 - 0.01;
    // always draw 270° track
    const trackStart = (-225) * Math.PI / 180;
    const trackEnd   = (135)  * Math.PI / 180;
    const cx = 32, cy = 32;

    function pt(a) {
        return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }

    // full track arc (background)
    const trackLarge = 1;
    const tPath = `M ${pt(trackStart)} A ${r} ${r} 0 ${trackLarge} 1 ${pt(trackEnd)}`;

    // filled arc from -135° to current angle
    const currentRad = ((Math.max(min, Math.min(max,
        wrap ? ((((accumulatedDeg - min) % (max-min)) + (max-min)) % (max-min)) + min
             : accumulatedDeg)) - min) / (max - min)) * 270 - 225;
    const fillRad = currentRad * Math.PI / 180;
    const fillLarge = currentRad - (-225) > 180 ? 1 : 0;
    const fPath = `M ${pt(trackStart)} A ${r} ${r} 0 ${fillLarge} 1 ${pt(fillRad)}`;

    return { tPath, fPath };
}

const paths = $derived(arcPath(visualAngle));
</script>

<div class="knob-wrap">
    <p class="al-label" style="margin-bottom:6px">{label}</p>

    <!-- SVG knob -->
    <div class="knob-body"
        onpointerdown={startDrag}
        title="Drag up/down to adjust. {hint}"
        style="cursor:{dragging ? 'ns-resize' : 'grab'}"
    >
        <svg width="64" height="64" viewBox="0 0 64 64">
            <!-- track background -->
            <path d={paths.tPath} fill="none"
                stroke="rgba(255,255,255,0.1)" stroke-width="2"
                stroke-linecap="round" />
            <!-- filled arc -->
            <path d={paths.fPath} fill="none"
                stroke="var(--color-accent)" stroke-width="4"
                stroke-linecap="round" />
            <!-- dot indicator -->
            <circle
                cx={32 + 12 * Math.cos((visualAngle - 90) * Math.PI / 180)}
                cy={32 + 12 * Math.sin((visualAngle - 90) * Math.PI / 180)}
                r="3" fill="var(--color-accent)"
            />
            <!-- centre fill -->
            <circle cx="32" cy="32" r="18"
                fill="var(--color-surface-2)" stroke="var(--color-border)" stroke-width="1" />
        </svg>
        
        <!-- value readout, click to type -->
        <div style="margin-top:4px;" class="knob-readout" onclick={() => { editing = true; inputStr = displayVal.toFixed(decimals); }}>
            {#if editing}
                <input
                    class="knob-input"
                    bind:value={inputStr}
                    onblur={commitInput}
                    onkeydown={e => { if (e.key === 'Enter') commitInput(); if (e.key === 'Escape') { editing = false; inputStr = displayVal.toFixed(decimals); } }}
                    autofocus
                />
            {:else}
                <span class="knob-value">{displayVal.toFixed(decimals)}</span>
                {#if unit}<span class="knob-unit">{unit}</span>{/if}
            {/if}
        </div>
    </div>

    {#if hint}
        <p class="al-hint-text" style="margin-top:4px;font-size:10px">{hint}</p>
    {/if}
</div>

<style>
.knob-wrap  { display: flex; flex-direction: column; align-items: flex-start; }
.knob-body  {
    position:        relative;
    display:         inline-flex;
    flex-direction:  column;
    align-items:     center;
    user-select:     none;
}
.knob-readout {
    display:         flex;
    align-items:     baseline;
    gap:             2px;
    margin-top:      -6px;
    cursor:          text;
}
.knob-value { font-family: 'Geist Mono', monospace; font-size: 12px; color: var(--color-text); }
.knob-unit  { font-size: 10px; color: var(--color-text-dim); }
.knob-input {
    width:           52px;
    border:          1px solid var(--color-accent);
    border-radius:   4px;
    background:      var(--color-surface-1);
    color:           var(--color-text);
    font-family:     'Geist Mono', monospace;
    font-size:       12px;
    text-align:      center;
    padding:         2px 4px;
    outline:         none;
}
</style>