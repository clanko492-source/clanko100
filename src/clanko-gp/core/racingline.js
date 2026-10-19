// CLANKO GP — racing line and target speeds. The line minimises curvature inside the track edges;
// speeds come from the car's grip, downforce, power and braking, with forward/backward passes.

import { clamp, G, RHO, blurCircular } from "./math.js";

export function computeRacingLine(track) {
  const N = track.N, ds = track.ds;
  const d = new Float64Array(N);
  const lo = new Float64Array(N), hi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const hw = track.hw[i];
    // use a little kerb on the inside, keep a margin on the outside
    const kL = track.kerb[0][i] > 0 ? 0.5 : 0, kR = track.kerb[1][i] > 0 ? 0.5 : 0;
    lo[i] = -hw + 1.25 - kL; hi[i] = hw - 1.25 + kR;
  }
  const px = new Float64Array(N), pz = new Float64Array(N);
  const spans = [Math.round(28 / ds), Math.round(16 / ds), Math.round(8 / ds), Math.max(1, Math.round(4 / ds))];
  for (const k of spans) {
    for (let it = 0; it < 220; it++) {
      for (let i = 0; i < N; i++) { px[i] = track.x[i] + track.nx[i] * d[i]; pz[i] = track.z[i] + track.nz[i] * d[i]; }
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N;
        const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
        const target = (mx - track.x[i]) * track.nx[i] + (mz - track.z[i]) * track.nz[i];
        d[i] = clamp(d[i] + (target - d[i]) * 0.55, lo[i], hi[i]);
      }
    }
  }
  const sm = blurCircular(d, 2);
  for (let i = 0; i < N; i++) sm[i] = clamp(sm[i], lo[i], hi[i]);
  return Float32Array.from(sm);
}

/** signed curvature of the racing line at each sample */
export function lineCurvature(track, line) {
  const N = track.N, k = new Float64Array(N), step = Math.max(2, Math.round(6 / track.ds));
  const X = (i) => track.x[i] + track.nx[i] * line[i], Z = (i) => track.z[i] + track.nz[i] * line[i];
  for (let i = 0; i < N; i++) {
    const a = (i - step + N) % N, b = (i + step) % N;
    const ax = X(a), az = Z(a), bx = X(i), bz = Z(i), cx = X(b), cz = Z(b);
    const abx = bx - ax, abz = bz - az, bcx = cx - bx, bcz = cz - bz;
    const cross = abx * bcz - abz * bcx;
    const la = Math.hypot(abx, abz), lb = Math.hypot(bcx, bcz), lc = Math.hypot(cx - ax, cz - az);
    k[i] = (2 * cross) / Math.max(1e-6, la * lb * lc);
  }
  return Float32Array.from(blurCircular(k, 1));
}

/**
 * Target speed at every sample for a car. p = { mu, clA, cdA, mass, power, brake, frontShare }
 */
export function speedProfile(track, line, k, p) {
  const N = track.N, ds = track.ds;
  const v = new Float64Array(N);
  const c = (0.5 * RHO * p.clA) / p.mass, cd = (0.5 * RHO * p.cdA) / p.mass;
  const vTop = p.vTop || 95;
  // tyre grip falls a little as load rises (same rule as the physics)
  const muAt = (vv) => p.mu * clamp(1 - 0.07 * (((p.mass * G + 0.5 * RHO * p.clA * vv * vv) / 4) / 3200 - 1), 0.72, 1.12);
  // cornering limit: the car's own table when given (accounts for balance and load transfer)
  const latMax = p.aLat ? (vv) => { const f = clamp(vv, 0, p.aLat.length - 2), i0 = f | 0, t = f - i0; return p.aLat[i0] * (1 - t) + p.aLat[i0 + 1] * t; }
    : (vv) => muAt(vv) * (G + c * vv * vv);
  for (let i = 0; i < N; i++) {
    const R = 1 / Math.max(1e-5, Math.abs(k[i]));
    let vm = vTop;
    if (p.aLat) {
      // largest speed whose cornering demand fits the table
      let lo = 5, hi = vTop;
      if (latMax(hi) >= hi * hi / R) vm = hi;
      else { for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (latMax(mid) >= mid * mid / R) lo = mid; else hi = mid; } vm = lo; }
    } else for (let it = 0; it < 6; it++) {
      const mu = muAt(Math.min(vm, vTop));
      const denom = 1 - mu * c * R;
      vm = denom <= 0 ? vTop : Math.sqrt((mu * G * R) / denom);
    }
    // crests reduce grip, compressions add it
    const vc = track.vcurv[i];
    if (vc < 0) vm = Math.min(vm, Math.sqrt(G / Math.max(1e-4, -vc)) * 0.95 + 5);
    v[i] = Math.min(vm, vTop);
  }
  const latUse = (vv, i) => { const R = 1 / Math.max(1e-5, Math.abs(k[i])); const aLat = (vv * vv) / R; const aMax = latMax(vv); return clamp(aLat / aMax, 0, 1); };
  // forward pass: acceleration limits
  for (let pass = 0; pass < 2; pass++) for (let n = 0; n < N; n++) {
    const i = n % N, j = (i + 1) % N;
    const vi = v[i];
    const aTrac = muAt(vi) * (G * 0.56 + c * 0.5 * vi * vi);
    const aPow = p.power / (p.mass * Math.max(vi, 6)) - cd * vi * vi;
    let a = Math.min(aTrac, aPow) * Math.sqrt(Math.max(0.05, 1 - latUse(vi, i) ** 2));
    const vn = Math.sqrt(vi * vi + 2 * Math.max(0, a) * ds);
    if (vn < v[j]) v[j] = vn;
  }
  // backward pass: braking limits
  for (let pass = 0; pass < 2; pass++) for (let n = N - 1; n >= 0; n--) {
    const i = n, j = (i - 1 + N) % N;
    const vi = v[i];
    const aBrk = Math.min(muAt(vi) * (G + c * vi * vi), p.brake / p.mass) + cd * vi * vi;
    const a = aBrk * Math.sqrt(Math.max(0.05, 1 - latUse(vi, i) ** 2)) * 0.95;
    const vp = Math.sqrt(vi * vi + 2 * a * ds);
    if (vp < v[j]) v[j] = vp;
  }
  return Float32Array.from(v);
}

/** planning numbers from a physics car */
export function planParams(car, gripScale = 1) {
  const ae = car.aero();
  const aLat = new Float32Array(112);
  for (let v = 0; v < aLat.length; v++) aLat[v] = car.lateralCapacity(v) * 0.95 * gripScale;
  return {
    aLat,
    mu: car.compoundData.mu * car.cls.tyreMu * car.perf.grip * 0.94 * gripScale,
    clA: ae.clA, cdA: ae.cdA, mass: car.mass,
    power: (car.cls.power + car.cls.ersPower * 0.5) * car.perf.power * 0.92,
    brake: car.cls.maxBrake * 0.92,
    vTop: car.maxSpeedGear * 0.995,
  };
}
