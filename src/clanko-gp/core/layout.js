// CLANKO GP — turns a circuit description (straights and corners with radii) into a smooth,
// exactly closed centre line. Corners are built from curvature, which is then smoothed so
// every bend gets a natural transition (like a real road's clothoid) instead of a kink.

import { blurCircular } from "./math.js";

const DEG = Math.PI / 180;

/**
 * cmds: [ ['S', length, opts], ['R'|'L', angleDeg, radius, opts], ... ]
 * opts can carry: { adjust:true } (a straight the solver may lengthen to close the loop),
 *                 { y: heightAtEnd }, { w: fullWidthAtEnd }, { bank: deg }, { bridge:true }, { tunnel:true },
 *                 { tag: 'name' } (records the s where this command starts, e.g. for DRS zones),
 *                 { fixed:true } (a straight whose length must not change, e.g. the pit straight)
 */
export function buildLayout(def) {
  const STEP = 1; // integration step (m)
  const sc = def.scale || 1;
  let cmds = def.path.map((c) => {
    const o = c.slice();
    if (o[0] === "S") { o[1] *= sc; if (o[2]) o[2] = { ...o[2] }; }
    else { o[2] *= sc; if (o[3]) o[3] = { ...o[3] }; }
    return o;
  });
  const smoothRadius = def.smooth == null ? 10 : def.smooth;

  // total turning must be a whole loop (or zero for a figure-eight)
  let turn = 0;
  for (const c of cmds) if (c[0] === "R") turn += c[1]; else if (c[0] === "L") turn -= c[1];
  const want = def.figure8 ? 0 : Math.sign(turn) * 360;
  if (Math.abs(turn - want) > 1e-6) throw new Error(`${def.id}: corners add up to ${turn.toFixed(2)}°, need ${want}°`);

  // Close the loop by lengthening/shortening straights. Every straight not marked fixed takes a
  // share of the correction in proportion to its length (least squares on relative change).
  const free = cmds.map((c, i) => (c[0] === "S" && !(c[2] && c[2].fixed) ? i : -1)).filter((i) => i >= 0);
  let result;
  for (let pass = 0; pass < 8; pass++) {
    result = integrate(cmds, STEP, smoothRadius);
    const ex = result.endX - result.x[0], ez = result.endZ - result.z[0];
    if (Math.hypot(ex, ez) < 0.05) break;
    if (free.length < 2) throw new Error(`${def.id}: needs at least two straights that can change length`);
    let m00 = 0, m01 = 0, m11 = 0;
    for (const i of free) {
      const L2 = cmds[i][1] * cmds[i][1], h = result.segHeading[i], dx = Math.cos(h), dz = Math.sin(h);
      m00 += L2 * dx * dx; m01 += L2 * dx * dz; m11 += L2 * dz * dz;
    }
    const det = m00 * m11 - m01 * m01;
    if (Math.abs(det) < 1e-6) throw new Error(`${def.id}: straights all point the same way; cannot close`);
    const lx = (ex * m11 - ez * m01) / det, lz = (ez * m00 - ex * m01) / det;
    for (const i of free) {
      const h = result.segHeading[i];
      cmds[i][1] -= cmds[i][1] * cmds[i][1] * (Math.cos(h) * lx + Math.sin(h) * lz);
    }
    const bad = free.filter((i) => cmds[i][1] < 12);
    if (bad.length && !def.preview) throw new Error(`${def.id}: closing the loop shrinks straight #${bad.join(",")} below 12 m; adjust the design`);
  }
  // remove any tiny residual by spreading it along the lap
  const r = result, n = r.x.length;
  const ex = r.endX - r.x[0], ez = r.endZ - r.z[0];
  for (let i = 0; i < n; i++) { const f = i / n; r.x[i] -= ex * f; r.z[i] -= ez * f; }

  // resample to an exact even spacing near the requested sample distance
  const total = n * STEP;
  const ds = def.ds || 2;
  const N = Math.round(total / ds);
  const spacing = total / N;
  const out = {
    id: def.id, length: total, ds: spacing, N,
    x: new Float64Array(N), z: new Float64Array(N), y: new Float64Array(N),
    w: new Float64Array(N), bank: new Float64Array(N), flags: new Uint8Array(N),
    tags: {}, cmds,
  };
  for (let i = 0; i < N; i++) {
    const s = i * spacing, f = s / STEP, i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
    out.x[i] = r.x[i0] + (r.x[i1] - r.x[i0]) * t;
    out.z[i] = r.z[i0] + (r.z[i1] - r.z[i0]) * t;
  }

  // per-command attributes along s: heights, widths, banking, flags
  const keysY = [], keysW = [], keysBank = [];
  let s = 0;
  const defaultW = def.width || 14;
  keysW.push([0, (cmds[0][2] && cmds[0][2].w0) || defaultW]);
  for (let ci = 0; ci < cmds.length; ci++) {
    const c = cmds[ci], o = (c[0] === "S" ? c[2] : c[3]) || {};
    const len = c[0] === "S" ? c[1] : c[1] * DEG * c[2];
    if (o.tag) out.tags[o.tag] = s;
    if (o.bridge || o.tunnel || o.pitStraight) {
      const a = Math.floor(s / spacing), b = Math.ceil((s + len) / spacing);
      for (let i = a; i <= b; i++) out.flags[((i % N) + N) % N] |= (o.bridge ? 1 : 0) | (o.tunnel ? 2 : 0);
    }
    s += len;
    if (o.y != null) keysY.push([s, o.y]);
    if (o.w != null) keysW.push([s, o.w]);
    keysBank.push([s - len / 2, (o.bank || 0) * DEG]);
  }
  fillKeyed(out.y, keysY, spacing, total, def.baseY || 0, true);
  fillKeyed(out.w, keysW, spacing, total, defaultW, false);
  fillKeyed(out.bank, keysBank, spacing, total, 0, false);
  const yb = blurCircular(out.y, Math.max(2, Math.round(24 / spacing)));
  const wb = blurCircular(out.w, Math.max(2, Math.round(30 / spacing)));
  const bb = blurCircular(out.bank, Math.max(2, Math.round(20 / spacing)));
  out.y.set(yb); out.w.set(wb); out.bank.set(bb);

  // rotate so that s = 0 is the start/finish line, def.startAt metres into the first straight
  const shift = Math.round((def.startAt || 0) / spacing);
  if (shift) for (const key of ["x", "z", "y", "w", "bank", "flags"]) rotate(out[key], shift);
  for (const k in out.tags) out.tags[k] = (out.tags[k] - shift * spacing + total) % total;
  out.startShift = shift * spacing;
  return out;
}

