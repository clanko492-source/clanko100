// CLANKO GP — small maths helpers shared by physics, AI and rendering. No three.js here,
// so the simulation can also run in Node for automated tests.

export const TAU = Math.PI * 2;
export const G = 9.81;
export const RHO = 1.225; // air density kg/m^3

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); };
export const sign = (v) => (v < 0 ? -1 : 1);
export const sq = (v) => v * v;
export const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const moveTowards = (v, target, maxDelta) => (Math.abs(target - v) <= maxDelta ? target : v + Math.sign(target - v) * maxDelta);
export const kmh = (ms) => ms * 3.6;
export const mph = (ms) => ms * 2.236936;

/** Deterministic random numbers (mulberry32). */
export function rng(seed) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Simple 1D gaussian blur over a circular (closed-loop) array. */
export function blurCircular(src, radius) {
  const n = src.length, out = new Float64Array(n);
  if (radius <= 0) { out.set(src); return out; }
  const sigma = radius / 2, k = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); sum += w; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let j = -radius; j <= radius; j++) v += src[(i + j + n) % n] * k[j + radius];
    out[i] = v;
  }
  return out;
}

/** Format seconds as m:ss.mmm (or ss.mmm). */
export function fmtTime(t, short) {
  if (t == null || !isFinite(t)) return "-:--.---";
  const neg = t < 0; t = Math.abs(t);
  const m = Math.floor(t / 60), s = t - m * 60;
  const ss = s.toFixed(3).padStart(6, "0");
  return (neg ? "-" : "") + (m > 0 || !short ? m + ":" + ss : s.toFixed(3));
}
export function fmtGap(t) {
  if (t == null || !isFinite(t)) return "";
  return (t >= 0 ? "+" : "-") + Math.abs(t).toFixed(3);
}
