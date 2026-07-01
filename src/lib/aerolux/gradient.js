// src/lib/aerolux/gradient.js
// gradient building, easing, interpolation, and palette lookup

import {
  toHSL,
  hslToRgb63,
  rgbToLab,
  rgbDist,
  labDist,
  getSat,
} from './palette.js';

// easing ────────────────────────────────────────────────────────────

export const lerp = (a, b, t) => a + t * (b - a);

export function bounce(t) {
  if (t < 1 / 2.75)       return 7.5625 * t * t;
  if (t < 2 / 2.75)       { t -= 1.5 / 2.75;   return 7.5625 * t * t + 0.75; }
  if (t < 2.5 / 2.75)     { t -= 2.25 / 2.75;  return 7.5625 * t * t + 0.9375; }
  t -= 2.625 / 2.75; return 7.5625 * t * t + 0.984375;
}

export function elastic(t) {
  if (t === 0 || t === 1) return t;
  return -Math.pow(2, 10 * t - 10) *
         Math.sin((t * 10 - 10.75) * (2 * Math.PI) / 3);
}

export function applyEasing(t, e) {
  switch(e) {
    case 'easeIn':   return t*t;
    case 'easeOut':  return 1-(1-t)**2;
    case 'sCurve':   return t<.5 ? 2*t*t : 1-2*(1-t)**2;
    case 'cubicIn':  return t*t*t;
    case 'cubicOut': return 1-(1-t)**3;
    case 'sineIn':   return 1 - Math.cos(t * Math.PI / 2);
    case 'sineOut':  return Math.sin(t * Math.PI / 2);
    case 'sineBoth': return -(Math.cos(Math.PI * t) - 1) / 2;
    case 'expoIn':   return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
    case 'expoOut':  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'bounce':   return bounce(t);
    case 'elastic':  return elastic(t);
    default:         return t;
  }
}

// interpolation ─────────────────────────────────────────────────────

export const lerpRgb = (ca, cb, t) => ca.map((v, i) => v + t * (cb[i] - v));

export function lerpHsl(ca, cb, t, dir) {
  const ha=toHSL(...ca), hb=toHSL(...cb);
  let dh = hb.h - ha.h;
  if (dir==='longest') {
    if (dh>0 && dh<0.5)  dh -= 1;
    if (dh<0 && dh>-0.5) dh += 1;
    if (dh===0) dh = 1;
  } else {
    if (dh>0.5)  dh -= 1;
    if (dh<-0.5) dh += 1;
  }
  const h = ((ha.h + t*dh) % 1 + 1) % 1;
  const s = Math.max(0, Math.min(1, ha.s + t*(hb.s - ha.s)));
  const l = Math.max(0, Math.min(1, ha.l + t*(hb.l - ha.l)));
  return hslToRgb63(h, s, l);
}

// palette lookup ────────────────────────────────────────────────────

export function findNearest(target, palette, mode, labCache) {
  let best=-1, bd=Infinity;
  const tlab = mode==='lab' ? rgbToLab(...target) : null;
  for (const c of palette) {
    if (c.i === 0) continue;
    const d = mode==='lab'
      ? labDist(tlab, labCache ? labCache[c.i] : rgbToLab(c.r, c.g, c.b))
      : rgbDist(target, [c.r, c.g, c.b]);
    if (d < bd) { bd=d; best=c.i; }
  }
  return best;
}

export function findNearestVivid(target, palette, labCache) {
  const tlab = rgbToLab(...target);
  const cands = palette
    .filter(c => c.i !== 0)
    .map(c => ({
      i: c.i,
      d: labDist(tlab, labCache ? labCache[c.i] : rgbToLab(c.r, c.g, c.b)),
      s: getSat(c)
    }))
    .sort((a, b) => a.d - b.d);
  if (!cands.length) return 1; // fallback for empty palette
  const thresh  = cands[0].d * 3 + 5;
  const close   = cands.filter(c => c.d <= thresh);
  const vivid   = close.length ? close : cands; // fallback if filter empties
  return vivid.reduce((best, c) => c.s > best.s ? c : best, vivid[0]).i;
}

// envelope ──────────────────────────────────────────────────────────

