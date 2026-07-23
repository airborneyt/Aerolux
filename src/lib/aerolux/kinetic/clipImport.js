// src/lib/aerolux/kinetic/clipImport.js
// ============================================================================
// KINETIC 2.0 — CLIP IMPORT
// Phase 7 of Kinetic-2.0-Master-Plan.md.
//
// Two unrelated halves:
//
// 1. parseMidi/parseClipFile -- a raw byte-level Standard MIDI File reader.
//    Ported near-verbatim from the original prototype: it never touched
//    midi-layout.js, a store, or anything else -- it's pure, dependency-free
//    byte parsing, so there was nothing to rebuild here, only to keep.
//
// 2. clipToField -- brand new. A recorded clip is genuinely, natively a
//    sparse event log (this is the one place in the whole engine where that
//    representation is the RIGHT one, not a limitation -- see the master
//    plan §1's note on this exact point). This adapter wraps that event log
//    into a Field, so a loaded clip can sit anywhere in a graph like any
//    other node.
//
// KNOWN LIMITATION (see KINETIC-NODE-AUTHORING-GUIDE.md §14 for the general
// pattern this follows): mapping a MIDI note number to a canvas position
// requires knowing a device's real note<->pad layout, which now comes from
// the single canonical getDeviceGrid() (device-type simplification -- see
// kinetic.svelte.js's header). Also simplistic: velocity maps directly to a
// grey intensity rather than resolving through the palette like every other
// node does -- clip playback colour semantics are a bigger design question
// left for whoever does that integration.
// ============================================================================

import { nullField } from './field.js';

// ── Byte-level MIDI parser (unchanged from the original prototype) ───────

function readVarLen(bytes, pos) {
    let val = 0;
    do {
        if (pos >= bytes.length) break;
        val = (val << 7) | (bytes[pos] & 0x7F);
    } while (bytes[pos++] & 0x80);
    return { val, pos };
}

function parseMidi(bytes) {
    if (bytes[0] !== 0x4D || bytes[1] !== 0x54 ||
        bytes[2] !== 0x68 || bytes[3] !== 0x64) {
        throw new Error('not a valid MIDI file');
    }

    const hdrLen  = (bytes[4]<<24)|(bytes[5]<<16)|(bytes[6]<<8)|bytes[7];
    const format  = (bytes[8]<<8)|bytes[9];
    const numTrks = (bytes[10]<<8)|bytes[11];
    const timeDiv = (bytes[12]<<8)|bytes[13];

    if (format > 1) throw new Error(`MIDI format ${format} not supported`);

    const noteOns      = [];
    const tempoChanges = []; // { tick, uspb } -- microseconds per beat
    let filePos = 8 + hdrLen;

    for (let t = 0; t < numTrks; t++) {
        if (filePos + 8 > bytes.length) break;
        const tag = String.fromCharCode(
            bytes[filePos], bytes[filePos+1], bytes[filePos+2], bytes[filePos+3]
        );
        const trkLen = (bytes[filePos+4]<<24)|(bytes[filePos+5]<<16)|
                       (bytes[filePos+6]<<8)|bytes[filePos+7];
        filePos += 8;
        if (tag !== 'MTrk') { filePos += trkLen; continue; }

        const trkEnd = filePos + trkLen;
        let pos     = filePos;
        let absTime = 0;
        let runStat = 0;

        while (pos < trkEnd) {
            const vl = readVarLen(bytes, pos); pos = vl.pos;
            absTime += vl.val;

            const sb = bytes[pos];

            if (sb === 0xFF) {
                pos++;
                const mt = bytes[pos++];
                const ml = readVarLen(bytes, pos); pos = ml.pos;
                if (mt === 0x51 && ml.val === 3) {
                    const uspb = (bytes[pos]<<16)|(bytes[pos+1]<<8)|bytes[pos+2];
                    tempoChanges.push({ tick: absTime, uspb });
                }
                pos += ml.val;
                runStat = 0;
            } else if (sb === 0xF0 || sb === 0xF7) {
                pos++;
                const ml = readVarLen(bytes, pos); pos = ml.pos + ml.val;
                runStat = 0;
            } else {
                let status = sb;
                if (sb & 0x80) { runStat = sb; pos++; } else { status = runStat; }
                const cmd = (status & 0xF0) >> 4;
                if (cmd === 0x9) {
                    const note = bytes[pos];
                    const vel  = bytes[pos + 1];
                    pos += 2;
                    noteOns.push({ absTime, noteNum: note, velocity: vel }); // vel 0 = note-off, kept as-is
                } else if (cmd === 0x8) {
                    const note = bytes[pos];
                    noteOns.push({ absTime, noteNum: note, velocity: 0 });
                    pos += 2;
                } else if (cmd === 0xA || cmd === 0xB || cmd === 0xE) {
                    pos += 2;
                } else if (cmd === 0xC || cmd === 0xD) {
                    pos += 1;
                }
            }
        }
        filePos = trkEnd;
    }

    return { noteOns, timeDiv, numTrks, tempoChanges };
}

