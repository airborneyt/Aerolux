<!-- src/components/studio/TransportBar.svelte -->
<!--
    playback transport bar. reads/writes kinetic.transport directly; 
    does not own the requestAnimationFrame loop (stays in KineticPage.svelte).
-->
<script>
import {
    kinetic, play, pause, stopAndRewind, seekTo, nudgePlayhead,
    setBpm, setTimeDiv, setTotalDuration, setLoop,
} from '../../stores/kinetic.svelte.js';

function togglePlay() {
    kinetic.transport.playing ? pause() : play();
}

function formatTick(t) {
    return Math.round(t).toString().padStart(4, '0');
}

function onScrub(e) {
    seekTo(parseFloat(e.target.value));
}

// tap tempo ––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// keep up to the last 4 taps, discard the running 
// sequence (start fresh) if the gap since the previous 
// tap exceeds 3 seconds (same as Velocity).
const TAP_MAX_SAMPLES = 4;
const TAP_RESET_GAP_MS = 3000;
let tapTimes = $state([]);

function tapTempo() {
    const now = performance.now();
    const last = tapTimes[tapTimes.length - 1];
    const fresh = last != null && (now - last) > TAP_RESET_GAP_MS;
    tapTimes = (fresh ? [] : tapTimes).concat(now).slice(-TAP_MAX_SAMPLES);
    if (tapTimes.length < 2) return; // need at least one interval
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    setBpm(Math.round(60000 / avgMs));
}
</script>

<div class="tb-wrap">
    <div class="tb-controls">
        <button class="al-icon-btn" onclick={() => nudgePlayhead(-kinetic.transport.timeDiv)} title="Back 1 beat">⏮</button>
        <button class="al-icon-btn" onclick={stopAndRewind} title="Stop and rewind">⏹</button>
        <button class="al-icon-btn" onclick={togglePlay} title={kinetic.transport.playing ? 'Pause (Space)' : 'Play (Space)'}>
            {kinetic.transport.playing ? '⏸' : '▶'}
        </button>
        <button class="al-icon-btn" onclick={() => nudgePlayhead(kinetic.transport.timeDiv)} title="Forward 1 beat">⏭</button>
        <button
            class="al-icon-btn {kinetic.transport.loop ? 'tb-loop-active' : ''}"
            onclick={() => setLoop(!kinetic.transport.loop)}
            title={kinetic.transport.loop ? 'Loop enabled.' : 'Loop disabled.'}
        >⟲</button>
    </div>

    <span class="tb-tick al-mono">{formatTick(kinetic.transport.playheadTick)} / {formatTick(kinetic.transport.totalDuration)}</span>

    <input
        type="range" class="tb-scrub"
        min="0" max={kinetic.transport.totalDuration} step="1"
        value={kinetic.transport.playheadTick}
        oninput={onScrub}
    />

    <div class="tb-settings">
        <button class="al-btn al-btn-sm" onclick={tapTempo} title="Tap in time to set BPM">
            TAP
        </button>
        <label class="tb-setting">
            <span class="al-dim" style="font-size:10px">BPM</span>
            <input type="number" class="al-num-input" style="width:52px"
                value={kinetic.transport.bpm} min="1" max="999"
                onchange={e => setBpm(parseFloat(e.target.value))} />
        </label>
        <label class="tb-setting">
            <span class="al-dim" style="font-size:10px">Ticks/beat</span>
            <input type="number" class="al-num-input" style="width:52px"
                value={kinetic.transport.timeDiv} min="1" max="960"
                onchange={e => setTimeDiv(parseFloat(e.target.value))} />
        </label>
        <label class="tb-setting">
            <span class="al-dim" style="font-size:10px">Length</span>
            <input type="number" class="al-num-input" style="width:64px"
                value={kinetic.transport.totalDuration} min="16" step="16"
                onchange={e => setTotalDuration(parseFloat(e.target.value))} />
        </label>
    </div>
</div>

<style>
.tb-wrap {
    display:flex; align-items:center; gap:12px;
    padding:6px 14px; height:36px;
    border-bottom:1px solid var(--color-border);
    background:var(--color-glass-header);
}
.tb-controls { display:flex; gap:4px; flex-shrink:0; }
.tb-tick     { font-size:11px; color:var(--color-text-secondary); flex-shrink:0; min-width:90px; text-align:center; }
.tb-scrub    { flex:1; }
.tb-settings { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.tb-setting  { display:flex; align-items:center; gap:5px; }
.tb-loop-active { background:var(--color-accent-subtle); border-color:var(--color-accent-border); color:var(--color-accent-text); }
</style>