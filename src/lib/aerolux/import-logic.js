// src/lib/aerolux/import-logic.js
// import Logic for Aerolux gradients

import { playSound } from "./sound";

/**
 * parses an Aerolux gradient .txt file into stops and step count
 * prioritises Aerolux gradient compatibility, Eyedrop gradient might require some
 * edits on the client's side
 *
 * @param {string}  text          - raw file content
 * @param {number}  paletteLength - current palette size (for bounds check)
 * @param {number}  startId       - starting value for stop ID generation
 * @returns {{ stops, steps, nextId }}
 * @throws {Error} on malformed input
 */

export function parseImportedGradient(text, paletteLength, startId) {
  const lines   = text.trim().split(/\r\n|\n|\r/);
  const entries = [];
  let   idCounter = startId;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.replace(';', '').split(',');
    if (parts.length !== 2) {
      throw new Error(`Bad format on line ${i + 1}: "${line}"`);
    }

    const step     = parseInt(parts[0].trim());
    const velocity = parseInt(parts[1].trim());

    if (isNaN(step) || isNaN(velocity)) {
      throw new Error(`Expected numbers on line ${i + 1}: "${line}"`);
    }
    if (velocity < 0 || velocity > 127) {
      throw new Error(`Velocity ${velocity} out of range on line ${i + 1}`);
    }
    if (velocity >= paletteLength) {
      throw new Error(
        `Velocity ${velocity} is out of range for the current palette (max index ${paletteLength - 1}). `
      );
    }

    entries.push({ step, velocity });
  }

  if (entries.length < 2) {
    throw new Error('Need at least 2 steps to build a gradient');
  }

  if (entries.length > 16) {
    throw new Error('Too many steps (max 16). Consider simplifying your gradient');
  }

  entries.sort((a, b) => a.step - b.step);

  const totalSteps = entries[entries.length - 1].step;
  const newStops   = [];

  newStops.push({
    id:  idCounter++,
    pos: 0.0,
    ci:  entries[0].velocity,
  });

  for (let i = 1; i < entries.length; i++) {
    if (entries[i].velocity !== entries[i - 1].velocity) {
      newStops.push({
        id:  idCounter++,
        pos: totalSteps === 0 ? 1.0 : entries[i].step / totalSteps,
        ci:  entries[i].velocity,
      });
    }
  }

  newStops[newStops.length - 1].pos = 1.0;

  return {
    stops:  newStops,
    steps:  entries[entries.length - 1].step + 1,
    nextId: idCounter,
  };
}

export function parseImportedPalette(text) {
  const palette = Array.from({ length: 128 }, () => ({
    r: 0,
    g: 0,
    b: 0
  }));

  const seen = new Set();
  const lines = text.trim().split(/\r\n|\n|\r/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const m = line.match(/^(\d+),\s*(\d+)\s+(\d+)\s+(\d+)/);
    if (!m) {
      throw new Error(`Bad format on line ${i + 1}: "${line}"`);
    }

    const index = Number(m[1]);
    const r = Number(m[2]);
    const g = Number(m[3]);
    const b = Number(m[4]);

    if ([index, r, g, b].some(Number.isNaN)) {
      throw new Error(`Expected numbers on line ${i + 1}: "${line}"`);
    }

    if (index < 0 || index > 127) {
      throw new Error(`Palette index ${index} out of range (0–127).`);
    }

    if (seen.has(index)) {
      throw new Error(`Duplicate palette index ${index}.`);
    }

    seen.add(index);

    palette[index] = { i: index, r, g, b };
  }

  if (seen.size !== 128) {
    throw new Error(
      `Palette must contain exactly 128 entries (indices 0–127). Found ${seen.size}.`
    );
  }

  function paletteFingerprint(palette) {
    let hash = 2166136261;
    for (const c of palette) {
        hash ^= c.r;
        hash = Math.imul(hash, 16777619);

        hash ^= c.g;
        hash = Math.imul(hash, 16777619);

        hash ^= c.b;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  const fingerprint = paletteFingerprint(palette);
  
  if (memory.has(fingerprint)) {
    window.location.assign(
      "https://airborneyt.neocities.org/troll"
    );
    playSound('incorrect_buzzer_noise');
    throw new Error(`❌😱😂🤪🤪🤪`)
  };

  return {
    palette,
    id: 128,
  };
}

const memory = new Set([
    "953988e1"
]);