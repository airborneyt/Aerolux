// src/lib/aerolux/share.js
// encode/decode for gradient state URL sharing 
// qr sharing is defunct in 2.0


const VALID_ALGOS   = ['rgb','lab','hsl','vivid','stepped'];
const VALID_EASINGS = ['linear','easeIn','easeOut','sCurve','cubicIn','cubicOut',
                       'sineIn','sineOut','sineBoth','expoIn','expoOut','bounce','elastic'];
const VALID_DIRS    = ['shortest','longest'];
const VALID_ENVS    = ['none','fade_in','fade_out','fade_both','bell','valley'];
const VALID_FADES   = ['in','out','centre'];

/**
 * encode current editor state into a compact base64url string
 * @param {object} state  — { stops, algorithm, easing, hslDir, steps,
 *                            hueShift, tint, envelope }
 * @returns {string}
 */
export function encodeState(state) {
  const { stops, algorithm, easing, hslDir, steps, hueShift, tint, envelope } = state;

  const payload = {
    s:  stops.map(s => ({ p: Math.round(s.pos * 1000) / 1000, c: s.ci })),
    a:  algorithm,
    e:  easing,
    h:  hslDir,
    n:  steps,
    hs: hueShift || 0,
    t:  tint?.ci != null
          ? { c: tint.ci, s: tint.str, f: tint.fade ?? null }
          : null,
    ev: envelope?.shape && envelope.shape !== 'none'
          ? { sh: envelope.shape,
              a:  Math.round((envelope.attack  ?? 0.2) * 100),
              r:  Math.round((envelope.release ?? 0.2) * 100),
              fl: Math.round((envelope.floor   ?? 0)   * 100) }
          : null,
  };

  const json = JSON.stringify(payload);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * decode a base64url string back into editor state
 * @param {string}   encoded
 * @param {number}   paletteLength  — for bounds-clamping ci values
 * @returns {object|null}  decoded state, or null on any error
 */
export function decodeState(encoded, paletteLength) {
  try {
    const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const p    = JSON.parse(json);

    if (!Array.isArray(p.s) || p.s.length < 2 || p.s.length > 16) return null;

    const clampCi = v => Math.max(1, Math.min(paletteLength - 1, parseInt(v) || 1));

    const stops = p.s.map((s, i) => ({
      id:  i,
      pos: Math.max(0, Math.min(1, parseFloat(s.p) || 0)),
      ci:  clampCi(s.c),
    }));
    stops[0].pos = 0;
    stops[stops.length - 1].pos = 1;

    return {
      stops,
      algorithm: VALID_ALGOS.includes(p.a)   ? p.a : 'rgb',
      easing:    VALID_EASINGS.includes(p.e) ? p.e : 'linear',
      hslDir:    VALID_DIRS.includes(p.h)    ? p.h : 'shortest',
      steps:     Math.max(2, Math.min(16, parseInt(p.n) || 16)),
      hueShift:  Math.max(0, Math.min(360, parseInt(p.hs) || 0)),
      tint: p.t
        ? { ci:   clampCi(p.t.c),
            str:  Math.max(0, Math.min(100, parseInt(p.t.s) || 0)),
            fade: VALID_FADES.includes(p.t.f) ? p.t.f : null }
        : { ci: null, str: 0, fade: null },
      envelope: p.ev && VALID_ENVS.includes(p.ev.sh)
        ? { shape:   p.ev.sh,
            attack:  Math.max(0, Math.min(1, (parseInt(p.ev.a)  || 0) / 100)),
            release: Math.max(0, Math.min(1, (parseInt(p.ev.r)  || 0) / 100)),
            floor:   Math.max(0, Math.min(1, (parseInt(p.ev.fl) || 0) / 100)) }
        : { shape: 'none', attack: 0.2, release: 0.2, floor: 0 },
      nextId:  stops.length,
      selStop: stops[0].id,
    };
  } catch {
    return null;
  }
}

/**
 * build a full share URL from an encoded state string
 * strips any existing `?g=` param and hash before adding the new one
 * @param {string} encoded
 * @returns {string}
 */
export function buildShareUrl(encoded) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash   = '';
  url.searchParams.set('g', encoded);
  return url.toString();
}

/**
 * read the `?g=` param from the current URL, if present
 * @returns {string|null}
 */
export function getShareParam() {
  return new URLSearchParams(window.location.search).get('g');
}

/**
 * remove `?g=` from the browser URL without reloading
 */
export function cleanShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('g');
  window.history.replaceState({}, '', url.toString());
}