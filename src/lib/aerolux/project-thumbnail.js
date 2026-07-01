// project-thumbnail.js
// generates base64 SVG data URIs for project thumbnails, embedded directly inside .alx files.

import { toHex } from './palette.js';
import { buildGradient } from './gradient.js';

// velocity ──────────────────────────────────────────────────────────

/**
 * renders the current gradient as a horizontal strip of coloured
 * rectangles, encoded as a base64 SVG data URI.
 *
 * builds gradResult fresh from editor state rather than depending on
 * a separately-computed value, so the thumbnail is always correct
 * even if called from a context where gradResult() isn't available
 * (e.g. before the velocity workspace has mounted).
 */
export function buildVelocityThumbnail(editorState, width = 320, height = 80) {
  let result;
  try {
    result = buildGradient(
      editorState.stops,
      editorState.palette,
      editorState.algorithm,
      editorState.easing,
      editorState.steps,
      editorState.tint,
      editorState.envelope,
      editorState.antiRepeat,
      editorState.hueShift,
      editorState.hslDir,
    );
  } catch {
    return null; // malformed state: skip thumbnail rather than throw on save
  }

  if (!result?.length) return null;

  const segW = width / result.length;
  const rects = result.map(({ velocity }, i) => {
    const c = editorState.palette[velocity] ?? editorState.palette[0];
    const x = (i * segW).toFixed(2);
    const w = (segW + 0.5).toFixed(2); // slight overlap avoids hairline seams
    return `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${toHex(c.r, c.g, c.b)}" />`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`;
  return svgToDataUri(svg);
}

// kinetic (stub) ────────────────────────────────────────────────────

/**
 * renders the final 8x8 pad state as a grid of coloured squares, OR shows node preview
 * stubbed until kinetic.svelte.js exists, returns null so callers
 * can fall back to a placeholder thumbnail in the UI.
 */
export function buildKineticThumbnail(/* kineticState */) {
  return null;
}

// shared ────────────────────────────────────────────────────────────

function svgToDataUri(svg) {
  const base64 = typeof window !== 'undefined' && window.btoa
    ? window.btoa(unescape(encodeURIComponent(svg)))
    : Buffer.from(svg, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}