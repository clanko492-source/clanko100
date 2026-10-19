// CLANKO GP — builds the 3D circuit from a Track: road with rubbered line and wet patches, kerbs,
// run-off, verges blending into the terrain, barriers, fences and markings. Scenery is in scenery.js.

import * as THREE from "three";
import { SURF, BARRIER } from "../core/track.js";
import { clamp, lerp, smoothstep, rng } from "../core/math.js";
import * as TX from "./textures.js";
import { stripGeometry } from "./geom.js";
import { themeFor } from "./themes.js";
import { buildScenery } from "./scenery.js";

// ---------- world noise (not tiled) ----------
function h2(x, z, seed) {
  let h = (x * 374761393 + z * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x, z, seed = 1) {
  const x0 = Math.floor(x), z0 = Math.floor(z), tx = x - x0, tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = h2(x0, z0, seed), b = h2(x0 + 1, z0, seed), c = h2(x0, z0 + 1, seed), d = h2(x0 + 1, z0 + 1, seed);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
export function fbm2(x, z, oct = 4, seed = 1) {
  let s = 0, a = 1, t = 0, f = 1;
  for (let o = 0; o < oct; o++) { s += noise2(x * f, z * f, seed + o * 31) * a; t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}

/** material that darkens/smooths where the surface is wet and shows the rubbered racing line */
function surfaceMaterial(params, { rubber = false, puddles = true } = {}) {
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.uniforms = { uRubber: { value: rubber ? 1 : 0 }, uWetAll: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aTrk;\nvarying vec3 vTrk;\nvarying vec2 vWxz;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTrk = aTrk;\nvWxz = (modelMatrix * vec4(position, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uRubber; uniform float uWetAll;
varying vec3 vTrk; varying vec2 vWxz;
float gpHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gpNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(gpHash(i), gpHash(i+vec2(1,0)), f.x), mix(gpHash(i+vec2(0,1)), gpHash(i+vec2(1,1)), f.x), f.y); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
float gpRub = exp(-pow((vTrk.x - vTrk.y) / 1.5, 2.0)) * uRubber;
float gpWet = clamp(max(vTrk.z, uWetAll) * (1.0 - 0.6 * gpRub * step(vTrk.z, 0.85)), 0.0, 1.0);
${puddles ? "float gpPud = smoothstep(0.62, 0.78, gpNoise(vWxz * 0.11) * 0.7 + gpNoise(vWxz * 0.37) * 0.3) * smoothstep(0.45, 0.9, gpWet);" : "float gpPud = 0.0;"}
diffuseColor.rgb *= (1.0 - 0.22 * gpRub) * mix(1.0, 0.52, gpWet) * (1.0 - 0.25 * gpPud);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.14, smoothstep(0.05, 0.7, gpWet));
roughnessFactor = mix(roughnessFactor, 0.02, gpPud);
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.85, gpRub);`);
  };
  m.customProgramCacheKey = () => "gpsurf" + (rubber ? 1 : 0) + (puddles ? 1 : 0);
  return m;
}

export class TrackView {
  /**
   * opts: { quality: { tex, terrainCell, trees, detail }, line (racing line offsets), teams: [{color, color2}], night }
   */
  constructor(track, opts = {}) {
    this.track = track;
    this.opts = opts;
    this.q = { tex: 512, terrainCell: 10, trees: 1, detail: 1, aniso: 8, ...(opts.quality || {}) };
    this.theme = themeFor(track.def);
    this.night = !!(opts.night != null ? opts.night : track.def.night);
    this.group = new THREE.Group(); this.group.name = "circuit";
    this.wetMeshes = []; // meshes with per-row water
    this.animated = [];  // objects with update(dt, t)
    this.tvSpots = [];
    const t0 = performance.now();
    this._verge();
    this._baseTerrain();
    this._materials();
    this._road();
    this._sides();
    this._terrainMesh();
    this._barriers();
    this._markings();
    this.scenery = buildScenery(this);
    this.buildMs = performance.now() - t0;
  }

  // ---------- basic queries ----------
  roadY(i, d) { const t = this.track; return t.y[i] + d * Math.tan(t.bank[i]); }
  P(i, d, dy = 0) { const t = this.track; return [t.x[i] + t.nx[i] * d, this.roadY(i, d) + dy, t.z[i] + t.nz[i] * d]; }
  /** height of the base terrain (before it is cut down under the circuit) */
  baseH(x, z) {
    const C = this.tc, gx = (x - C.x0) / C.cell, gz = (z - C.z0) / C.cell;
    const ix = clamp(Math.floor(gx), 0, C.nx - 2), iz = clamp(Math.floor(gz), 0, C.nz - 2);
    const tx = clamp(gx - ix, 0, 1), tz = clamp(gz - iz, 0, 1);
    const H = C.h, n = C.nx;
    const a = H[iz * n + ix], b = H[iz * n + ix + 1], c = H[(iz + 1) * n + ix], d = H[(iz + 1) * n + ix + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  /** distance (m) from the circuit corridor, from the coarse grid */
  distC(x, z) {
    const C = this.tc, ix = clamp(Math.round((x - C.x0) / C.cell), 0, C.nx - 1), iz = clamp(Math.round((z - C.z0) / C.cell), 0, C.nz - 1);
    return C.dist[iz * C.nx + ix];
  }
  /** final ground height (terrain mesh) at a point, for placing scenery */
  groundY(x, z) {
    const T = this.tm; if (!T) return this.baseH(x, z);
    const gx = (x - T.x0) / T.cell, gz = (z - T.z0) / T.cell;
    const ix = clamp(Math.floor(gx), 0, T.nx - 2), iz = clamp(Math.floor(gz), 0, T.nz - 2);
    const tx = clamp(gx - ix, 0, 1), tz = clamp(gz - iz, 0, 1), n = T.nx, H = T.h;
    const a = H[iz * n + ix], b = H[iz * n + ix + 1], c = H[(iz + 1) * n + ix], d = H[(iz + 1) * n + ix + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  /** 0..1, how much a point lies in the lake or sea (soft edge) */
  waterMask(x, z) {
    const L = this.lake; if (!L) return 0;
    const dl = Math.hypot(x - L.x, z - L.z);
    const rr = L.r * (1 + 0.14 * (noise2(Math.atan2(z - L.z, x - L.x) * 2.5, 0, 9) - 0.5));
    let w = smoothstep(rr + 30, rr - 30, dl);
    if (L.sea) {
      const along = (x - L.x) * L.dx + (z - L.z) * L.dz, side = (x - L.x) * -L.dz + (z - L.z) * L.dx;
      const coast = -L.r * 0.15 + 18 * (noise2(side / 90, 3, 4) - 0.5);
      w = Math.max(w, smoothstep(coast - 30, coast + 30, along));
    }
    return w;
  }
  inWater(x, z) { return this.waterMask(x, z) > 0.5 && this.distC(x, z) > 30; }

  // ---------- verges: how far the grass beyond the barrier reaches before it meets the terrain ----------
  _verge() {
    const tr = this.track, N = tr.N;
    const V = tr.street ? 10 : 30;
    this.vergeW = [new Float32Array(N), new Float32Array(N)];
    const excl = Math.round(160 / tr.ds);
    for (let side = 0; side < 2; side++) {
      const raw = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const bar = tr.bar[side][i];
        let limit = V;
        if (tr.flags[i] & 3) { raw[i] = 0; continue; }
        const k = tr.k[i];
        if ((k > 0 && side === 1) || (k < 0 && side === 0)) limit = Math.min(limit, 0.85 / Math.abs(k) - bar);
        const sgn = side === 0 ? -1 : 1, nx = tr.nx[i] * sgn, nz = tr.nz[i] * sgn;
        tr.near(tr.x[i] + nx * (bar + V / 2), tr.z[i] + nz * (bar + V / 2), bar + V + 30, (j) => {
          let di = Math.abs(i - j); di = Math.min(di, N - di);
          if (di < excl) return;
          if (Math.abs(tr.y[i] - tr.y[j]) > 5.5) return;
          const vx = tr.x[j] - tr.x[i], vz = tr.z[j] - tr.z[i];
          const along = vx * nx + vz * nz, across = Math.abs(vx * tr.tx[i] + vz * tr.tz[i]);
          if (along > 0 && across < 30) limit = Math.min(limit, along / 2 - bar - 1);
        });
        raw[i] = Math.max(0, limit);
      }
      // smooth while never growing past the limit
      const W = this.vergeW[side];
      for (let i = 0; i < N; i++) {
        let m = raw[i];
        for (let k = -6; k <= 6; k++) m = Math.min(m, raw[(i + k + N) % N] + Math.abs(k) * 1.2);
        W[i] = m;
      }
    }
  }

  // ---------- coarse terrain: Laplace fill between the circuit's heights, plus hills and a lake ----------
  _baseTerrain() {
    const tr = this.track, th = this.theme, b = tr.bounds;
    const cell = 16, margin = 1000;
    const x0 = b.minx - margin, z0 = b.minz - margin;
    const nx = Math.ceil((b.maxx - b.minx + 2 * margin) / cell) + 1, nz = Math.ceil((b.maxz - b.minz + 2 * margin) / cell) + 1;
    const n = nx * nz;
    const sum = new Float32Array(n), wt = new Float32Array(n), fixed = new Uint8Array(n), H = new Float32Array(n);
    const corr = new Uint8Array(n);
    let mean = 0, cnt = 0;
    for (let i = 0; i < tr.N; i += 2) {
      const b0 = tr.bar[0][i], b1 = tr.bar[1][i];
      for (let d = -b0; d <= b1; d += 6) {
        const p = this.P(i, d);
        const gx = Math.round((p[0] - x0) / cell), gz = Math.round((p[2] - z0) / cell);
        if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) continue;
        const k = gz * nx + gx;
        corr[k] = 1;
        if (tr.flags[i] & 1) continue; // bridges float above the ground
        sum[k] += p[1]; wt[k] += 1; mean += p[1]; cnt++;
      }
    }
    mean /= Math.max(1, cnt);
    this.meanY = mean;
    const edgeY = mean - 2;
    for (let k = 0; k < n; k++) {
      if (wt[k] > 0) { H[k] = sum[k] / wt[k]; fixed[k] = 1; } else H[k] = mean;
    }
    for (let x = 0; x < nx; x++) { H[x] = edgeY; fixed[x] = 1; H[(nz - 1) * nx + x] = edgeY; fixed[(nz - 1) * nx + x] = 1; }
    for (let z = 0; z < nz; z++) { H[z * nx] = edgeY; fixed[z * nx] = 1; H[z * nx + nx - 1] = edgeY; fixed[z * nx + nx - 1] = 1; }
    // successive over-relaxation
    for (let it = 0; it < 260; it++) {
      for (let z = 1; z < nz - 1; z++) for (let x = 1; x < nx - 1; x++) {
        const k = z * nx + x; if (fixed[k]) continue;
        const avg = (H[k - 1] + H[k + 1] + H[k - nx] + H[k + nx]) * 0.25;
        H[k] += (avg - H[k]) * 1.85;
      }
    }
    // distance from the corridor (chamfer transform)
    const dist = new Float32Array(n);
    for (let k = 0; k < n; k++) dist[k] = corr[k] ? 0 : 1e9;
    const D1 = cell, D2 = cell * 1.4142;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const k = z * nx + x; let v = dist[k];
      if (x > 0) v = Math.min(v, dist[k - 1] + D1);
      if (z > 0) { v = Math.min(v, dist[k - nx] + D1); if (x > 0) v = Math.min(v, dist[k - nx - 1] + D2); if (x < nx - 1) v = Math.min(v, dist[k - nx + 1] + D2); }
      dist[k] = v;
    }
    for (let z = nz - 1; z >= 0; z--) for (let x = nx - 1; x >= 0; x--) {
      const k = z * nx + x; let v = dist[k];
      if (x < nx - 1) v = Math.min(v, dist[k + 1] + D1);
      if (z < nz - 1) { v = Math.min(v, dist[k + nx] + D1); if (x < nx - 1) v = Math.min(v, dist[k + nx + 1] + D2); if (x > 0) v = Math.min(v, dist[k + nx - 1] + D2); }
      dist[k] = v;
    }
    // lake (inland) or harbour (open sea beyond a basin next to the circuit)
    this.lake = null;
    if (th.water) {
      let cxs = 0, czs = 0; for (let i = 0; i < tr.N; i++) { cxs += tr.x[i]; czs += tr.z[i]; } cxs /= tr.N; czs /= tr.N;
      const p0 = tr.toWorld(0, 0);
      const pick = (sea) => {
        let best = null, bestScore = -1e9;
        for (let z = 4; z < nz - 4; z += 2) for (let x = 4; x < nx - 4; x += 2) {
          const k = z * nx + x, px = x0 + x * cell, pz = z0 + z * cell, d = dist[k];
          if (sea) {
            if (d < 140 || d > 360) continue;
            let dx = px - cxs, dz = pz - czs; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            // every part of the circuit must stay on the land side of the coast
            let ok = true;
            for (let i = 0; i < tr.N; i += 6) if ((tr.x[i] - px) * dx + (tr.z[i] - pz) * dz > -60) { ok = false; break; }
            if (!ok) continue;
            const score = -Math.abs(d - 240) - Math.hypot(px - p0.x, pz - p0.z) * 0.4;
            if (score > bestScore) { bestScore = score; best = { x: px, z: pz, r: Math.min(d - 22, 420), sea: true, dx, dz }; }
          } else {
            if (d < 90) continue;
            if (px < b.minx - 250 || px > b.maxx + 250 || pz < b.minz - 250 || pz > b.maxz + 250) continue;
            const score = Math.min(d, 420) - Math.hypot(px - cxs, pz - czs) * 0.25;
            if (score > bestScore) { bestScore = score; best = { x: px, z: pz, r: Math.min(d - 35, 360), sea: false }; }
          }
        }
        return best;
      };
      let L = th.water === "harbour" ? pick(true) : null;
      if (!L) L = pick(false);
      if (L) {
        let lowY = 1e9;
        for (let i = 0; i < tr.N; i += 4) if (Math.hypot(tr.x[i] - L.x, tr.z[i] - L.z) < L.r + 300) lowY = Math.min(lowY, tr.y[i]);
        L.level = (lowY < 1e8 ? lowY : mean) - 1.8;
        this.lake = L;
      }
    }
    // hills, fading out near the circuit and at the edge of the world
    const amp = th.hills || 0, R = rng(5);
    const seed = 3 + Math.floor(R() * 100);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const k = z * nx + x, px = x0 + x * cell, pz = z0 + z * cell;
      const edge = Math.min(x, z, nx - 1 - x, nz - 1 - z) * cell;
      const fade = smoothstep(50, 380, dist[k]) * smoothstep(0, 220, edge);
      const far = 1 + smoothstep(300, 900, dist[k]) * 0.8;
      let hill = amp > 0 ? (fbm2(px / 420, pz / 420, 4, seed) - 0.32) * amp * 1.6 * far : 0;
      hill += (fbm2(px / 60, pz / 60, 2, seed + 7) - 0.5) * 1.2;
      H[k] += hill * fade;
      if (this.lake) {
        const w = this.waterMask(px, pz) * smoothstep(18, 60, dist[k]);
        if (w > 0) H[k] = lerp(H[k], this.lake.level - 5, w);
      }
    }
    this.tc = { x0, z0, cell, nx, nz, h: H, dist, edgeY };
  }

  // ---------- materials ----------
  _materials() {
    const q = this.q, size = q.tex, an = q.aniso;
    const A = TX.asphalt(size, an);
    const tile = (t, r) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(r, r); return c; };
    const M = (this.mat = {});
    M.road = surfaceMaterial({ map: A.map, normalMap: A.normalMap, roughnessMap: A.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: 0.6 }, { rubber: true });
    M.pit = surfaceMaterial({ map: A.map, normalMap: A.normalMap, roughnessMap: A.roughnessMap, roughness: 1, color: new THREE.Color(1.25, 1.25, 1.25), envMapIntensity: 0.8 }, { puddles: false });
    M.runoff = surfaceMaterial({ map: A.map, normalMap: A.normalMap, roughnessMap: A.roughnessMap, roughness: 1, color: new THREE.Color(1.15, 1.17, 1.22), envMapIntensity: 0.8 });
    M.kerb = surfaceMaterial({ map: TX.kerb("#d2232a", "#f2f2f2", 256), roughness: 0.55, envMapIntensity: 0.8 }, { puddles: false });
    const Gr = TX.grass(size, an, this.theme.dry || 0);
    M.grass = new THREE.MeshStandardMaterial({ map: Gr.map, normalMap: Gr.normalMap, roughness: 0.95, envMapIntensity: 0.25 });
    const Gv = TX.gravel(size, an);
    M.gravel = new THREE.MeshStandardMaterial({ map: Gv.map, normalMap: Gv.normalMap, roughness: 0.95, envMapIntensity: 0.5, normalScale: new THREE.Vector2(1.4, 1.4) });
    const Sd = TX.sand(size, an);
    M.sand = new THREE.MeshStandardMaterial({ map: Sd.map, normalMap: Sd.normalMap, roughness: 0.97, envMapIntensity: 0.5 });
    const Cc = TX.concrete(256, an, 1);
    M.urban = new THREE.MeshStandardMaterial({ map: Cc.map, normalMap: Cc.normalMap, roughness: 0.9, color: 0xb8b8b8, envMapIntensity: 0.6 });
    const ground = this.theme.ground;
    M.ground = ground === "sand" ? M.sand : ground === "urban" ? M.urban : M.grass;
    M.terrain = M.ground.clone(); M.terrain.vertexColors = true;
    M.concrete = new THREE.MeshStandardMaterial({ map: Cc.map, normalMap: Cc.normalMap, roughness: 0.85, envMapIntensity: 0.6 });
    M.concreteAds = new THREE.MeshStandardMaterial({ map: TX.adStrip(2048, 128, 1), roughness: 0.6, envMapIntensity: 0.6 });
    M.armco = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.35, envMapIntensity: 1.1 });
    M.post = new THREE.MeshStandardMaterial({ color: 0x8d9096, metalness: 0.7, roughness: 0.45 });
    M.tyres = new THREE.MeshStandardMaterial({ map: TX.tyreWall(256, "#c81e1e"), roughness: 0.85 });
    M.tyreTop = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    M.tecpro = new THREE.MeshStandardMaterial({ map: TX.adStrip(2048, 128, 7), roughness: 0.55 });
    M.tecproPlain = new THREE.MeshStandardMaterial({ color: 0x1f4fb4, roughness: 0.6 });
    M.fence = new THREE.MeshStandardMaterial({ map: TX.fence(128), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6, depthWrite: true });
    M.paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    M.water = new THREE.MeshStandardMaterial({ color: 0x0d3a4a, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.94, envMapIntensity: 1.2 });
    // repeat scales for world-space textures
    this.uvScale = { road: 7, ground: 9, gravel: 4, sand: 6 };
  }

  // ---------- road ----------
  _road() {
    const tr = this.track, N = tr.N, ds = tr.ds, line = this.opts.line;
    const cols = 8;
    const g = stripGeometry(N, cols,
      (r, c) => { const i = r % N, hw = tr.hw[i]; return this.P(i, -hw + (2 * hw * c) / cols); },
      (r, c) => { const i = r % N, hw = tr.hw[i]; return [(-hw + (2 * hw * c) / cols) / this.uvScale.road, (r * ds) / this.uvScale.road]; },
      null,
      { name: "aTrk", size: 3, fn: (r, c) => { const i = r % N, hw = tr.hw[i]; return [-hw + (2 * hw * c) / cols, line ? line[i] : 0, 0]; } });
    const mesh = new THREE.Mesh(g, this.mat.road);
    mesh.receiveShadow = true; mesh.name = "road";
    this.group.add(mesh);
    this.wetMeshes.push({ mesh, rows: N + 1, cols: cols + 1, d: (r, c) => { const i = r % N, hw = tr.hw[i]; return -hw + (2 * hw * c) / cols; } });
    this.roadMesh = mesh;
  }

  // ---------- kerbs, strips, run-off and verges ----------
  _sides() {
    const tr = this.track, N = tr.N, ds = tr.ds;
    const runoffGeo = new Map();
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? -1 : 1;
      // lateral offset for column c of a band between inner(i) and outer(i)
      const band = (inner, outer, cols) => (r, c) => {
        const i = r % N, t = side === 0 ? 1 - c / cols : c / cols;
        return { i, t, d: sg * lerp(inner(i), outer(i), t) };
      };
      // kerbs
      {
        const cols = 2;
        const f = band((i) => tr.hw[i], (i) => tr.hw[i] + tr.kerb[side][i], cols);
        const g = stripGeometry(N, cols,
          (r, c) => { const { i, t, d } = f(r, c); return this.P(i, d, 0.012 + 0.03 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)); },
          (r, c) => { const { t } = f(r, c); return [(r * ds) / 2.6, t]; },
          (r) => tr.kerb[side][r % N] > 0.05 && tr.kerb[side][(r + 1) % N] > 0.05,
          { name: "aTrk", size: 3, fn: (r, c) => [f(r, c).d, 99, 0] });
        const m = new THREE.Mesh(g, this.mat.kerb); m.receiveShadow = true; this.group.add(m);
        this.wetMeshes.push({ mesh: m, rows: N + 1, cols: cols + 1, d: (r, c) => f(r, c).d });
      }
      // grass / asphalt strip behind the kerb
      {
        const cols = 1;
        const inner = (i) => tr.hw[i] + tr.kerb[side][i], outer = (i) => tr.hw[i] + tr.kerb[side][i] + tr.strip[side][i];
        const f = band(inner, outer, cols);
        const asphaltStrip = this.track.def.runoffStyle === "asphalt";
        const g = stripGeometry(N, cols,
          (r, c) => { const { i, d } = f(r, c); return this.P(i, d); },
          (r, c) => { const { i, d } = f(r, c); const p = this.P(i, d); return [p[0] / this.uvScale.ground, p[2] / this.uvScale.ground]; },
          (r) => tr.strip[side][r % N] > 0.05 && tr.strip[side][(r + 1) % N] > 0.05,
          { name: "aTrk", size: 3, fn: (r, c) => [f(r, c).d, 99, 0] });
        const m = new THREE.Mesh(g, asphaltStrip ? this.mat.runoff : this.mat.grass); m.receiveShadow = true; this.group.add(m);
        if (asphaltStrip) this.wetMeshes.push({ mesh: m, rows: N + 1, cols: cols + 1, d: (r, c) => f(r, c).d });
      }
      // run-off by surface type
      {
        const cols = 3;
        const inner = (i) => tr.hw[i] + tr.kerb[side][i] + tr.strip[side][i], outer = (i) => tr.bar[side][i] + 1.6;
        const f = band(inner, outer, cols);
        const types = [SURF.GRASS, SURF.GRAVEL, SURF.RUNOFF, SURF.SAND, SURF.PIT];
        for (const ty of types) {
          let any = false;
          for (let i = 0; i < N; i++) if (tr.runSurf[side][i] === ty) { any = true; break; }
          if (!any) continue;
          const scale = ty === SURF.GRAVEL ? this.uvScale.gravel : ty === SURF.SAND ? this.uvScale.sand : ty === SURF.GRASS ? this.uvScale.ground : this.uvScale.road;
          const g = stripGeometry(N, cols,
            (r, c) => { const { i, d } = f(r, c); return this.P(i, d, ty === SURF.GRAVEL ? 0.02 : 0); },
            (r, c) => { const { i, d } = f(r, c); const p = this.P(i, d); return [p[0] / scale, p[2] / scale]; },
            (r) => tr.runSurf[side][r % N] === ty,
            { name: "aTrk", size: 3, fn: (r, c) => [f(r, c).d, 99, 0] });
          const mat = ty === SURF.GRAVEL ? this.mat.gravel : ty === SURF.SAND ? this.mat.sand : ty === SURF.GRASS ? this.mat.grass : ty === SURF.PIT ? this.mat.pit : this.mat.runoff;
          const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.group.add(m);
          if (ty === SURF.RUNOFF || ty === SURF.PIT) this.wetMeshes.push({ mesh: m, rows: N + 1, cols: cols + 1, d: (r, c) => f(r, c).d });
          runoffGeo.set(ty + side * 10, m);
        }
      }
      // verge: from just behind the barrier to the terrain
      {
        const cols = 4;
        const inner = (i) => tr.bar[side][i] + 1.6, outer = (i) => tr.bar[side][i] + 1.6 + this.vergeW[side][i];
        const f = band(inner, outer, cols);
        const g = stripGeometry(N, cols,
          (r, c) => {
            const { i, d, t } = f(r, c);
            const p = this.P(i, d);
            const w = smoothstep(0, 1, t);
            const target = this.baseH(p[0], p[2]);
            p[1] = lerp(p[1], target, w);
            return p;
          },
          (r, c) => { const { i, d } = f(r, c); const p = this.P(i, d); return [p[0] / this.uvScale.ground, p[2] / this.uvScale.ground]; },
          (r) => this.vergeW[side][r % N] > 0.5 && this.vergeW[side][(r + 1) % N] > 0.5);
        const m = new THREE.Mesh(g, this.mat.ground); m.receiveShadow = true; this.group.add(m);
      }
    }
  }

  // ---------- terrain mesh, cut down wherever the circuit runs ----------
  _terrainMesh() {
    const tr = this.track, b = tr.bounds, cell = this.q.terrainCell, margin = 760;
    const x0 = b.minx - margin, z0 = b.minz - margin;
    const nx = Math.ceil((b.maxx - b.minx + 2 * margin) / cell) + 1, nz = Math.ceil((b.maxz - b.minz + 2 * margin) / cell) + 1;
    const n = nx * nz;
    const H = new Float32Array(n), cap = new Float32Array(n).fill(1e9);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) H[z * nx + x] = this.baseH(x0 + x * cell, z0 + z * cell);
    // cut under the corridor and verges
    const capAt = (px, pz, y) => {
      const gx = Math.floor((px - x0) / cell), gz = Math.floor((pz - z0) / cell);
      if (gx < 0 || gz < 0 || gx >= nx - 1 || gz >= nz - 1) return;
      const k = gz * nx + gx;
      if (y < cap[k]) cap[k] = y; if (y < cap[k + 1]) cap[k + 1] = y; if (y < cap[k + nx]) cap[k + nx] = y; if (y < cap[k + nx + 1]) cap[k + nx + 1] = y;
    };
    const step = Math.max(1.5, cell * 0.4);
    for (let i = 0; i < tr.N; i++) {
      for (let side = 0; side < 2; side++) {
        const sg = side === 0 ? -1 : 1, bar = tr.bar[side][i] + 1.6, vw = this.vergeW[side][i];
        for (let a = 0; a <= bar + vw + 0.01; a += step) {
          const d = sg * Math.min(a, bar + vw);
          const p = this.P(i, d);
          let y;
          if (a <= bar) y = p[1] - 0.45;
          else { const t = (a - bar) / Math.max(0.01, vw); y = lerp(p[1], this.baseH(p[0], p[2]), smoothstep(0, 1, t)) - 0.12 - 0.3 * (1 - t); }
          capAt(p[0], p[2], y);
        }
      }
    }
    const tint = this.theme.tint || [1, 1, 1];
    const col = new Float32Array(n * 3);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const k = z * nx + x, px = x0 + x * cell, pz = z0 + z * cell;
      const edge = Math.min(x, z, nx - 1 - x, nz - 1 - z) * cell;
      if (!(this.lake && this.lake.sea)) H[k] = lerp(this.tc.edgeY, H[k], smoothstep(0, 180, edge));
      if (cap[k] < H[k]) H[k] = cap[k];
      const v = 0.82 + fbm2(px / 90, pz / 90, 3, 17) * 0.36;
      let dark = 1;
      if (this.night) dark = 0.35 + 0.65 * (1 - smoothstep(30, 260, this.distC(px, pz)));
      col[k * 3] = v * tint[0] * dark; col[k * 3 + 1] = v * tint[1] * dark; col[k * 3 + 2] = v * tint[2] * dark;
    }
    const P = new Float32Array(n * 3), U = new Float32Array(n * 2);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const k = z * nx + x, px = x0 + x * cell, pz = z0 + z * cell;
      P[k * 3] = px; P[k * 3 + 1] = H[k]; P[k * 3 + 2] = pz;
      U[k * 2] = px / this.uvScale.ground; U[k * 2 + 1] = pz / this.uvScale.ground;
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let z = 0; z < nz - 1; z++) for (let x = 0; x < nx - 1; x++) {
      const a = z * nx + x, b2 = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b2; idx[q++] = b2; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.mat.terrain);
    mesh.receiveShadow = true; mesh.name = "terrain";
    this.group.add(mesh);
    this.tm = { x0, z0, cell, nx, nz, h: H };
    // the world beyond the terrain: open sea, or a wide ground ring at the edge height
    const W = 60000, cx = (b.minx + b.maxx) / 2, cz = (b.minz + b.maxz) / 2;
    if (this.lake && this.lake.sea) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(W, W), this.mat.water);
      sea.rotation.x = -Math.PI / 2; sea.position.set(cx, this.lake.level, cz); sea.name = "water";
      this.group.add(sea); this.water = sea;
    } else {
      const shape = new THREE.Shape([new THREE.Vector2(-W / 2, -W / 2), new THREE.Vector2(W / 2, -W / 2), new THREE.Vector2(W / 2, W / 2), new THREE.Vector2(-W / 2, W / 2)]);
      const hx0 = x0 - cx + cell, hx1 = x0 + (nx - 1) * cell - cx - cell, hz0 = -(z0 - cz + cell), hz1 = -(z0 + (nz - 1) * cell - cz - cell);
      shape.holes.push(new THREE.Path([new THREE.Vector2(hx0, hz0), new THREE.Vector2(hx0, hz1), new THREE.Vector2(hx1, hz1), new THREE.Vector2(hx1, hz0)]));
      const rg = new THREE.ShapeGeometry(shape);
      const uv = rg.attributes.uv, pp = rg.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / this.uvScale.ground, pp.getY(i) / this.uvScale.ground);
      const mat = this.mat.ground.clone(); mat.color = new THREE.Color(this.night ? 0x1d2126 : 0xe0e0e0).multiply(this.mat.ground.color);
      const far = new THREE.Mesh(rg, mat);
      far.rotation.x = -Math.PI / 2; far.position.set(cx, this.tc.edgeY - 0.05, cz); far.receiveShadow = true;
      this.group.add(far);
      if (this.lake) {
        const L = this.lake;
        const w = new THREE.Mesh(new THREE.CircleGeometry(L.r + 60, 96), this.mat.water);
        w.rotation.x = -Math.PI / 2; w.position.set(L.x, L.level, L.z); w.name = "water";
        this.group.add(w); this.water = w;
      }
    }
  }

  // ---------- barriers and fences ----------
  _barriers() {
    const tr = this.track, N = tr.N, ds = tr.ds, M = this.mat;
    const pit = tr.pit;
    const isPitFront = (side, i) => pit && side === pit.side && tr.runSurf[side][i] === SURF.PIT;
    const groups = new Map(); // material -> geometries
    const add = (mat, g) => { if (!groups.has(mat)) groups.set(mat, []); groups.get(mat).push(g); };
    const posts = [];
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? -1 : 1;
      const typeAt = (i) => (isPitFront(side, i) ? -1 : tr.barType[side][i]);
      const ribbon = (types, o0, h0, o1, h1, uLen, mat, filter) => {
        const g = stripGeometry(N, 1,
          (r, c) => {
            const i = r % N, o = c ? o1 : o0, h = c ? h1 : h0;
            const d = sg * (tr.bar[side][i] + o);
            return this.P(i, d, h);
          },
          (r, c) => [(r * ds) / uLen, c],
          (r) => { const i = r % N, j = (r + 1) % N; const t = typeAt(i); return types.includes(t) && typeAt(j) === t && (!filter || filter(i)); });
        add(mat, g);
      };
      const adsHere = (i) => Math.floor((i * ds) / 90) % 3 === 0;
      // concrete walls
      ribbon([BARRIER.CONCRETE], 0, 0, 0, 1.05, 4, M.concrete, (i) => !adsHere(i));
      ribbon([BARRIER.CONCRETE], 0, 0, 0, 1.05, 16.8, M.concreteAds, adsHere);
      ribbon([BARRIER.CONCRETE, BARRIER.TYRES, BARRIER.TECPRO], 0, 1.05, 0.5, 1.05, 4, M.concrete);
      ribbon([BARRIER.CONCRETE], 0.5, 1.05, 0.5, 0, 4, M.concrete);
      // armco: two rails
      ribbon([BARRIER.ARMCO], 0, 0.42, 0, 0.74, 4, M.armco);
      ribbon([BARRIER.ARMCO], 0, 0.8, 0, 1.12, 4, M.armco);
      // tyre walls and tecpro: face, top, and a wall behind
      ribbon([BARRIER.TYRES], 0, 0, 0, 1.0, 2.4, M.tyres);
      ribbon([BARRIER.TYRES], 0, 1.0, 1.2, 1.0, 4, M.tyreTop);
      ribbon([BARRIER.TECPRO], 0, 0, 0, 1.0, 16.8, M.tecpro);
      ribbon([BARRIER.TECPRO], 0, 1.0, 1.0, 1.0, 4, M.tecproPlain);
      ribbon([BARRIER.TYRES, BARRIER.TECPRO], 1.25, 0, 1.25, 1.1, 4, M.concrete);
      // catch fences
      const fenceOn = (i) => tr.street || Math.abs(tr.k[i]) < 1 / 180 || tr.barType[side][i] !== BARRIER.ARMCO;
      ribbon([BARRIER.CONCRETE], 0.25, 1.05, 0.25, 4.2, 4, M.fence, fenceOn);
      ribbon([BARRIER.ARMCO], 1.1, 0, 1.1, 3.6, 4, M.fence, fenceOn);
      ribbon([BARRIER.TYRES, BARRIER.TECPRO], 1.5, 1.1, 1.5, 4.2, 4, M.fence, fenceOn);
      // posts
      for (let i = 0; i < N; i += Math.max(1, Math.round(4 / ds))) {
        const t = typeAt(i); if (t < 0) continue;
        const o = t === BARRIER.ARMCO ? 0.2 : t === BARRIER.CONCRETE ? 0.25 : 1.5;
        const base = t === BARRIER.CONCRETE || t === BARRIER.TYRES || t === BARRIER.TECPRO ? 1.05 : 0;
        const top = fenceOn(i) ? 4.3 : 1.15;
        const p = this.P(i, sg * (tr.bar[side][i] + o));
        posts.push([p[0], p[1] + base, p[2], top - base]);
        if (t === BARRIER.ARMCO && fenceOn(i)) { const p2 = this.P(i, sg * (tr.bar[side][i] + 1.1)); posts.push([p2[0], p2[1], p2[2], 3.7]); }
      }
    }
    for (const [mat, list] of groups) {
      for (const g of list) {
        const m = new THREE.Mesh(g, mat);
        m.castShadow = mat !== M.fence; m.receiveShadow = true;
        if (mat === M.armco || mat === M.fence) mat.side = THREE.DoubleSide;
        this.group.add(m);
      }
    }
    // posts as one instanced mesh
    const pg = new THREE.CylinderGeometry(0.05, 0.05, 1, 6); pg.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(pg, M.post, posts.length);
    const mtx = new THREE.Matrix4();
    posts.forEach((p, k) => { mtx.makeScale(1, p[3], 1); mtx.setPosition(p[0], p[1], p[2]); im.setMatrixAt(k, mtx); });
    im.castShadow = false; im.receiveShadow = true;
    this.group.add(im);
  }

  // ---------- paint: edge lines, start line, grid boxes, pit lane markings ----------
  _markings() {
    const tr = this.track, N = tr.N, ds = tr.ds, pit = tr.pit;
    const P = [], C = [], idx = [];
    const white = [0.92, 0.92, 0.9];
    const quadSD = (s0, s1, d0, d1, color = white, lift = 0.014) => {
      // a patch of paint between track distances s0..s1 and offsets d0..d1, following the circuit
      const steps = Math.max(1, Math.ceil((s1 - s0) / ds));
      const base = P.length / 3;
      for (let k = 0; k <= steps; k++) {
        const s = s0 + ((s1 - s0) * k) / steps;
        for (const d of [d0, d1]) { const w = tr.toWorld(s, d); P.push(w.x, w.y + lift, w.z); C.push(...color); }
      }
      for (let k = 0; k < steps; k++) { const a = base + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    };
    // edge lines
    for (let s = 0; s < tr.length; s += 60) {
      const s1 = Math.min(tr.length, s + 60);
      const hw = tr.hw[tr.idx(s)];
      quadSD(s, s1, -hw + 0.08, -hw + 0.3); quadSD(s, s1, hw - 0.3, hw - 0.08);
    }
    // start / finish line
    const hw0 = tr.hw[0];
    quadSD(-0.4, 0.4, -hw0, hw0, [0.95, 0.95, 0.95], 0.016);
    // grid boxes
    for (const g of tr.grid) {
      const sF = g.s + 3.25;
      quadSD(sF - 0.15, sF + 0.15, g.d - 1.05, g.d + 1.05, white, 0.016);
      quadSD(sF - 1.2, sF - 0.15, g.d - 1.05, g.d - 0.85, white, 0.016);
      quadSD(sF - 1.2, sF - 0.15, g.d + 0.85, g.d + 1.05, white, 0.016);
    }
    // DRS detection lines
    for (const z of tr.drs) {
      const hw = tr.hw[tr.idx(z.detect)];
      for (let d = -hw; d < hw; d += 1.4) quadSD(z.detect - 0.15, z.detect + 0.15, d, Math.min(hw, d + 0.8), white, 0.015);
    }
    if (pit) {
      const sg = pit.sign;
      // pit entry and exit lines
      for (let s = pit.sIn; s < pit.sIn + pit.ramp; s += 2) {
        const o = tr.pitPathOffset(s); if (o == null) continue;
        const inner = o - sg * 2.6; quadSD(s, s + 2, Math.min(inner, inner + sg * 0.2), Math.max(inner, inner + sg * 0.2));
      }
      for (let s = pit.sOut - pit.ramp; s < pit.sOut; s += 2) {
        const o = tr.pitPathOffset(s); if (o == null) continue;
        const inner = o - sg * 2.6; quadSD(s, s + 2, Math.min(inner, inner + sg * 0.2), Math.max(inner, inner + sg * 0.2));
      }
      // lane divider (dashed) and box outlines
      const div = sg * (pit.fast + pit.work) / 2 + 0.3 * sg;
      for (let s = pit.wallStart + 10; s < pit.wallEnd - 10; s += 6) quadSD(s, s + 3, Math.min(div, div + sg * 0.15), Math.max(div, div + sg * 0.15));
      const teams = this.opts.teams || [];
      for (let slot = 0; slot < 10; slot++) {
        const s = tr.boxS(slot);
        const col = teams[slot] ? new THREE.Color(teams[slot].color) : new THREE.Color(0xffd23a);
        const c = [col.r, col.g, col.b];
        const d0 = sg * (pit.work - 2.4), d1 = sg * (pit.work + 2.4);
        const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
        quadSD(s - 3.2, s - 2.95, lo, hi, c, 0.016); quadSD(s + 2.95, s + 3.2, lo, hi, c, 0.016);
        quadSD(s - 3.2, s + 3.2, lo, lo + 0.25, c, 0.016); quadSD(s - 3.2, s + 3.2, hi - 0.25, hi, c, 0.016);
      }
      // speed limit lines across the lane
      for (const s of [pit.limitStart, pit.limitEnd]) {
        const o = tr.pitPathOffset(s) || sg * pit.fast;
        quadSD(s - 0.2, s + 0.2, Math.min(o - sg * 3, o + sg * 3), Math.max(o - sg * 3, o + sg * 3), white, 0.016);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mat.paint);
    m.receiveShadow = true; m.name = "markings";
    this.group.add(m);
    // chequered strip by the start line
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 32;
    const cg = cv.getContext("2d");
    for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { cg.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4"; cg.fillRect(x * 8, y * 8, 8, 8); }
    const ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace; ct.anisotropy = 8;
    const ch = [];
    const steps = 1;
    for (let k = 0; k <= steps; k++) { const s = 0.4 + k * 1.2; for (const d of [-hw0, hw0]) { const w = tr.toWorld(s, d); ch.push(w.x, w.y + 0.016, w.z); } }
    const chg = new THREE.BufferGeometry();
    chg.setAttribute("position", new THREE.Float32BufferAttribute(ch, 3));
    chg.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    chg.setIndex([0, 1, 2, 1, 3, 2]); chg.computeVertexNormals();
    const chm = new THREE.Mesh(chg, new THREE.MeshStandardMaterial({ map: ct, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    chm.receiveShadow = true;
    this.group.add(chm);
  }

  /** update wet surfaces from the weather: water(i, d) -> 0..1 */
  setWater(waterFn, wetAll = 0) {
    for (const w of this.wetMeshes) {
      const a = w.mesh.geometry.attributes.aTrk;
      const N = this.track.N;
      for (let r = 0; r < w.rows; r++) for (let c = 0; c < w.cols; c++) {
        const k = r * w.cols + c;
        a.array[k * 3 + 2] = waterFn ? waterFn(r % N, w.d(r, c)) : 0;
      }
      a.needsUpdate = true;
    }
    for (const m of [this.mat.road, this.mat.pit, this.mat.runoff, this.mat.kerb]) m.userData.uniforms.uWetAll.value = wetAll;
  }

  update(dt, time) {
    for (const a of this.animated) a.update(dt, time);
    if (this.water && this.water.material.normalMap) this.water.material.normalMap.offset.set(time * 0.004, time * 0.002);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) { for (const k of ["map", "normalMap", "roughnessMap", "emissiveMap"]) if (m[k] && !m[k].userData.shared) {/* textures are cached and shared */} m.dispose(); }
    });
  }
}
