// src/lib/aerolux/palette-panel.js
// palette grid, sort tabs, swatch pick, tint pick, keyboard navigation 
// calls initPalettePanel(callbacks)
// returns { renderDOM, render, focusSwatch, getHoveredSwatchIdx,
//           getGridCols, getSwatchEls, setPickingTint }

import { toHex, toHSL, indexAt, getSortedPalette } from './palette.js';

// hue bucket helper ─────────────────────────────────────────────────
// returns a hue name for a palette entry, or null for greyscale
function _hueOf(c) {
  const { h, s } = toHSL(c.r, c.g, c.b);
  if (s < 0.08) return null; // greyscale
  if (h >= 0.95 || h < 0.05) return 'red';
  if (h < 0.13) return 'orange';
  if (h < 0.21) return 'yellow';
  if (h < 0.45) return 'green';
  if (h < 0.68) return 'blue';
  if (h < 0.85) return 'purple';
  return 'pink';
}

function _brightnessOf(c) {
  const { l } = toHSL(c.r, c.g, c.b);
  if (l >= 0.45) return 'bright';
  if (l >= 0.30) return 'muted';
  if (l >= 0.18) return 'dim';
  return 'dark';
}

export function initPalettePanel({
  getPalette,
  getStops,
  getSelStop,
  setSelStop,
  getStepCount,
  getTint,
  getGradResult,
  onSwatchSelected,
  onTintColourPicked,
  isPickingTint,
  setPickingTint,
  onSwatchPickChanged,
  getSwatchOrder,
  getSortMode,
}) {
  let hoveredSwatchIdx = 0;
  const paletteSwatchMap = new Map();

  // highlight update (fast path) ────────────────────────────────────

  function render() {
    const palette     = getPalette();
    const stops       = getStops();
    const gradResult  = getGradResult();
    const tint        = getTint();
    const sortMode    = getSortMode();
    const swatchOrder = getSwatchOrder();
    const hasFilter   = swatchOrder.length > 0;

    const stopCis = new Set(stops.map(s => s.ci));
    const gradCis = new Set(gradResult.map(g => g.velocity));

    paletteSwatchMap.forEach((el, ci) => {
      el.classList.toggle('is-stop',      stopCis.has(ci));
      el.classList.toggle('is-tint',      ci === tint.ci);
      el.classList.toggle('in-grad',      gradCis.has(ci) && !stopCis.has(ci) && ci !== tint.ci);
      el.classList.toggle('sw-pick',      sortMode === 'swatch' && swatchOrder.includes(ci));
      el.classList.toggle('picking-tint', isPickingTint());
    });

    // filter indicator above grid
    const indicator = document.getElementById('swpick-filter-indicator');
    if (indicator) {
      if (hasFilter && sortMode !== 'swatch') {
        indicator.style.display = 'flex';
        indicator.querySelector('#swpick-filter-count').textContent =
          `${swatchOrder.length} colour${swatchOrder.length !== 1 ? 's' : ''} filtered`;
      } else {
        indicator.style.display = 'none';
      }
    }

    _focusSwatchHighlight();
  }

  // full DOM rebuild ────────────────────────────────────────────────

  function renderDOM() {
    const palette     = getPalette();
    const sortMode    = getSortMode();
    const swatchOrder = getSwatchOrder();
    const hasFilter   = swatchOrder.length > 0;
    const filterSet   = new Set(swatchOrder);

    const grid = document.getElementById('palette-grid');
    grid.innerHTML = '';
    paletteSwatchMap.clear();

    function addSwatch(c) {
  const el = document.createElement('div');

  if (c.i === 0) {
    el.className     = 'al-sw al-sw-disabled';
    el.style.cssText = 'opacity:0.2;cursor:not-allowed';
    el.title         = 'Index 0 is invalid.';
    grid.appendChild(el);
    return;
  }

  const isFiltered = sortMode !== 'swatch' && hasFilter && !filterSet.has(c.i);

  // non-original modes: skip filtered swatches entirely
  if (isFiltered && sortMode !== 'original') return;

  el.className        = 'al-sw';
  el.style.background = toHex(c.r, c.g, c.b);

  if (isFiltered) {
    // original mode: keep in place but dim and non-interactive
    el.classList.add('al-sw-filtered-out');
    el.style.cssText = `background:${toHex(c.r, c.g, c.b)};opacity:0.1;cursor:not-allowed;pointer-events:none`;
    el.title = '';
    grid.appendChild(el);
    return;
  }

  el.title      = `${c.i}: (${c.r},${c.g},${c.b}) ${toHex(c.r,c.g,c.b)}`;
  el.dataset.ci = c.i;
  el.addEventListener('click', _onSwatchClick);
  el.addEventListener('mouseenter', () => {
    document.getElementById('hover-info').textContent = `#${c.i} · ${toHex(c.r,c.g,c.b)}`;
  });
  el.addEventListener('mouseleave', () => {
    document.getElementById('hover-info').textContent = '';
  });
  paletteSwatchMap.set(c.i, el);
  grid.appendChild(el);
}

    if (sortMode === 'original') {
      grid.style.gridTemplateColumns = 'repeat(16,1fr)';
      grid.style.gridTemplateRows = 'repeat(8,1fr)';
      for (let cssRow = 0; cssRow < 8; cssRow++) {
        const rfb = 7 - cssRow;
        for (let col = 0; col < 16; col++) {
          const idx = indexAt(col, rfb);
          if (idx < 0 || idx >= palette.length) continue;
          addSwatch(palette[idx]);
        }
      }
    } else if (sortMode === 'swatch') {
      grid.style.gridTemplateColumns = 'repeat(16,1fr)';
      grid.style.gridTemplateRows    = '';
      // selected first, then unselected
      const rest = palette.map(c => c.i).filter(i => i !== 0 && !filterSet.has(i));
      [...swatchOrder, ...rest].forEach(ci => {
        const c = palette[ci];
        if (c) addSwatch(c);
      });
    } else {
      grid.style.gridTemplateColumns = 'repeat(16,1fr)';
      grid.style.gridTemplateRows    = '';
      getSortedPalette(palette, sortMode, swatchOrder).forEach(c => addSwatch(c));
    }

    const visibleCount = hasFilter && sortMode !== 'swatch'
      ? swatchOrder.length
      : palette.length - 1; // exclude index 0
    document.getElementById('palette-count').textContent = hasFilter && sortMode !== 'swatch'
      ? `${visibleCount} of ${palette.length - 1} colours`
      : `${palette.length - 1} colours`;

    _updateQuickSelectButtons();
    render();
  }

  // swatch click ────────────────────────────────────────────────────

  function _onSwatchClick(e) {
    const ci = parseInt(e.currentTarget.dataset.ci);
    if (isPickingTint()) {
      onTintColourPicked(ci);
      setPickingTint(false);
      return;
    }
    if (getSortMode() === 'swatch') {
      const swatchOrder = getSwatchOrder();
      const newOrder = swatchOrder.includes(ci)
        ? swatchOrder.filter(i => i !== ci)
        : [...swatchOrder, ci];
      onSwatchPickChanged(newOrder);
      return;
    }
    onSwatchSelected(ci);
  }

  // quick-select helpers ────────────────────────────────────────────

  function _selectByPredicate(pred) {
    const palette = getPalette();
    const current = new Set(getSwatchOrder());
    const matching = palette.filter(c => c.i !== 0 && pred(c)).map(c => c.i);
    // toggle: if all matching are already selected, deselect them; otherwise add all
    const allSelected = matching.every(ci => current.has(ci));
    let newOrder;
    if (allSelected) {
      newOrder = getSwatchOrder().filter(ci => !matching.includes(ci));
    } else {
      const toAdd = matching.filter(ci => !current.has(ci));
      newOrder = [...getSwatchOrder(), ...toAdd];
    }
    onSwatchPickChanged(newOrder);
  }

  function _updateQuickSelectButtons() {
    if (getSortMode() !== 'swatch') return;
    const palette     = getPalette();
    const swatchOrder = getSwatchOrder();
    const selected    = new Set(swatchOrder);

    document.querySelectorAll('.swpick-quick-btn').forEach(btn => {
      const type  = btn.dataset.type;
      const value = btn.dataset.value;
      let matching;

      if (type === 'hue') {
        matching = palette.filter(c => c.i !== 0 && _hueOf(c) === value).map(c => c.i);
      } else if (type === 'brightness') {
        matching = palette.filter(c => c.i !== 0 && _brightnessOf(c) === value).map(c => c.i);
      } else if (type === 'region') {
        if (value === 'deep')   matching = palette.filter(c => c.i >= 8  && c.i <= 67).map(c => c.i);
        if (value === 'pastel') matching = palette.filter(c => c.i >= 68 && c.i <= 127).map(c => c.i);
        if (value === 'grey')   matching = palette.filter(c => c.i >= 1  && c.i <= 7).map(c => c.i);
      }

      if (!matching) return;
      const allSelected = matching.length > 0 && matching.every(ci => selected.has(ci));
      btn.classList.toggle('active', allSelected);
    });
  }

  // wire quick-select buttons
  document.addEventListener('click', e => {
    const btn = e.target.closest('.swpick-quick-btn');
    if (!btn || getSortMode() !== 'swatch') return;
    const type  = btn.dataset.type;
    const value = btn.dataset.value;

    if (type === 'hue') {
      _selectByPredicate(c => _hueOf(c) === value);
    } else if (type === 'brightness') {
      _selectByPredicate(c => _brightnessOf(c) === value);
    } else if (type === 'region') {
      if (value === 'deep')   _selectByPredicate(c => c.i >= 8  && c.i <= 67);
      if (value === 'pastel') _selectByPredicate(c => c.i >= 68 && c.i <= 127);
      if (value === 'grey')   _selectByPredicate(c => c.i >= 1  && c.i <= 7);
    }
  });

  // keyboard navigation ─────────────────────────────────────────────

  function getSwatchEls() {
    return Array.from(document.querySelectorAll('#palette-grid .al-sw'));
  }

  function getGridCols() {
    const grid  = document.getElementById('palette-grid');
    const style = window.getComputedStyle(grid);
    return style.gridTemplateColumns.split(' ').length || 16;
  }

  function getHoveredSwatchIdx() { return hoveredSwatchIdx; }

  function focusSwatch(idx) {
    const swatches = getSwatchEls();
    if (!swatches.length) return;
    const len  = swatches.length;
    const step = idx >= hoveredSwatchIdx ? 1 : -1;
    let candidate = ((idx % len) + len) % len;
    let attempts  = len;
    while (attempts-- > 0 && swatches[candidate]?.classList.contains('al-sw-disabled')) {
      candidate = ((candidate + step) + len) % len;
    }
    if (swatches[candidate]?.classList.contains('al-sw-disabled')) return;
    hoveredSwatchIdx = candidate;
    _focusSwatchHighlight();
    swatches[hoveredSwatchIdx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function _focusSwatchHighlight() {
    const swatches = getSwatchEls();
    swatches.forEach(el => { el.style.outline = ''; el.style.zIndex = ''; });
    const target = swatches[hoveredSwatchIdx];
    if (target && !target.classList.contains('al-sw-disabled')) {
      target.style.outline = '2.5px solid white';
      target.style.zIndex  = '30';
    }
  }

  // swatch pick bar ─────────────────────────────────────────────────

  function renderSwatchPickBar() {
    const palette     = getPalette();
    const swatchOrder = getSwatchOrder();
    document.getElementById('swpick-order').innerHTML =
      swatchOrder.map(ci => {
        const c = palette[ci] || palette[0];
        return `<div class="al-sw-chip" title="Index ${ci}" style="background:${toHex(c.r,c.g,c.b)}"></div>`;
      }).join('');

    const countEl = document.getElementById('swpick-count');
    if (countEl) countEl.textContent = swatchOrder.length
      ? `${swatchOrder.length} selected`
      : 'None selected. Click swatches or use quick-select';

    renderDOM();
  }

  document.getElementById('swpick-clear')?.addEventListener('click', () => {
    onSwatchPickChanged([]);
  });

  // public API ──────────────────────────────────────────────────────

  return {
    render,
    renderDOM,
    renderSwatchPickBar,
    focusSwatch,
    getHoveredSwatchIdx,
    getGridCols,
    getSwatchEls,
    setPickingTint,
  };
}