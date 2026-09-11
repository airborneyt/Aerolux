// src/lib/aerolux/bridge/clips.js
//
// converts between the bridge's beat-based aerolux-midi wire format
// and kinetic's tick-based note-event shapes
// reuses kinetic's clipImport.js and midiExport.js

import { send, sendType, waitForReply } from './client.js';
import { MESSAGE_TYPES } from './protocol.js';
import { registerInstance, getClipForInstance } from './session.js';

const DEFAULT_PPQN = 480;

/**
    this converts kinetic's sampleFieldToNoteOnes() output to
    the bridge's ableton-compatible {pitch, start, duration, velocity, muted[]
    shape
    note-on = velocity > 0

@param {Array<{absTime:number, noteNum:number, velocity:number}>} noteOns
@param {number} timeDiv  ticks per beat (kinetic's timeDiv)
@returns {Array<{pitch:number, start:number, duration:number, velocity:number, muted:boolean}>}
*/
export function noteEventsToAeroluxMidiNotes(noteOns, timeDiv) {
    const sorted = [...noteOns].sort((a, b) => a.absTime - b.absTime);
    const openByPitch = new Map(); // noteNum -> { startTick, velocity }
    const notes = [];

    const close = (noteNum, open, endTick, minDuration = false) => {
        const durationBeats = minDuration
            ? 1 / timeDiv
            : Math.max(1, endTick - open.startTick) / timeDiv;
        notes.push({
            pitch: noteNum,
            start: open.startTick / timeDiv,
            duration: durationBeats,
            velocity: open.velocity,
            muted: false,
        });
    };

    for (const ev of sorted) {
        const open = openByPitch.get(ev.noteNum);
        if (ev.velocity > 0) {
            if (open) close(ev.noteNum, open, ev.absTime);
            openByPitch.set(ev.noteNum, { startTick: ev.absTime, velocity: ev.velocity });
        } else if (open) {
            close(ev.noteNum, open, ev.absTime);
            openByPitch.delete(ev.noteNum);
        }
    }
    for (const [noteNum, open] of openByPitch) {
        close(noteNum, open, open.startTick, true);
    }

    notes.sort((a, b) => a.start - b.start);
    return notes;
}

/**
    inverse of the above function

@param {Array<{pitch,start,duration,velocity,muted}>} notes
@param {{ppqn:number}} clipMeta
@param {number} bpm
@returns {{noteOns:Array, timeDiv:number, numTrks:number, tempoChanges:Array, bpm:number, durationSec:number}}
*/
export function aeroluxMidiNotesToClipData(notes, clipMeta, bpm) {
    const timeDiv = clipMeta.ppqn ?? DEFAULT_PPQN;
    const noteOns = [];

    for (const n of notes) {
        if (n.muted) continue;
        const startTick = Math.round(n.start * timeDiv);
        const endTick = Math.round((n.start + n.duration) * timeDiv);
        noteOns.push({ absTime: startTick, noteNum: n.pitch, velocity: n.velocity });
        noteOns.push({ absTime: endTick, noteNum: n.pitch, velocity: 0 });
    }
    noteOns.sort((a, b) => a.absTime - b.absTime);

    const maxTick = Math.max(0, ...noteOns.map(e => e.absTime));
    const ticksPerSec = (bpm / 60) * timeDiv;

    return {
        noteOns,
        timeDiv,
        numTrks: 1,
        tempoChanges: [{ tick: 0, uspb: Math.round(60000000 / bpm) }],
        bpm,
        durationSec: ticksPerSec > 0 ? maxTick / ticksPerSec : 0,
    };
}

/**
    this sends a compiled kinetic effect to the bridge as a new clip
    registers the returned clipId against instanecId in session.js on success

@param {string} instanceId
@param {Array} noteOns
@param {{timeDiv:number, bpm:number, trackId?:string}} opts
@returns {Promise<string>} the created clipId
*/
export async function sendEffect(instanceId, noteOns, opts) {
    const { timeDiv = 96, bpm = 120, trackId = null } = opts;
    const midi = {
        format: 'aerolux-midi',
        version: 1,
        ppqn: timeDiv,
        notes: noteEventsToAeroluxMidiNotes(noteOns, timeDiv),
    };

    const request = { type: MESSAGE_TYPES.CLIP_CREATE, payload: { trackId, midi, bpm } };
    const built = await sendAndTrack(request);
    const reply = await waitForReply(built.id);

    const clipId = reply.payload?.clipId;
    if (!clipId) throw new Error('AeroFlux: clip.created reply missing clipId.');
    registerInstance(instanceId, clipId);
    return clipId;
}

// this rewrites an already-linked clip's midi data
export async function updateLinkedClip(instanceId, noteOns, opts) {
    const clipId = getClipForInstance(instanceId);
    if (!clipId) throw new Error(`AeroFlux: instance "${instanceId}" is not linked to a clip.`);

    const { timeDiv = 96, bpm = 120 } = opts;
    const midi = {
        format: 'aerolux-midi',
        version: 1,
        ppqn: timeDiv,
        notes: noteEventsToAeroluxMidiNotes(noteOns, timeDiv),
    };

    const built = await sendAndTrack({ type: MESSAGE_TYPES.CLIP_UPDATE, payload: { clipId, midi, bpm } });
    return waitForReply(built.id);
}

/**
    this converts an incoming clip.import message's midi data into
    clipData for kinetic's clipImport node

@param {{payload:{midi:object, bpm:number}}} clipImportMessage
*/
export function importClip(clipImportMessage) {
    const { midi, bpm = 120 } = clipImportMessage.payload ?? {};
    if (midi?.format !== 'aerolux-midi') {
        throw new Error(`AeroFlux: unexpected clip MIDI format "${midi?.format}".`);
    }
    return aeroluxMidiNotesToClipData(midi.notes ?? [], { ppqn: midi.ppqn }, bpm);
}

async function sendAndTrack(partial) {
    const { makeMessage } = await import('./protocol.js');
    const message = makeMessage(partial.type, partial.payload);
    await send(message);
    return message;
}