// src/stores/kinetic.svelte.js
// Kinetic workspace state

import { buildLaunchpadGrid } from '../lib/aerolux/midi-layout.js';
import { NODE_BY_ID } from '../lib/aerolux/nodeRegistry.js';

// this is what "context" is in the nodes. you can use any of these values as context
export const kinetic = $state({
    // hardware
    device:        'LPP2',   // 'LPX' | 'LPP2' | 'LPP3'
    midiConnected: false,
    midiDevice:    '',

    // node graph
    nodeInstances: [],   // NodeInstance[]
    wires:         [],   // Wire[]

    // selection
    selectedInstanceId: null,

    // playback
    playing:       false,
    playheadTick:  0,
    bpm:           120,
    timeDiv:       96,
    totalDuration: 96 * 4 * 8,  // 8 bars default
    // currentFrame is updated by the generator engine each tick.
    // Map<sysexPad, [r6, g6, b6]>  — 6-bit values matching the palette.
    currentFrame: new Map(),

    // clips keyed by instanceId
    loadedClips: {},

    // automation data: { [instanceId]: { [paramKey]: [{tick,value}] } }
    automationData: {},

    // virtual LP input
    pressedPads: new Set(),
});

// ── Gradient registry (fed from Velocity editor) ──────────────────
export const availableGradients = $state({ map: new Map() });

export function registerGradient(id, gradResult) {
    availableGradients.map.set(id, gradResult.map(g => ({ ...g })));
}

export function unregisterGradient(id) {
    availableGradients.map.delete(id);
}

// ── Derived: selected node instance ──────────────────────────────
const selNode = $derived(
    kinetic.nodeInstances.find(n => n.instanceId === kinetic.selectedInstanceId) ?? null
);

export function selectedNode() {
    return selNode;
}

// ── Node mutations ────────────────────────────────────────────────

export function addNode(desc, position) {
    const pos = position ?? { x: 80 + kinetic.nodeInstances.length * 220, y: 80 };
    const params = {};
    for (const [key, p] of Object.entries(desc.params ?? {})) {
        params[key] = Array.isArray(p.default)
            ? JSON.parse(JSON.stringify(p.default))
            : p.default;
    }
    const instance = {
        instanceId: crypto.randomUUID(),
        nodeId:     desc.id,
        enabled:    true,
        params,
        position:   { ...pos },
    };
    kinetic.nodeInstances.push(instance);
    kinetic.selectedInstanceId = instance.instanceId;
    return instance;
}

export function removeNode(instanceId) {
    const idx = kinetic.nodeInstances.findIndex(n => n.instanceId === instanceId);
    if (idx !== -1) kinetic.nodeInstances.splice(idx, 1);
    kinetic.wires = kinetic.wires.filter(
        w => w.fromId !== instanceId && w.toId !== instanceId
    );
    if (kinetic.selectedInstanceId === instanceId) kinetic.selectedInstanceId = null;
    delete kinetic.automationData[instanceId];
    delete kinetic.loadedClips[instanceId];
}

export function setParam(instanceId, paramKey, value) {
    const node = kinetic.nodeInstances.find(n => n.instanceId === instanceId);
    if (node) node.params[paramKey] = value;
}

export function toggleNode(instanceId) {
    const node = kinetic.nodeInstances.find(n => n.instanceId === instanceId);
    if (node) node.enabled = !node.enabled;
}

export function moveNode(instanceId, x, y) {
    const node = kinetic.nodeInstances.find(n => n.instanceId === instanceId);
    if (node) node.position = { x, y };
}

// ── Wires ─────────────────────────────────────────────────────────

export function addWire(fromId, fromPort, toId, toPort) {
    // one wire per input port
    kinetic.wires = kinetic.wires.filter(
        w => !(w.toId === toId && w.toPort === toPort)
    );
    kinetic.wires.push({
        id: crypto.randomUUID(),
        fromId, fromPort,
        toId,   toPort,
    });
}

export function removeWire(wireId) {
    kinetic.wires = kinetic.wires.filter(w => w.id !== wireId);
}

// ── Automation ────────────────────────────────────────────────────

