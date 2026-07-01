// src/lib/aerolux/nodes/clipImport.js
// clip import generator node
// loads a .mid file, parses it, and replays its note events through the kinetic pipeline
// the parsed clip lives in params.clipData — set by the inspector control via setParam
// no external store lookups, no instance id injection — follows the rotate.js pattern
 
import { buildLaunchpadGrid, cellByExportNote, ZONE } from '../midi-layout.js';
 
// ── midi parser ───────────────────────────────────────────────────
// self-contained — does not import from midi.js so this node has no
// dependency on the old split-chromatic note numbering
 
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
 
    const noteOns    = [];
    const tempoChanges = [];  // { tick, uspb } — microseconds per beat
    let filePos      = 8 + hdrLen;
 
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
        let pos      = filePos;
        let absTime  = 0;
        let runStat  = 0;
 
        while (pos < trkEnd) {
            const vl = readVarLen(bytes, pos); pos = vl.pos;
            absTime += vl.val;
 
            const sb = bytes[pos];
 
            if (sb === 0xFF) {
                // meta event
                pos++;
                const mt = bytes[pos++];
                const ml = readVarLen(bytes, pos); pos = ml.pos;
                // tempo: FF 51 03 tt tt tt
                if (mt === 0x51 && ml.val === 3) {
                    const uspb = (bytes[pos]<<16)|(bytes[pos+1]<<8)|bytes[pos+2];
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
                    const note   = bytes[pos];
                    const velPos = pos + 1;
                    const vel    = bytes[velPos];
                    pos += 2;
                    if (vel > 0) {
                        noteOns.push({ absTime, noteNum: note, velocity: vel });
                    } else {
                        // Treat Note On with zero velocity as a note-off event.
                        noteOns.push({ absTime, noteNum: note, velocity: 0 });
                    }
                } else if (cmd === 0x8) {
                    const note   = bytes[pos];
                    // Note-off should clear the pad in the event stream.
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
 
// ── tempo helper ──────────────────────────────────────────────────
// compute effective BPM from parsed tempo changes (uses first event,
// or falls back to 120 if none found)
 
function effectiveBpm(tempoChanges) {
    if (!tempoChanges?.length) return 120;
    return Math.round(60000000 / tempoChanges[0].uspb);
}
 
// ── coordinate remapping ──────────────────────────────────────────
// the clip's note numbers may have been written with any numbering scheme.
// we use cellByExportNote (drum-rack) to map them to cells, then re-emit
// using the same export note — no remapping needed since the pipeline
// works in export-note space throughout.
// notes that don't resolve to any known cell are passed through unchanged
// so clips from other tools aren't silently broken.
 
// ── main processor ────────────────────────────────────────────────
 
/**
 * @param {object[]} noteOns  - ignored for generators (always [])
 * @param {object}   params   - { clipData, timeStretch, transpose, includeEdges }
 * @param {object}   context  - { totalDuration, timeDiv, bpm, device }
 * @returns {object[]}        - { absTime, noteNum, velocity }[]
 */
export function processClipImport(noteOns, params, context) {
    const {
        clipData      = null,   // { noteOns, timeDiv, numTrks, tempoChanges }
                                // populated by the inspector when a file is loaded
        timeStretch   = 1.0,   // scale all event timings (1.0 = original speed)
        transpose     = 0,     // shift all note numbers by this many semitones
        includeEdges  = true,  // whether to pass through non-main-grid notes
        loopToFit     = false, // repeat the clip to fill context.totalDuration
    } = params;
 
    // no clip loaded yet — return nothing
    if (!clipData?.noteOns?.length) return [];
 
    const cells = buildLaunchpadGrid(context.device ?? 'LPP2');
 
    // scale factor: convert from clip's timeDiv to context's timeDiv,
    // and apply timeStretch on top
    const scaleFactor = (context.timeDiv / clipData.timeDiv) * timeStretch;
 
    // how long the clip is in context ticks (after scaling)
    const clipMaxTick = Math.max(...clipData.noteOns.map(e => e.absTime));
    const clipDuration = Math.round(clipMaxTick * scaleFactor);
 
    const mapped = [];
 
    // how many times to loop the clip (1 = play once, no loop)
    const iterations = loopToFit && clipDuration > 0
        ? Math.ceil(context.totalDuration / clipDuration)
        : 1;
 
    for (let iter = 0; iter < iterations; iter++) {
        const offset = iter * clipDuration;
 
        for (const ev of clipData.noteOns) {
            const absTime = Math.round(ev.absTime * scaleFactor) + offset;
 
            // clip at totalDuration
            if (absTime >= context.totalDuration) continue;
 
            let noteNum = ev.noteNum + transpose;
            noteNum = Math.max(0, Math.min(127, noteNum));
 
            // If the incoming MIDI note matches a known Launchpad export note,
            // re-emit it using the same device cell. This keeps raw MIDI clips that
            // already use export-note values working cleanly.
            const cell = cellByExportNote(cells, noteNum);
            if (cell) {
                noteNum = cell.exportNote;
            }
 
            // check whether this note maps to a known cell
            if (!includeEdges) {
                if (!cell || cell.zone !== ZONE.MAIN) continue;
            }
 
            // Map MIDI velocity (0-127) to palette index range so downstream
            // transform nodes (rotate/scale/etc.) preserve the clip colour.
            const paletteLen = (context && context.palette && context.palette.length) || 16;
            let mappedVel = ev.velocity;
            if (typeof mappedVel === 'number') {
                mappedVel = Math.max(0, Math.min(paletteLen - 1,
                    Math.round((mappedVel / 127) * (paletteLen - 1))));
            }
            mapped.push({ ...ev, absTime, noteNum, velocity: mappedVel });
        }
    }
 
    mapped.sort((a, b) => a.absTime - b.absTime);
    return mapped;
}

// returns a clipData object ready to drop into params.clipData via setParam
 
/**
 * Parse a raw MIDI file Uint8Array into a clipData object.
 * Call this in the inspector when the user picks a file.
 *
 * @param {Uint8Array} bytes
 * @returns {{ noteOns, timeDiv, numTrks, tempoChanges, bpm, durationSec }}
 */
export function parseClipFile(bytes) {
    const parsed = parseMidi(bytes);
    const bpm    = effectiveBpm(parsed.tempoChanges);
 
    const maxTick    = Math.max(...parsed.noteOns.map(e => e.absTime), 0);
    const ticksPerSec = (bpm / 60) * parsed.timeDiv;
    const durationSec = maxTick / ticksPerSec;
 
    return {
        noteOns:       parsed.noteOns,
        timeDiv:       parsed.timeDiv,
        numTrks:       parsed.numTrks,
        tempoChanges:  parsed.tempoChanges,
        bpm,
        durationSec,
    };
}
