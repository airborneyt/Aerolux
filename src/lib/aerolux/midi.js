// src/lib/aerolux/midi.js
// MIDI file parsing, SysEx communication, and Launchpad animation

// airborne's planning
  // ableton live uses a split chromatic note layout
  // left 4 columns cover midi 36 (c1) to midi 67 😂 (g3), 4 notes per row going up
  // right 4 columns continue with midi 68 (g#3) to midi 99 (d#6) following the same pattern
  // we will ignore the side buttons

  // to convert this to the coordinate-based pad positions defined earlier, we can some formulas
  // left column: midi = 36 + row * 4 + col
  // right column: midi = 68 + row * 4 + (col - 4)
  // row 0 is the bottom, row 7 is the top
//

import { buildLaunchpadGrid, cellByExportNote, cellAt, ZONE } from './midi-layout.js';

const _cells = buildLaunchpadGrid('LPP3');
export const NOTE_TO_CELL = {};
export const CELL_TO_NOTE = {};
for (const cell of _cells) {
    if (cell.zone !== ZONE.MAIN || cell.exportNote === null) continue;
    NOTE_TO_CELL[cell.exportNote] = { row: cell.y - 1, col: cell.x - 1 };
    CELL_TO_NOTE[`${cell.y - 1}_${cell.x - 1}`] = cell.exportNote;
}

export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function noteName(midi) {
  const octave = Math.floor(midi / 12) - 2;
  return NOTE_NAMES[midi % 12] + octave;
}

// this code has been retrofitted to utilise the new implementation in midi-layout.js
// it is only used by velocity's live gradient preview
// any new code must only use midi-layout.js and avoid referencing this

// binary midi parser that only requires note on/off signals
export function readVarLen(bytes, pos) {
  let val = 0;
  do {
    if (pos >= bytes.length) break;
    val = (val << 7) | (bytes[pos] & 0x7F);
  } while (bytes[pos++] & 0x80);
  return {val, pos};
}

export function parseMidiFile(bytes) {
  // validate the file
  if (bytes[0]!==0x4D||bytes[1]!==0x54||bytes[2]!==0x68||bytes[3]!==0x64)
    throw new Error('Not a valid MIDI file (missing MThd)');

  const hdrLen  = (bytes[4]<<24)|(bytes[5]<<16)|(bytes[6]<<8)|bytes[7];
  const format  = (bytes[8]<<8)|bytes[9];
  const numTrks = (bytes[10]<<8)|bytes[11];
  const timeDiv = (bytes[12]<<8)|bytes[13];

  if (format > 1) throw new Error(`MIDI format ${format} not supported (need 0 or 1)`);

  // collect all note on events with their byte positions in the file
  // store the positions so the gradient can be patched in-place during injection
  const noteOns = []; // {absTime, noteNum, velocity, velBytePos}

  let filePos = 8 + hdrLen;
  for (let t = 0; t < numTrks; t++) {
    if (filePos + 8 > bytes.length) break;
    const tag = String.fromCharCode(bytes[filePos],bytes[filePos+1],bytes[filePos+2],bytes[filePos+3]);
    const trkLen = (bytes[filePos+4]<<24)|(bytes[filePos+5]<<16)|(bytes[filePos+6]<<8)|bytes[filePos+7];
    filePos += 8;
    if (tag !== 'MTrk') { filePos = filePos - 8 + 8 + trkLen; continue; } // skip non-track chunks
    const trkEnd = filePos + trkLen;
    let pos = filePos;
    let absTime = 0;
    let runStat = 0;

    while (pos < trkEnd) {
      const vl = readVarLen(bytes, pos); pos = vl.pos;
      absTime += vl.val;

      const sb = bytes[pos];
      if (sb === 0xFF) {
        pos++;
        const mt = bytes[pos++];
        const ml = readVarLen(bytes, pos); pos = ml.pos + ml.val;
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
          const note = bytes[pos]; const velPos = pos + 1; const vel = bytes[velPos];
          pos += 2;
          if (vel > 0) {
            noteOns.push({absTime, noteNum: note, velocity: vel, velBytePos: pos - 1});
          }
        } else if (cmd === 0x8 || cmd === 0xA || cmd === 0xB || cmd === 0xE) {
          pos += 2;
        } else if (cmd === 0xC || cmd === 0xD) {
          pos += 1;
        }
      }
    }
    filePos = trkEnd;
  }
  return {format, numTrks, timeDiv, noteOns};
}