export function addAutoPoint(instanceId, paramKey, tick, value) {
    if (!kinetic.automationData[instanceId])
        kinetic.automationData[instanceId] = {};
    if (!kinetic.automationData[instanceId][paramKey])
        kinetic.automationData[instanceId][paramKey] = [];
    const lane = kinetic.automationData[instanceId][paramKey]
        .filter(p => p.tick !== tick);
    lane.push({ tick, value });
    lane.sort((a, b) => a.tick - b.tick);
    kinetic.automationData[instanceId][paramKey] = lane;
}

export function removeAutoPoint(instanceId, paramKey, tick) {
    const lane = kinetic.automationData[instanceId]?.[paramKey];
    if (!lane) return;
    kinetic.automationData[instanceId][paramKey] = lane.filter(p => p.tick !== tick);
}

export function sampleAuto(instanceId, paramKey, tick) {
    const lane = kinetic.automationData[instanceId]?.[paramKey];
    if (!lane?.length) return null;
    if (tick <= lane[0].tick)             return lane[0].value;
    if (tick >= lane[lane.length-1].tick) return lane[lane.length-1].value;
    for (let i = 0; i < lane.length - 1; i++) {
        if (tick >= lane[i].tick && tick <= lane[i+1].tick) {
            const t = (tick - lane[i].tick) / (lane[i+1].tick - lane[i].tick);
            return lane[i].value + t * (lane[i+1].value - lane[i].value);
        }
    }
    return lane[lane.length-1].value;
}

// ── Virtual LP input ──────────────────────────────────────────────
export function padPress(sx)   { kinetic.pressedPads.add(sx); }
export function padRelease(sx) { kinetic.pressedPads.delete(sx); }

// ── Playback ──────────────────────────────────────────────────────

let _raf     = null;
let _startMs = 0;
let _startTk = 0;

export function play() {
    if (kinetic.playing) return;
    kinetic.playing = true;
    _startMs        = performance.now();
    _startTk        = kinetic.playheadTick;
    const msPerTick = 60000 / ((kinetic.bpm || 120) * (kinetic.timeDiv || 96));

    function tick() {
        if (!kinetic.playing) return;
        const elapsed = performance.now() - _startMs;
        kinetic.playheadTick = Math.min(
            _startTk + elapsed / msPerTick,
            kinetic.totalDuration
        );
        if (kinetic.playheadTick >= kinetic.totalDuration) {
            stop();
            return;
        }
        _raf = requestAnimationFrame(tick);
    }
    _raf = requestAnimationFrame(tick);
}

export function stop() {
    kinetic.playing = false;
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
}

export function seek(tick) {
    kinetic.playheadTick = Math.max(0, Math.min(kinetic.totalDuration, tick));
}

// ── MIDI bake / export ────────────────────────────────────────────

export function bakeToMidi(noteOns, timeDiv, bpm) {
    const td  = timeDiv || kinetic.timeDiv || 96;
    const bm  = bpm    || kinetic.bpm     || 120;
    const evs = [...noteOns].sort((a, b) => a.absTime - b.absTime);
    const trk = [];

    function vl(n) {
        if (n < 128) return [n];
        const buf = [];
        buf.push(n & 0x7F);
        let v = n >> 7;
        while (v > 0) { buf.push((v & 0x7F) | 0x80); v >>= 7; }
        return buf.reverse();
    }

    const us = Math.round(60000000 / bm);
    trk.push(...vl(0), 0xFF, 0x51, 0x03,
        (us >> 16) & 0xFF, (us >> 8) & 0xFF, us & 0xFF);

    let prev = 0;
    for (const ev of evs) {
        const d = Math.max(0, ev.absTime - prev);
        trk.push(...vl(d), 0x90, ev.noteNum & 0x7F, ev.velocity & 0x7F);
        prev = ev.absTime;
    }
    trk.push(...vl(0), 0xFF, 0x2F, 0x00);

    const tl  = trk.length;
    const hdr = [
        0x4D,0x54,0x68,0x64, 0,0,0,6,
        0,0, 0,1,
        (td >> 8) & 0xFF, td & 0xFF,
    ];
    const th  = [
        0x4D,0x54,0x72,0x6B,
        (tl>>24)&0xFF,(tl>>16)&0xFF,(tl>>8)&0xFF,tl&0xFF,
    ];
    return new Uint8Array([...hdr, ...th, ...trk]);
}
