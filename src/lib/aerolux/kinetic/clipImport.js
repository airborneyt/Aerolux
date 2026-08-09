// src/lib/aerolux/kinetic/clipImport.js
// ============================================================================
// KINETIC ENGINE: CLIP IMPORT (rebuilt from scratch)
//
// two halves:
// 1. parseMidi/parseClipFile: a raw byte-level standard midi file reader
// 2. clipToField: the field adapter
// ============================================================================

import { nullField } from './field.js';
import { resolvePaletteColour } from './sharedHelpers.js';

// byte-level midi parser –––––––––––––––––––––––––––––––––––––––––––

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

    const hdrLen  = (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
    const format  = (bytes[8] << 8) | bytes[9];
    const numTrks = (bytes[10] << 8) | bytes[11];
    const timeDiv = (bytes[12] << 8) | bytes[13];

    if (format > 1) throw new Error(`MIDI format ${format} not supported`);

    const noteOns      = [];
    const tempoChanges = []; // { tick, uspb } - microseconds per beat
    let filePos = 8 + hdrLen;

    for (let t = 0; t < numTrks; t++) {
        if (filePos + 8 > bytes.length) break;
        const tag = String.fromCharCode(
            bytes[filePos], bytes[filePos + 1], bytes[filePos + 2], bytes[filePos + 3]
        );
        const trkLen = (bytes[filePos + 4] << 24) | (bytes[filePos + 5] << 16) |
                       (bytes[filePos + 6] << 8) | bytes[filePos + 7];
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
                // meta event
                pos++;
                const mt = bytes[pos++];
                const ml = readVarLen(bytes, pos); pos = ml.pos;
                if (mt === 0x51 && ml.val === 3) {
                    const uspb = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
                    tempoChanges.push({ tick: absTime, uspb });
                }
                pos += ml.val;
                runStat = 0;
            } else if (sb === 0xF0 || sb === 0xF7) {
                // sysex
                pos++;
                const ml = readVarLen(bytes, pos); pos = ml.pos + ml.val;
                runStat = 0;
            } else {
                let status = sb;
                if (sb & 0x80) { runStat = sb; pos++; } else { status = runStat; }
                const cmd = (status & 0xF0) >> 4;
                if (cmd === 0x9) {
                    // note on (velocity 0 == note off)
                    const note = bytes[pos];
                    const vel  = bytes[pos + 1];
                    pos += 2;
                    noteOns.push({ absTime, noteNum: note, velocity: vel });
                } else if (cmd === 0x8) {
                    // note off
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
    parse a raw midi file Uint8Array into a clipData object, ready to store in
    a clipImport node's params.

@param {Uint8Array} bytes
@returns {{ noteOns, timeDiv, numTrks, tempoChanges, bpm, durationSec }}
*/
export function parseClipFile(bytes) {
    const parsed = parseMidi(bytes);
    const bpm    = effectiveBpm(parsed.tempoChanges);

    const maxTick     = Math.max(0, ...parsed.noteOns.map(e => e.absTime));
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

// field adapter ––––––––––––––––––––––––––––––––––––––––––––––––––––

/**
    binary search for the last event in a sorted-by-absTime lane whose
    absTime is <= t. returns null if every event is after t (nothing active
    yet). O(log n) per call.

@param {Array<{absTime:number, velocity:number}>} lane  sorted ascending
@param {number} t
@returns {{absTime:number, velocity:number}|null}
*/
function findActiveEvent(lane, t) {
    let lo = 0, hi = lane.length - 1, result = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lane[mid].absTime <= t) { result = mid; lo = mid + 1; }
        else { hi = mid - 1; }
    }
    return result === -1 ? null : lane[result];
}

/**
    wraps a parsed clip into a Field. sample(x,y,t) looks up whichever note
    maps to (x,y) on the given local grid and reports its resolved palette
    colour if it's "on" at tick t, per the clip's own recorded note-on/off
    events. null (unlit) otherwise.

@param {{noteOns: Array<{absTime,noteNum,velocity}>, timeDiv:number}|null} clipData
@param {Array<{exportNote:number|null, x:number, y:number}>} localCells  from getDeviceGrid()
@param {{ palette?: Array }} [context]  resolves velocity -> RGB63
@param {{ timeStretch?:number, transpose?:number }} [staticParams]  used only when resolveParam isn't supplied (testing purposes)
@param {(key:string, t:number) => *} [resolveParam]  optional 
@returns {Field}
*/
export function clipToField(clipData, localCells, context = {}, staticParams = {}, resolveParam) {
    if (!clipData?.noteOns?.length) return nullField;

    const { timeStretch: staticStretch = 1, transpose: staticTranspose = 0 } = staticParams;
    const palette = context?.palette;

    // noteNum -> {x,y} from whatever local grid the caller supplies
    const posByNote = new Map();
    for (const cell of localCells) {
        if (cell.exportNote != null) posByNote.set(cell.exportNote, { x: cell.x, y: cell.y });
    }
    const noteByPosKey = new Map();
    for (const [note, pos] of posByNote) noteByPosKey.set(`${pos.x},${pos.y}`, note);

    // group raw (untransposed, unstretched) events per note sorted by time
    // transpose/timeStretch are applied per-sample below (so they can be re-read live via resolveParam) rather than baked in here
    const eventsByNote = new Map();
    for (const ev of clipData.noteOns) {
        if (!eventsByNote.has(ev.noteNum)) eventsByNote.set(ev.noteNum, []);
        eventsByNote.get(ev.noteNum).push({ absTime: ev.absTime, velocity: ev.velocity });
    }
    for (const lane of eventsByNote.values()) lane.sort((a, b) => a.absTime - b.absTime);

    return {
        kind: 'stateless',
        sample(x, y, t) {
            const transpose   = resolveParam ? resolveParam('transpose', t) : staticTranspose;
            const timeStretch = resolveParam ? resolveParam('timeStretch', t) : staticStretch;
            const stretch     = timeStretch === 0 ? 0.0001 : timeStretch; // guard divide-by-zero

            const note = noteByPosKey.get(`${Math.round(x)},${Math.round(y)}`);
            if (note == null) return null;

            // untranspose the lookup: this cell's note, minus however much
            // it's being transposing by, is the original recorded note
            // whose lane we need. then unstretch t back into the clip's own
            // original time to search that lane
            const lane = eventsByNote.get(note - transpose);
            if (!lane?.length) return null;

            const originalT = t / stretch;
            const active = findActiveEvent(lane, originalT);
            if (!active || active.velocity === 0) return null;
            
            return resolvePaletteColour(palette, active.velocity);
        },
    };
}