// detect the gradient and grab the velocity info
export function detectGradient(noteOns) {
  const seen    = new Set();
  const ordered = [];
  // sort by absolute time to grab the movement of the light effect
  const sorted = [...noteOns].sort((a,b) => a.absTime - b.absTime);
  for (const ev of sorted) {
    if (!seen.has(ev.velocity)) {
      seen.add(ev.velocity);
      ordered.push(ev.velocity);
    }
  }
  return ordered;
}

// injecting the new gradient
export function injectGradient(bytes, noteOns, oldGradVels, newGradResult) {
  const clone = new Uint8Array(bytes); // copy

  // build mapping
  const velMap = {};
  oldGradVels.forEach((oldVel, idx) => {
    const newVel = newGradResult[idx % newGradResult.length]?.velocity ?? oldVel;
    velMap[oldVel] = newVel;
  });

  // patch each note on's velocity byte
  for (const ev of noteOns) {
    if (ev.velocity in velMap) {
      clone[ev.velBytePos] = velMap[ev.velocity];
    }
  }
  return clone;
}

// 15.2
// build rgb data for one animation frame
// returns: array of {note, r, g, b}. one entry per pad that has a colour
export function buildAnimFrame(frameIdx, gradResult = [], palette = []) {
  if (!gradResult.length || !palette.length) return [];
  const len    = gradResult.length;
  const leds   = [];

  for (let row=0; row<8; row++) {
    for (let col=0; col<8; col++) {
      // pad's linear index in reading order programmer order
      const padIdx  = row * 8 + col;
      const stepIdx = (padIdx + frameIdx) % len;
      const vel     = gradResult[stepIdx]?.velocity ?? 0;
      const c       = palette[vel] || palette[0];
      const lpPad = (row + 1) * 10 + (col + 1);
      leds.push({note: lpPad, r: c.r, g: c.g, b: c.b});
    }
  }
  return leds;
}

// 15.3
// CONNECT_LIGHTSHOW is the framework for the animations
// frame format:
//   bare array  (uses frameDuration): [{note,r,g,b}, …]
//   object with override (custom ms per frame): {duration:200, leds:[{note,r,g,b}, …]}
//
// uses coordinate-based pad layout defined earlier