function rotate(arr, k) {
  const n = arr.length, tmp = arr.slice();
  for (let i = 0; i < n; i++) arr[i] = tmp[(i + k) % n];
}

/** fill an array along s from (s, value) keyframes, wrapping around the lap */
function fillKeyed(arr, keys, ds, total, def, smoothInterp) {
  const n = arr.length;
  if (!keys.length) { arr.fill(def); return; }
  keys = keys.map((k) => [((k[0] % total) + total) % total, k[1]]).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    let j = keys.findIndex((k) => k[0] > s);
    let a, b;
    if (j === -1) { a = keys[keys.length - 1]; b = [keys[0][0] + total, keys[0][1]]; }
    else if (j === 0) { a = [keys[keys.length - 1][0] - total, keys[keys.length - 1][1]]; b = keys[0]; }
    else { a = keys[j - 1]; b = keys[j]; }
    let t = (s - a[0]) / Math.max(1e-6, b[0] - a[0]);
    if (smoothInterp) t = t * t * (3 - 2 * t);
    arr[i] = a[1] + (b[1] - a[1]) * t;
  }
}

function integrate(cmds, step, smoothRadius) {
  const ks = [], segOf = [];
  cmds.forEach((c, ci) => {
    if (c[0] === "S") {
      const n = Math.max(1, Math.round(c[1] / step));
      for (let i = 0; i < n; i++) { ks.push(0); segOf.push(ci); }
    } else {
      const ang = c[1] * DEG * (c[0] === "R" ? 1 : -1);
      const len = Math.abs(c[1] * DEG * c[2]);
      const n = Math.max(1, Math.round(len / step));
      for (let i = 0; i < n; i++) { ks.push(ang / (n * step)); segOf.push(ci); }
    }
  });
  const k = blurCircular(Float64Array.from(ks), smoothRadius);
  const n = k.length, x = new Float64Array(n), z = new Float64Array(n);
  let h = 0, px = 0, pz = 0;
  const headSum = new Float64Array(cmds.length), headCnt = new Float64Array(cmds.length);
  for (let i = 0; i < n; i++) {
    x[i] = px; z[i] = pz;
    const hm = h + k[i] * step * 0.5; // midpoint heading
    px += Math.cos(hm) * step; pz += Math.sin(hm) * step;
    h += k[i] * step;
    headSum[segOf[i]] += hm; headCnt[segOf[i]]++;
  }
  const segHeading = Array.from(headSum, (v, i) => v / Math.max(1, headCnt[i]));
  return { x, z, endX: px, endZ: pz, segHeading };
}