function effectiveBpm(tempoChanges) {
    if (!tempoChanges?.length) return 120;
    return Math.round(60000000 / tempoChanges[0].uspb);
}

/**
 * Parse a raw MIDI file Uint8Array into a clipData object, ready to store in
 * a clipImport node's params.
 * @param {Uint8Array} bytes
 * @returns {{ noteOns, timeDiv, numTrks, tempoChanges, bpm, durationSec }}
 */
export function parseClipFile(bytes) {
    const parsed = parseMidi(bytes);
    const bpm    = effectiveBpm(parsed.tempoChanges);

    const maxTick     = Math.max(...parsed.noteOns.map(e => e.absTime), 0);
    const ticksPerSec = (bpm / 60) * parsed.timeDiv;
    const durationSec = ticksPerSec > 0 ? maxTick / ticksPerSec : 0;

    return {
        noteOns:      parsed.noteOns,
        timeDiv:      parsed.timeDiv,
        numTrks:      parsed.numTrks,
        tempoChanges: parsed.tempoChanges,
        bpm,
        durationSec,
    };
}

// ── Field adapter (new) ────────────────────────────────────────────────

/**
 * Wraps a parsed clip into a Field. `sample(x,y,t)` looks up whichever note
 * maps to (x,y) on the given local grid and reports whether it's "on" at
 * tick t, per the clip's own recorded note-on/off events.
 *
 * @param {{noteOns: Array<{absTime,noteNum,velocity}>, timeDiv:number}|null} clipData
 * @param {Array<{exportNote:number|null, x:number, y:number}>} localCells
 * @param {{ timeStretch?:number, transpose?:number }} [opts]
 * @returns {Field}
 */
export function clipToField(clipData, localCells, opts = {}) {
    if (!clipData?.noteOns?.length) return nullField;
    const { timeStretch = 1, transpose = 0 } = opts;

    // noteNum -> {x,y}, from whatever local grid the caller supplies
    // (the single canonical grid, post device-type simplification).
    const posByNote = new Map();
    for (const cell of localCells) {
        if (cell.exportNote != null) posByNote.set(cell.exportNote, { x: cell.x, y: cell.y });
    }
    const noteByPosKey = new Map();
    for (const [note, pos] of posByNote) noteByPosKey.set(`${pos.x},${pos.y}`, note);

    // Group events per (possibly transposed) note, sorted by time, so
    // sample() can binary-search-ish scan for "what's the most recent event
    // at or before t".
    const eventsByNote = new Map();
    for (const ev of clipData.noteOns) {
        const note = ev.noteNum + transpose;
        if (!eventsByNote.has(note)) eventsByNote.set(note, []);
        eventsByNote.get(note).push({
            absTime: Math.round(ev.absTime * timeStretch),
            velocity: ev.velocity,
        });
    }
    for (const lane of eventsByNote.values()) lane.sort((a, b) => a.absTime - b.absTime);

    return {
        kind: 'stateless',
        sample(x, y, t) {
            const note = noteByPosKey.get(`${Math.round(x)},${Math.round(y)}`);
            if (note == null) return null;
            const lane = eventsByNote.get(note);
            if (!lane?.length) return null;

            let active = null;
            for (const ev of lane) {
                if (ev.absTime > t) break;
                active = ev;
            }
            if (!active || active.velocity === 0) return null;

            // Simplistic velocity -> grey intensity, see module doc: real
            // palette resolution for clip playback is left as follow-up.
            const v = Math.round((active.velocity / 127) * 63);
            return [v, v, v];
        },
    };
}