export const CONNECT_LIGHTSHOW = {
  frameDuration: 20,
  clearFirst: true,
  clearAfter: true,
  frames: [
    [
      {note:52, r:3, g:3, b:3}, {note:54, r:3, g:3, b:3}, {note:55, r:3, g:3, b:3}, {note:57, r:3, g:3, b:3}, {note:43, r:3, g:3, b:3}, {note:46, r:3, g:3, b:3}, {note:34, r:3, g:3, b:3}, {note:35, r:3, g:3, b:3}
    ],
    [
      {note:52, r:13, g:13, b:13}, {note:54, r:13, g:13, b:13}, {note:55, r:13, g:13, b:13}, {note:57, r:13, g:13, b:13}, {note:43, r:13, g:13, b:13}, {note:46, r:13, g:13, b:13}, {note:34, r:13, g:13, b:13}, {note:35, r:13, g:13, b:13}
    ],
    [
      {note:52, r:23, g:23, b:23}, {note:54, r:23, g:23, b:23}, {note:55, r:23, g:23, b:23}, {note:57, r:23, g:23, b:23}, {note:43, r:23, g:23, b:23}, {note:46, r:23, g:23, b:23}, {note:34, r:23, g:23, b:23}, {note:35, r:23, g:23, b:23}
    ],
    [
      {note:52, r:33, g:33, b:33}, {note:54, r:33, g:33, b:33}, {note:55, r:33, g:33, b:33}, {note:57, r:33, g:33, b:33}, {note:43, r:33, g:33, b:33}, {note:46, r:33, g:33, b:33}, {note:34, r:33, g:33, b:33}, {note:35, r:33, g:33, b:33}
    ],
    [
      {note:52, r:43, g:43, b:43}, {note:54, r:43, g:43, b:43}, {note:55, r:43, g:43, b:43}, {note:57, r:43, g:43, b:43}, {note:43, r:43, g:43, b:43}, {note:46, r:43, g:43, b:43}, {note:34, r:43, g:43, b:43}, {note:35, r:43, g:43, b:43}
    ],
    [
      {note:52, r:53, g:53, b:53}, {note:54, r:53, g:53, b:53}, {note:55, r:53, g:53, b:53}, {note:57, r:53, g:53, b:53}, {note:43, r:53, g:53, b:53}, {note:46, r:53, g:53, b:53}, {note:34, r:53, g:53, b:53}, {note:35, r:53, g:53, b:53}
    ],
    { duration: 520, leds: [
      {note:52, r:63, g:63, b:63}, {note:54, r:63, g:63, b:63}, {note:55, r:63, g:63, b:63}, {note:57, r:63, g:63, b:63}, {note:43, r:63, g:63, b:63}, {note:46, r:63, g:63, b:63}, {note:34, r:63, g:63, b:63}, {note:35, r:63, g:63, b:63}
    ]},
{ duration: 40, leds:[
      {note:52, r:63, g:16, b:53}, {note:43, r:63, g:63, b:63}, {note:54, r:63, g:63, b:63}, {note:34, r:63, g:63, b:63}, {note:55, r:63, g:63, b:63}, {note:35, r:63, g:63, b:63}, {note:46, r:63, g:63, b:63}, {note:57, r:63, g:63, b:63}
    ]},
{ duration: 40, leds:[    
      {note:52, r:63, g:0, b:50}, {note:43, r:63, g:16, b:53}, {note:54, r:63, g:63, b:63}, {note:34, r:63, g:63, b:63}, {note:55, r:63, g:63, b:63}, {note:35, r:63, g:63, b:63}, {note:46, r:63, g:63, b:63}, {note:57, r:63, g:63, b:63}
    ]},
{ duration: 40, leds:[
      {note:52, r:40, g:12, b:47}, {note:43, r:63, g:0, b:50}, {note:54, r:63, g:16, b:53}, {note:34, r:63, g:16, b:53}, {note:55, r:63, g:63, b:63}, {note:35, r:63, g:63, b:63}, {note:46, r:63, g:63, b:63}, {note:57, r:63, g:63, b:63}
    ]},
{ duration: 40, leds:[
      {note:52, r:12, g:12, b:47}, {note:43, r:40, g:12, b:47}, {note:54, r:63, g:0, b:50}, {note:34, r:63, g:0, b:50}, {note:55, r:63, g:16, b:53}, {note:35, r:63, g:16, b:53}, {note:46, r:63, g:63, b:63}, {note:57, r:63, g:63, b:63}
    ]},
{ duration: 40, leds:[
      {note:52, r:8, g:26, b:32}, {note:43, r:12, g:12, b:47}, {note:54, r:40, g:12, b:47}, {note:34, r:40, g:12, b:47}, {note:55, r:63, g:0, b:50}, {note:35, r:63, g:0, b:50}, {note:46, r:63, g:16, b:53}, {note:57, r:63, g:63, b:63}
    ]},
{ duration: 40, leds:[
      {note:52, r:47, g:40, b:12}, {note:43, r:8, g:26, b:32}, {note:54, r:12, g:12, b:47}, {note:34, r:12, g:12, b:47}, {note:55, r:40, g:12, b:47}, {note:35, r:40, g:12, b:47}, {note:46, r:63, g:0, b:50}, {note:57, r:63, g:16, b:53}
    ]},
{ duration: 40, leds:[
      {note:52, r:63, g:50, b:0}, {note:43, r:47, g:40, b:12}, {note:54, r:8, g:26, b:32}, {note:34, r:8, g:26, b:32}, {note:55, r:12, g:12, b:47}, {note:35, r:12, g:12, b:47}, {note:46, r:40, g:12, b:47}, {note:57, r:63, g:0, b:50}
    ]},
{ duration: 40, leds:[
      {note:52, r:47, g:38, b:0}, {note:43, r:63, g:50, b:0}, {note:54, r:47, g:40, b:12}, {note:34, r:47, g:40, b:12}, {note:55, r:8, g:26, b:32}, {note:35, r:8, g:26, b:32}, {note:46, r:12, g:12, b:47}, {note:57, r:40, g:12, b:47}
    ]},
{ duration: 40, leds:[
      {note:52, r:16, g:12, b:0}, {note:43, r:32, g:25, b:0}, {note:54, r:47, g:38, b:0}, {note:34, r:47, g:38, b:0}, {note:55, r:47, g:40, b:12}, {note:35, r:47, g:40, b:12}, {note:46, r:8, g:26, b:32}, {note:57, r:12, g:12, b:47}
    ]},
{ duration: 40, leds:[
      {note:52, r:0, g:0, b:0}, {note:43, r:16, g:12, b:0}, {note:54, r:32, g:25, b:0}, {note:34, r:32, g:25, b:0}, {note:55, r:47, g:38, b:0}, {note:35, r:47, g:38, b:0}, {note:46, r:47, g:40, b:12}, {note:57, r:8, g:26, b:32}
    ]},
{ duration: 40, leds:[
      {note:52, r:0, g:0, b:0}, {note:43, r:0, g:0, b:0}, {note:54, r:16, g:12, b:0}, {note:34, r:16, g:12, b:0}, {note:55, r:32, g:25, b:0}, {note:35, r:32, g:25, b:0}, {note:46, r:47, g:38, b:0}, {note:57, r:47, g:40, b:12}
    ]},
{ duration: 40, leds:[
      {note:52, r:0, g:0, b:0}, {note:43, r:0, g:0, b:0}, {note:54, r:0, g:0, b:0}, {note:34, r:0, g:0, b:0}, {note:55, r:16, g:12, b:0}, {note:35, r:16, g:12, b:0}, {note:46, r:32, g:25, b:0}, {note:57, r:47, g:38, b:0}
    ]},
{ duration: 40, leds:[
      {note:52, r:0, g:0, b:0}, {note:43, r:0, g:0, b:0}, {note:54, r:0, g:0, b:0}, {note:34, r:0, g:0, b:0}, {note:55, r:0, g:0, b:0}, {note:35, r:0, g:0, b:0}, {note:46, r:16, g:12, b:0}, {note:57, r:32, g:25, b:0}
    ]},
{ duration: 40, leds:[
      {note:52, r:0, g:0, b:0}, {note:43, r:0, g:0, b:0}, {note:54, r:0, g:0, b:0}, {note:34, r:0, g:0, b:0}, {note:55, r:0, g:0, b:0}, {note:35, r:0, g:0, b:0}, {note:46, r:0, g:0, b:0}, {note:57, r:16, g:12, b:0}
    ]},
{ duration: 100, leds:[
      {note:52, r:0, g:0, b:0}, {note:43, r:0, g:0, b:0}, {note:54, r:0, g:0, b:0}, {note:34, r:0, g:0, b:0}, {note:55, r:0, g:0, b:0}, {note:35, r:0, g:0, b:0}, {note:46, r:0, g:0, b:0}, {note:57, r:0, g:0, b:0}
    ]}     
  ],  
};

export function playLightshow(output, show) {
  if(!output) return Promise.resolve();
  return new Promise(resolve=>{
    let fi=0;
    const sendLeds=leds=>{
      const pd=leds.flatMap(({note,r,g,b})=>[note,r,g,b]);
      output.send([0xF0,0x00,0x20,0x29,0x02,0x10,0x0B,...pd,0xF7]);
    };
    const clearAll=()=>{
      const pd=[];
      for(let r=1;r<=8;r++) for(let c=1;c<=8;c++) pd.push(r*10+c,0,0,0);
      output.send([0xF0,0x00,0x20,0x29,0x02,0x10,0x0B,...pd,0xF7]);
    };
    if(show.clearFirst) clearAll();
    function tick(){
      if(fi>=show.frames.length){if(show.clearAfter)clearAll();resolve();return;}
      const frame=show.frames[fi];
      const isObj=!Array.isArray(frame);
      const leds=isObj?frame.leds:frame;
      const dur =isObj?frame.duration:show.frameDuration;
      if(leds.length) sendLeds(leds);
      fi++;
      setTimeout(tick,dur);
    }
    setTimeout(tick,show.clearFirst?show.frameDuration:0);
  });
}
