// src/lib/aerolux/palette.js
// palette data and colour math

// palette data ──────────────────────────────────────────────────────

export const DEFAULT_PALETTE = [
  [0,0,0],[63,63,63],[53,53,53],[42,42,42],[32,32,32],[21,21,21],[11,11,11],[0,0,0],
  [63,0,0],[47,0,0],[32,0,0],[16,0,0],[63,25,0],[47,19,0],[32,12,0],[16,6,0],
  [63,50,0],[47,38,0],[32,25,0],[16,12,0],[50,63,0],[38,47,0],[25,32,0],[12,16,0],
  [25,63,0],[19,47,0],[12,32,0],[6,16,0],[0,63,0],[0,47,0],[0,32,0],[0,16,0],
  [0,63,25],[0,47,19],[0,32,12],[0,16,6],[0,63,50],[0,47,38],[0,32,25],[0,16,12],
  [0,50,63],[0,38,47],[0,25,32],[0,12,16],[0,25,63],[0,19,47],[0,12,32],[0,6,16],
  [0,0,63],[0,0,47],[0,0,32],[0,0,16],[25,0,63],[19,0,47],[12,0,32],[6,0,16],
  [50,0,63],[38,0,47],[25,0,32],[12,0,16],[63,0,50],[47,0,38],[32,0,25],[16,0,12],
  [63,0,25],[47,0,19],[32,0,12],[16,0,6],[63,16,16],[47,12,12],[32,8,8],[16,4,4],
  [63,34,16],[47,26,12],[32,17,8],[16,8,4],[63,53,16],[47,40,12],[32,26,8],[16,13,4],
  [53,63,16],[40,47,12],[26,32,8],[13,16,4],[34,63,16],[26,47,12],[17,32,8],[8,16,4],
  [16,63,16],[12,47,12],[8,32,8],[4,16,4],[16,63,34],[12,47,26],[8,32,17],[4,16,8],
  [16,63,53],[12,47,40],[8,32,26],[4,16,13],[16,53,63],[12,40,47],[8,26,32],[4,13,16],
  [16,34,63],[12,26,47],[8,17,32],[4,8,16],[16,16,63],[12,12,47],[8,8,32],[4,4,16],
  [34,16,63],[26,12,47],[17,8,32],[8,4,16],[53,16,63],[40,12,47],[26,8,32],[13,4,16],
  [63,16,53],[47,12,40],[32,8,26],[16,4,13],[63,16,34],[47,12,26],[32,8,17],[16,4,8],
];

// colour math ───────────────────────────────────────────────────────

export const to8   = v => Math.round(v * 255 / 63);
export const toHex = (r,g,b) =>
  '#' + [r,g,b].map(v => to8(v).toString(16).padStart(2,'0')).join('');

export function toHSL(r,g,b) {
  const R=r/63, G=g/63, B=b/63;
  const mx=Math.max(R,G,B), mn=Math.min(R,G,B), d=mx-mn;
  let h=0, s=0, l=(mx+mn)/2;
  if (d > 0) {
    const denom = 1 - Math.abs(2*l - 1);
    s = denom > 0 ? d / denom : 0;
    if (mx===R)      h = ((G-B)/d) % 6;
    else if (mx===G) h = (B-R)/d + 2;
    else             h = (R-G)/d + 4;
    h = h/6; if (h<0) h+=1;
  }
  return {h, s, l};
}

export function hslToRgb63(h,s,l) {
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h*6)%2-1)), m=l-c/2;
  let r=0,g=0,b=0;
  if      (h<1/6){r=c;g=x} else if (h<2/6){r=x;g=c}
  else if (h<3/6){g=c;b=x} else if (h<4/6){g=x;b=c}
  else if (h<5/6){r=x;b=c} else {r=c;b=x}
  return [
    Math.max(0, Math.min(63, (r + m) * 63)),
    Math.max(0, Math.min(63, (g + m) * 63)),
    Math.max(0, Math.min(63, (b + m) * 63)),
];
}

export function rgbToXyz(r,g,b) {
  let R=r/63, G=g/63, B=b/63;
  R = R>0.04045 ? ((R+0.055)/1.055)**2.4 : R/12.92;
  G = G>0.04045 ? ((G+0.055)/1.055)**2.4 : G/12.92;
  B = B>0.04045 ? ((B+0.055)/1.055)**2.4 : B/12.92;
  return [R*0.4124+G*0.3576+B*0.1805, R*0.2126+G*0.7152+B*0.0722, R*0.0193+G*0.1192+B*0.9505];
}

export function xyzToLab([x,y,z]) {
  const f = t => t>0.008856 ? t**(1/3) : 7.787*t+16/116;
  return [116*f(y)-16, 500*(f(x/0.95047)-f(y)), 200*(f(y)-f(z/1.08883))];
}

export const rgbToLab = (r,g,b) => xyzToLab(rgbToXyz(r,g,b));
export const rgbDist  = (a,b) => Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
export const labDist  = (a,b) => Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
export const getSat   = c => toHSL(c.r,c.g,c.b).s;
export const getLum   = c => toHSL(c.r,c.g,c.b).l;

// palette & layout ──────────────────────────────────────────────────

// converts a column + row-from-bottom into a flat palette index
// this matches the physical Launchpad pad layout
export const indexAt = (col, rowFromBottom) =>
  Math.floor(col/4)*32 + rowFromBottom*4 + (col%4);

// returns the palette sorted by the current sort mode
// note: takes everything as parameters instead of reading global state
export function getSortedPalette(palette, sortMode, swatchOrder) {
  if (sortMode==='swatch') return swatchOrder.map(i => palette[i]);
  if (sortMode==='hue') {
    return palette
      .map(c => ({ c, h: toHSL(c.r, c.g, c.b).h }))
      .sort((a, b) => a.h - b.h)
      .map(x => x.c);
  }
  if (sortMode==='sat') {
    return palette
      .map(c => ({ c, s: toHSL(c.r, c.g, c.b).s }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.c);
  }
  if (sortMode==='lum') {
    return palette
      .map(c => ({ c, l: toHSL(c.r, c.g, c.b).l }))
      .sort((a, b) => a.l - b.l)
      .map(x => x.c);
  }
  return null;
}