export function envelopeBrightness(t, envelope) {
  const {shape, attack, release, floor} = envelope;
  if (shape === 'none') return 1.0;
  if (shape === 'fade_in')
    return lerp(floor, 1.0, Math.min(t / Math.max(attack, 1e-6), 1.0));
  if (shape === 'fade_out')
    return lerp(1.0, floor, Math.max((t - (1 - release)) / Math.max(release, 1e-6), 0.0));
  if (shape === 'fade_both') {
    const a = lerp(floor, 1.0, Math.min(t / Math.max(attack, 1e-6), 1.0));
    const b = lerp(1.0, floor, Math.max((t - (1 - release)) / Math.max(release, 1e-6), 0.0));
    return Math.min(a, b);
  }
  if (shape === 'bell')   return lerp(floor, 1.0, Math.sin(Math.PI * t));
  if (shape === 'valley') return lerp(1.0, floor, Math.sin(Math.PI * t));
  return 1.0;
}

// hue shift helper (private, not exported) ──────────────────────────

function getStopColour(ci, palette, hueShift) {
  const c = palette[ci] || palette[0];
  if (hueShift === 0) return c;
  const { h, s, l } = toHSL(c.r, c.g, c.b);
  const newH = (h + hueShift / 360) % 1.0;
  const [r, g, b] = hslToRgb63(newH, s, l);
  const newCi = findNearest([r, g, b], palette, 'rgb');
  return palette[newCi] || palette[0];
}

// main gradient builder ─────────────────────────────────────────────

export function buildGradient(
  stops, palette, algorithm, easing, steps,
  tint, envelope, antiRepeat, hueShift, hslDir,
  labCache
) {
  // sort a copy. callers should pre-sort but this is a defensive guarantee
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const result = [];

  for (let i=0; i<steps; i++) {
    const t = steps===1 ? 0 : applyEasing(i/(steps-1), easing);

    let s0=sorted[0], s1=sorted[sorted.length-1];
    for (let j=0; j<sorted.length-1; j++) {
      if (t>=sorted[j].pos && t<=sorted[j+1].pos) {
        s0=sorted[j]; s1=sorted[j+1]; break;
      }
    }

    const ca = getStopColour(s0.ci, palette, hueShift);
    const cb = getStopColour(s1.ci, palette, hueShift);
    const A  = [ca.r,ca.g,ca.b], B = [cb.r,cb.g,cb.b];
    const span = s1.pos-s0.pos;
    const lt   = span<0.0001 ? 0 : Math.max(0,Math.min(1,(t-s0.pos)/span));

    let interp;
    if      (algorithm==='stepped') interp = lt<0.5 ? A : B;
    else if (algorithm==='hsl')     interp = lerpHsl(A, B, lt, hslDir);
    else                            interp = lerpRgb(A, B, lt);

    if (envelope.shape !== 'none') {
      const brightness = envelopeBrightness(t, envelope);
      interp = interp.map(c => c * brightness);
    }

    let vel;
    if      (algorithm==='lab')   vel = findNearest(interp, palette, 'lab', labCache);
    else if (algorithm==='vivid') vel = findNearestVivid(interp, palette, labCache);
    else                          vel = findNearest(interp, palette, 'rgb');

    if (tint.ci !== null && tint.str > 0) {
        const pc  = palette[vel] || palette[0];
        const tc  = palette[tint.ci] || palette[0];
        let   str = tint.str / 100;

        // apply optional fade direction using the eased position t (0–1)
        if      (tint.fade === 'in')     str = str * t;
        else if (tint.fade === 'out')    str = str * (1 - t);
        else if (tint.fade === 'centre') str = str * (1 - Math.abs(t - 0.5) * 2);

        if (str > 0) {
            vel = findNearest(
                [pc.r * (1 - str) + tc.r * str,
                 pc.g * (1 - str) + tc.g * str,
                 pc.b * (1 - str) + tc.b * str],
                palette, 'rgb'
            );
        }
    }

    if (antiRepeat && i > 0 && vel === result[i-1].velocity && lt > 0 && lt < 1) {
        const prev=result[i-1].velocity;
        let best2=-1, bd2=Infinity;
        for (const c of palette) {
          if (c.i === 0) continue;  
          if (c.i===prev) continue;
          const d = rgbDist(interp,[c.r,c.g,c.b]);
          if (d < bd2) { bd2=d; best2=c.i; }
        }
        const origDist = rgbDist(interp,[palette[vel].r,palette[vel].g,palette[vel].b]);
        if (best2!==-1 && bd2<=origDist*2.5) vel=best2; // magic number is 2.5, tune for more or less aggressive anti-repetition. maybe add as a user option later
    }

    result.push({step:i, velocity:vel});
  }

  return result;
}