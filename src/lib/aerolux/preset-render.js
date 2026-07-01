// src/lib/aerolux/preset-render.js
// preset UI logic for Aerolux

// HTML safety ───────────────────────────────────────────────────────

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

// data normalisation ────────────────────────────────────────────────

export function normalizeVelocities(velocities, paletteLength) {
  if (!Array.isArray(velocities)) return [];
  return velocities
    .map(v => Math.round(Number(v)))
    .filter(Number.isFinite)
    .map(v => Math.max(0, Math.min(paletteLength - 1, v)));
}

export function safeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function safeImageUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? escapeAttr(url.href) : '';
  } catch { return ''; }
}

// gradient bar HTML ─────────────────────────────────────────────────
// palette: the resolved palette array ({ i, r, g, b }[])
// toHex:   the toHex(r,g,b) function from palette.js

export function buildBarHTML(velocities, palette, toHex) {
  return velocities.map((vel, i) => {
    const c = palette[vel] || palette[0];
    return `<div title="step ${i + 1} · vel ${vel}"
                 style="background:${toHex(c.r, c.g, c.b)}"></div>`;
  }).join('');
}

export function buildSweepCSS(velocities, palette, toHex) {
  const sample = velocities.length > 10
    ? velocities.filter((_, i) => i % 2 === 0)
    : velocities;
  const colors = sample.map(vel => {
    const c = palette[vel] || palette[0];
    return toHex(c.r, c.g, c.b);
  });
  if (!colors.length) return 'transparent';
  return `linear-gradient(90deg, ${colors.join(', ')})`;
}

// meta pills ────────────────────────────────────────────────────────

export function buildMetaRowHTML(algorithm, easing, length) {
  return `
    <span class="al-pm-meta-pill">${escapeHtml(algorithm)}</span>
    <span class="al-pm-meta-pill">${escapeHtml(easing)}</span>
    <span class="al-pm-meta-pill">${safeCount(length)} steps</span>
  `;
}

export function buildTagGroupHTML(colourTags) {
  return (Array.isArray(colourTags) ? colourTags : [])
    .map(t => `<span class="al-pm-tag">${escapeHtml(t)}</span>`)
    .join('');
}

// community loading animation ───────────────────────────────────────

export const MATRIX_CHARS = '0123456789-+=[]{}<>!?';

export function scramble(text) {
  return Array.from(text).map(ch =>
    ch === ' ' ? ' ' : MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]
  ).join('');
}

/**
 * starts a continuous matrix scramble animation on tag pill elements inside a container
 * picks random tags from the provided allTags array
 * automatically stops when the container is removed from the DOM
 */
export function startMatrixAnimation(container, allTags) {
  const w     = container.getBoundingClientRect().width || 200;
  const count = Math.max(3, Math.floor((w - 24) / 68));
  const chosen = Array.from({ length: count }, () =>
    allTags[Math.floor(Math.random() * allTags.length)]
  );

  chosen.forEach(tag => {
    const pill      = document.createElement('span');
    pill.className  = 'al-pm-loading-tag';
    pill.textContent = scramble(tag);
    container.appendChild(pill);

    const iv = setInterval(() => {
      if (!container.isConnected) { clearInterval(iv); return; }
      pill.textContent = scramble(tag);
    }, 80);
  });
}

/**
 * renders community loading placeholder cards before real data arrives
 * inserts them before the sentinel element inside the list container
 */
export function renderCommunityLoadingCards(listEl, sentinelEl, allTags) {
  const listH = listEl.getBoundingClientRect().height || 400;
  const count = Math.max(2, Math.floor(listH / 130));

  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'al-pm-loading-card';
    card.innerHTML = `
      <div class="al-pm-loading-bar"></div>
      <div class="al-pm-loading-tags"></div>
      <div class="al-pm-loading-hint">Fetching community gradients…</div>
      <div class="al-pm-loading-scanlines"></div>
    `;
    listEl.insertBefore(card, sentinelEl);
  }

  requestAnimationFrame(() => {
    listEl.querySelectorAll('.al-pm-loading-tags')
      .forEach(container => startMatrixAnimation(container, allTags));
  });
}

export function clearLoadingCards(listEl) {
  listEl.querySelectorAll('.al-pm-loading-card').forEach(el => el.remove());
}