// project-thumbnail.js
// generates base64 SVG data URIs for project thumbnails, embedded directly inside .alx files.

import { toHex } from './palette.js';
import { buildGradient } from './gradient.js';
import { NODE_DEFS } from './kinetic/nodeRegistry.js';

// velocity ──────────────────────────────────────────────────────────

/**
  renders the current gradient as a horizontal strip of coloured
  rectangles, encoded as a base64 SVG data URI.

  builds gradResult fresh from editor state rather than depending on
  a separately-computed value, so the thumbnail is always correct
  even if called from a context where gradResult() isn't available
  (e.g. before the velocity workspace has mounted).
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

// kinetic ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––

const KINETIC_CATEGORY_COLOR = {
    generator: 'hsl(270,65%,60%)', transform: 'hsl(210,70%,55%)', colour: 'hsl(38,80%,58%)',
    temporal: 'hsl(190,65%,50%)', utility: 'hsl(220,20%,55%)', simulation: 'hsl(150,55%,50%)',
};

function countKineticNodesByCategory(instances, counts = new Map()) {
    for (const inst of instances) {
        const def = NODE_DEFS[inst.nodeId];
        if (def && !def.internal) counts.set(def.category, (counts.get(def.category) ?? 0) + 1);
        if (inst.subgraph?.nodeInstances) countKineticNodesByCategory(inst.subgraph.nodeInstances, counts);
    }
    return counts;
}

/**
  a horizontal bar of proportional colour segments, one per node category
  present in the graph (counted recursively, including inside nested
  composites). returns null for an empty graph (no nodes). RecentProjectsList
  falls back to a type icon (⟁) when thumbnail is null.

@param {{rootInstances:Array, devices:Array}} kineticState
@param {number} [width]
@param {number} [height]
@returns {string|null}
*/
export function buildKineticThumbnail(kineticState, width = 320, height = 80) {
    try {
        const counts = countKineticNodesByCategory(kineticState?.rootInstances ?? []);
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        if (!total) return null;

        const segments = [];
        let x = 0;
        for (const [category, count] of counts) {
            const segWidth = (count / total) * width;
            const colour = KINETIC_CATEGORY_COLOR[category] ?? 'hsl(220,20%,55%)';
            segments.push(`<rect x="${x - 0.5}" y="0" width="${segWidth + 1}" height="${height}" fill="${colour}" />`);
            x += segWidth;
        }

        const deviceCount = kineticState?.devices?.length ?? 0;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            ${segments.join('')}
            <text x="6" y="${height - 6}" font-family="monospace" font-size="10" fill="rgba(255,255,255,0.55)">${total} node${total === 1 ? '' : 's'} · ${deviceCount} device${deviceCount === 1 ? '' : 's'}</text>
        </svg>`;

        return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
        return null;
    }
}

// shared ────────────────────────────────────────────────────────────

function svgToDataUri(svg) {
  const base64 = typeof window !== 'undefined' && window.btoa
    ? window.btoa(unescape(encodeURIComponent(svg)))
    : Buffer.from(svg, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}