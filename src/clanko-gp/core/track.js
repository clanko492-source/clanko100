// CLANKO GP — a circuit ready for racing: centre line, widths, kerbs, run-off, barriers, pit lane,
// grid, sectors, DRS zones and fast position queries. Pure data, no rendering.

import { buildLayout } from "./layout.js";
import { clamp, blurCircular, smoothstep } from "./math.js";

export const SURF = { ROAD: 0, KERB: 1, GRASS: 2, GRAVEL: 3, RUNOFF: 4, SAND: 5, PIT: 6, WALL: 7 };
export const SURF_NAME = ["road", "kerb", "grass", "gravel", "run-off", "sand", "pit lane", "wall"];
// grip multiplier, rolling drag (N per kg at low speed), speed drag (N per kg per m/s), bumpiness
export const SURF_PROPS = [
  { grip: 1.0, drag: 0.0, vdrag: 0.0, bump: 0.0 },
  { grip: 0.94, drag: 0.05, vdrag: 0.0, bump: 0.6 },
  { grip: 0.52, drag: 0.6, vdrag: 0.012, bump: 0.35 },
  { grip: 0.46, drag: 1.6, vdrag: 0.07, bump: 0.8 },
  { grip: 0.9, drag: 0.05, vdrag: 0.0, bump: 0.05 },
  { grip: 0.42, drag: 2.0, vdrag: 0.08, bump: 0.6 },
  { grip: 0.98, drag: 0.0, vdrag: 0.0, bump: 0.0 },
  { grip: 0.6, drag: 0.0, vdrag: 0.0, bump: 0.0 },
];
export const BARRIER = { ARMCO: 0, TYRES: 1, CONCRETE: 2, TECPRO: 3 };

const CELL = 25;

export class Track {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    const L = buildLayout(def);
    this.layout = L;
    const N = (this.N = L.N);
    const ds = (this.ds = L.ds);
    this.length = L.length;
    this.street = !!def.street;
    this.x = Float32Array.from(L.x); this.z = Float32Array.from(L.z); this.y = Float32Array.from(L.y);
    this.hw = new Float32Array(N); for (let i = 0; i < N; i++) this.hw[i] = L.w[i] / 2;
    this.bank = Float32Array.from(L.bank);
    this.flags = L.flags;
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    this.nx = new Float32Array(N); this.nz = new Float32Array(N);
    this.k = new Float32Array(N); this.pitch = new Float32Array(N); this.vcurv = new Float32Array(N);
    this.heading = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz; this.nx[i] = -dz; this.nz[i] = dx;
      this.heading[i] = Math.atan2(dz, dx);
    }
    const kraw = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dh = this.heading[b] - this.heading[a];
      while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
      kraw[i] = dh / (2 * ds);
      this.pitch[i] = (this.y[b] - this.y[a]) / (2 * ds);
      this.vcurv[i] = (this.y[b] - 2 * this.y[i] + this.y[a]) / (ds * ds);
    }
    this.k.set(blurCircular(kraw, 2));
    const vc = blurCircular(this.vcurv, 4); this.vcurv.set(vc);

    this._buildGrid();
    this._buildSides();
    this._buildPit();
    this._buildMarkers();
  }

  // ---------- helpers ----------
  wrap(i) { const N = this.N; return ((i % N) + N) % N; }
  sOf(i) { return i * this.ds; }
  idx(s) { return this.wrap(Math.round(s / this.ds)); }
  /** signed distance along the lap from a to b (shortest way round) */
  sDelta(a, b) { let d = b - a; const L = this.length; if (d > L / 2) d -= L; if (d < -L / 2) d += L; return d; }

  /** world position of a point at track distance s and lateral offset d (+ = right) */
  toWorld(s, d, out) {
    out = out || {};
    const f = (((s % this.length) + this.length) % this.length) / this.ds;
    const i0 = Math.floor(f) % this.N, i1 = (i0 + 1) % this.N, t = f - Math.floor(f);
    const x = this.x[i0] + (this.x[i1] - this.x[i0]) * t, z = this.z[i0] + (this.z[i1] - this.z[i0]) * t;
    const nx = this.nx[i0] + (this.nx[i1] - this.nx[i0]) * t, nz = this.nz[i0] + (this.nz[i1] - this.nz[i0]) * t;
    out.x = x + nx * d; out.z = z + nz * d;
    out.y = this.y[i0] + (this.y[i1] - this.y[i0]) * t + d * Math.tan(this.bank[i0]);
    out.heading = Math.atan2(this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t, this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t);
    out.i = i0;
    return out;
  }

  // ---------- spatial grid ----------
  _buildGrid() {
    let minx = 1e9, minz = 1e9, maxx = -1e9, maxz = -1e9;
    for (let i = 0; i < this.N; i++) { minx = Math.min(minx, this.x[i]); maxx = Math.max(maxx, this.x[i]); minz = Math.min(minz, this.z[i]); maxz = Math.max(maxz, this.z[i]); }
    this.bounds = { minx, maxx, minz, maxz };
    this.gx0 = minx - 200; this.gz0 = minz - 200;
    this.gw = Math.ceil((maxx - minx + 400) / CELL); this.gh = Math.ceil((maxz - minz + 400) / CELL);
    this.cells = new Map();
    for (let i = 0; i < this.N; i++) {
      const key = this._cell(this.x[i], this.z[i]);
      let list = this.cells.get(key); if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
  }
  _cell(x, z) { return Math.floor((x - this.gx0) / CELL) * 100000 + Math.floor((z - this.gz0) / CELL); }
  /** indices of samples within roughly r metres of (x,z) */
  near(x, z, r, cb) {
    const c0 = Math.floor((x - r - this.gx0) / CELL), c1 = Math.floor((x + r - this.gx0) / CELL);
    const r0 = Math.floor((z - r - this.gz0) / CELL), r1 = Math.floor((z + r - this.gz0) / CELL);
    for (let c = c0; c <= c1; c++) for (let q = r0; q <= r1; q++) {
      const list = this.cells.get(c * 100000 + q);
      if (list) for (let k = 0; k < list.length; k++) cb(list[k]);
    }
  }
  /** nearest sample anywhere on the circuit (used once, then queries follow a hint) */
  nearestIndex(x, z, y) {
    let best = -1, bd = 1e18;
    for (let r = 30; best < 0 && r < 5000; r *= 2) {
      this.near(x, z, r, (i) => {
        const dy = y == null ? 0 : Math.abs(this.y[i] - y) * 3;
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2 + dy * dy;
        if (d < bd) { bd = d; best = i; }
      });
    }
    return best < 0 ? 0 : best;
  }

  /**
   * Locate a point relative to the circuit, starting near `hint` (a sample index). Writes into `out`:
   *   i (sample), t (0..1 to next sample), s (distance along lap), d (signed lateral offset, + right),
   *   y (surface height), heading (track direction)
   */
  query(x, z, hint, out) {
    out = out || {};
    const N = this.N, W = 14;
    let center = hint == null || hint < 0 ? this.nearestIndex(x, z) : hint;
    let best = center, bd = 1e18;
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (let k = -W; k <= W; k++) {
        const i = (center + k + N) % N;
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      const off = Math.abs(((best - center + N + N / 2) % N) - N / 2);
      if (off >= W - 1) { center = best; moved = true; }
      if (!moved) break;
    }
    // project onto the segment best..best+1 or best-1..best
    let i0 = best, i1 = (best + 1) % N;
    let px = x - this.x[i0], pz = z - this.z[i0];
    let t = px * this.tx[i0] + pz * this.tz[i0];
    if (t < 0) { i1 = i0; i0 = (best - 1 + N) % N; px = x - this.x[i0]; pz = z - this.z[i0]; t = px * this.tx[i0] + pz * this.tz[i0]; }
    const segLen = this.ds;
    const tf = clamp(t / segLen, 0, 1);
    const cx = this.x[i0] + (this.x[i1] - this.x[i0]) * tf, cz = this.z[i0] + (this.z[i1] - this.z[i0]) * tf;
    const nx = this.nx[i0] + (this.nx[i1] - this.nx[i0]) * tf, nz = this.nz[i0] + (this.nz[i1] - this.nz[i0]) * tf;
    const d = (x - cx) * nx + (z - cz) * nz;
    out.i = i0; out.t = tf; out.s = (i0 + tf) * this.ds; out.d = d;
    out.y = this.y[i0] + (this.y[i1] - this.y[i0]) * tf + d * Math.tan(this.bank[i0]);
    out.heading = this.heading[i0];
    return out;
  }

  // ---------- kerbs, run-off and barriers ----------
  _buildSides() {
    const N = this.N, ds = this.ds, def = this.def, street = this.street;
    const kerbOn = new Float64Array(N);
    for (let i = 0; i < N; i++) kerbOn[i] = Math.abs(this.k[i]) > 1 / 230 ? 1 : 0;
    // extend kerbs a little before and after each corner
    const ext = Math.round(14 / ds), kerbExt = new Float64Array(N);
    for (let i = 0; i < N; i++) if (kerbOn[i]) for (let j = -ext; j <= ext * 1.6; j++) kerbExt[this.wrap(i + j)] = 1;
    const cornerness = new Float64Array(N);
    for (let i = 0; i < N; i++) cornerness[i] = clamp(Math.abs(this.k[i]) * 160, 0, 1);
    const cb = blurCircular(cornerness, Math.round(40 / ds));
    // which side is "outside": positive curvature = right turn -> outside is left (side 0)
    const kb = blurCircular(this.k, Math.round(30 / ds));

    this.kerb = [new Float32Array(N), new Float32Array(N)];
    this.strip = [new Float32Array(N), new Float32Array(N)];
    this.run = [new Float32Array(N), new Float32Array(N)];
    this.runSurf = [new Uint8Array(N), new Uint8Array(N)];
    this.bar = [new Float32Array(N), new Float32Array(N)];
    this.barType = [new Uint8Array(N), new Uint8Array(N)];
    const base = def.runoff == null ? 16 : def.runoff;
    const kerbW = street ? 0.9 : 1.3;

    for (let side = 0; side < 2; side++) {
      const want = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const outside = (kb[i] > 0 && side === 0) || (kb[i] < 0 && side === 1);
        const c = cb[i];
        this.kerb[side][i] = kerbExt[i] ? kerbW : 0;
        this.strip[side][i] = street ? 0 : 2;
        let run = street ? base : outside ? base * (1 + 1.4 * c) : base * (1 - 0.25 * c);
        if (this.flags[i] & 2) run = 0.6; // tunnel walls
        if (this.flags[i] & 1) run = 1.4; // bridge parapets
        want[i] = run;
        let surf;
        if (street) surf = SURF.RUNOFF;
        else if (def.runoffStyle === "gravel") surf = outside && c > 0.2 ? SURF.GRAVEL : SURF.GRASS;
        else if (def.runoffStyle === "asphalt") surf = outside && c > 0.2 ? SURF.RUNOFF : def.theme === "desert" ? SURF.SAND : SURF.GRASS;
        else surf = SURF.GRASS;
        this.runSurf[side][i] = surf;
        this.barType[side][i] = street || (this.flags[i] & 3) ? BARRIER.CONCRETE : outside && c > 0.45 ? BARRIER.TECPRO : c > 0.3 ? BARRIER.TYRES : BARRIER.ARMCO;
      }
      // smooth the run-off so the walls flow
      const sm = blurCircular(want, Math.round(24 / ds));
      for (let i = 0; i < N; i++) this.run[side][i] = sm[i];
    }

    // never let the corridor fold over itself on the inside of a bend, or reach into another
    // part of the circuit: stop halfway to the neighbouring section
    const excl = Math.round(160 / ds);
    for (let i = 0; i < N; i++) {
      const hw = this.hw[i];
      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? -1 : 1;
        let limit = 1e9;
        // inside of a bend: the offset curve folds at the radius of curvature
        const k = this.k[i];
        if ((k > 0 && side === 1) || (k < 0 && side === 0)) limit = Math.min(limit, 0.8 / Math.abs(k));
        const nx = this.nx[i] * sgn, nz = this.nz[i] * sgn;
        this.near(this.x[i] + nx * 40, this.z[i] + nz * 40, 90, (j) => {
          let di = Math.abs(i - j); di = Math.min(di, N - di);
          if (di < excl) return;
          if (Math.abs(this.y[i] - this.y[j]) > 5.5) return; // a bridge over or under
          const vx = this.x[j] - this.x[i], vz = this.z[j] - this.z[i];
          const along = vx * nx + vz * nz;
          const across = Math.abs(vx * this.tx[i] + vz * this.tz[i]);
          if (along > 0 && across < 18) limit = Math.min(limit, along / 2 - 1.2);
        });
        const minimum = hw + 1.2;
        let total = hw + this.kerb[side][i] + this.strip[side][i] + this.run[side][i];
        if (total > limit) {
          let spare = Math.max(minimum, limit) - hw;
          const kerb = Math.min(this.kerb[side][i], spare); spare -= kerb;
          const strip = Math.min(this.strip[side][i], spare); spare -= strip;
          this.kerb[side][i] = kerb; this.strip[side][i] = strip; this.run[side][i] = Math.max(0, spare);
          total = hw + kerb + strip + Math.max(0, spare);
          if (limit < minimum) this.tight = (this.tight || 0) + 1;
        }
        this.bar[side][i] = total;
      }
    }
    // final light smoothing of the barrier line without letting it grow past the limits
    for (let side = 0; side < 2; side++) {
      const sm = blurCircular(this.bar[side], 2);
      for (let i = 0; i < N; i++) this.bar[side][i] = Math.min(this.bar[side][i], sm[i] + 0.5);
    }
  }

  // ---------- pit lane ----------
  _buildPit() {
    const L = this.layout, N = this.N, ds = this.ds;
    const mainLen = L.cmds[0][1];
    // the main straight runs from s = -startAt to mainLen - startAt
    const startAt = this.def.startAt != null ? this.def.startAt : mainLen * 0.58;
    // layout was rotated by def.startAt; we rotate here instead so the main straight is known
    if (this.def.startAt == null) {
      const shift = Math.round(startAt / ds);
      this._rotateAll(shift);
    }
    const sA = -startAt + 26, sB = mainLen - startAt - 26;
    const hwMid = this.hw[0];
    // choose the side with more free space next to the start line
    let freeL = 1e9, freeR = 1e9;
    for (let s = sA; s < sB; s += 10) {
      const i = this.idx(s);
      freeL = Math.min(freeL, this._freeSpace(i, 0)); freeR = Math.min(freeR, this._freeSpace(i, 1));
    }
    const side = this.def.pitSide != null ? (this.def.pitSide === "L" ? 0 : 1) : freeR >= freeL ? 1 : 0;
    const ramp = 70;
    const wall = hwMid + 2.6, fast = hwMid + 5.4, work = hwMid + 9.8, garage = hwMid + 13;
    this.pit = {
      side, sign: side === 0 ? -1 : 1, sIn: sA, sOut: sB, ramp,
      wallStart: sA + ramp, wallEnd: sB - ramp, wall, fast, work, garage,
      limitStart: sA + 30, limitEnd: sB - 30, speedLimit: 80 / 3.6,
      boxStart: -95, boxSpacing: 17, free: side === 0 ? freeL : freeR,
    };
    // widen the corridor on the pit side to include the lane and garages
    for (let s = sA - 10; s <= sB + 10; s += ds) {
      const i = this.idx(s);
      const inside = s >= sA && s <= sB;
      const want = inside ? garage : Math.max(this.bar[side][i], hwMid + 2);
      this.bar[side][i] = Math.max(this.bar[side][i], want);
      if (inside) { this.runSurf[side][i] = SURF.PIT; this.strip[side][i] = 0; this.kerb[side][i] = 0; this.run[side][i] = garage - this.hw[i]; this.barType[side][i] = BARRIER.CONCRETE; }
    }
    // the main straight's other side gets a proper wall too (pit straight)
  }
  _freeSpace(i, side) {
    const N = this.N, sgn = side === 0 ? -1 : 1, nx = this.nx[i] * sgn, nz = this.nz[i] * sgn;
    let free = 200;
    this.near(this.x[i] + nx * 60, this.z[i] + nz * 60, 120, (j) => {
      let di = Math.abs(i - j); di = Math.min(di, N - di);
      if (di < Math.round(160 / this.ds)) return;
      const vx = this.x[j] - this.x[i], vz = this.z[j] - this.z[i];
      const along = vx * nx + vz * nz, across = Math.abs(vx * this.tx[i] + vz * this.tz[i]);
      if (along > 0 && across < 30) free = Math.min(free, along);
    });
    return free;
  }
  _rotateAll(k) {
    if (!k) return;
    const rot = (arr) => { const n = arr.length, tmp = arr.slice(); for (let i = 0; i < n; i++) arr[i] = tmp[(i + k) % n]; };
    for (const key of ["x", "z", "y", "hw", "bank", "flags", "tx", "tz", "nx", "nz", "k", "pitch", "vcurv", "heading"]) rot(this[key]);
    for (let side = 0; side < 2; side++) for (const key of ["kerb", "strip", "run", "runSurf", "bar", "barType"]) rot(this[key][side]);
    this._buildGrid();
    this.startShift = k * this.ds;
  }

  /** where the pit path is at track distance s (lateral offset), or null outside the pit area */
  pitPathOffset(s) {
    const p = this.pit; if (!p) return null;
    const ds = this.sDelta(p.sIn, s), len = p.sOut - p.sIn;
    if (ds < 0 || ds > len) return null;
    const edge = this.hw[0] - 2.2;
    const a = smoothstep(0, p.ramp, ds), b = smoothstep(len, len - p.ramp, ds);
    return p.sign * (edge + (p.fast - edge) * Math.min(a, b));
  }
  /** box position (track distance) for team slot `slot` */
  boxS(slot) { return this.pit.boxStart + slot * this.pit.boxSpacing; }
  /** is there a pit wall at distance s? */
  hasPitWall(s) { const p = this.pit; const d = this.sDelta(p.wallStart, s); return d >= 0 && d <= p.wallEnd - p.wallStart; }

  // ---------- grid, sectors, DRS ----------
  _buildMarkers() {
    const N = this.N, ds = this.ds, Lg = this.length;
    // pole goes on the inside of turn one
    let kSum = 0;
    for (let s = 0; s < 400; s += ds) kSum += this.k[this.idx(s)];
    const poleSide = kSum > 0 ? 1 : -1;
    const pitSign = this.pit ? this.pit.sign : 1;
    this.grid = [];
    for (let i = 0; i < 24; i++) {
      this.grid.push({ s: -9 - i * 8.2, d: (i % 2 === 0 ? poleSide : -poleSide) * Math.min(2.8, this.hw[0] - 2) });
    }
    // sectors: split the lap in thirds, nudged onto straights
    const pickNear = (s) => {
      let best = s, bk = 1e9;
      for (let o = -250; o <= 250; o += ds) { const k = Math.abs(this.k[this.idx(s + o)]); if (k < bk - 1e-5) { bk = k; best = s + o; } }
      return ((best % Lg) + Lg) % Lg;
    };
    this.sectors = [0, pickNear(Lg / 3), pickNear((2 * Lg) / 3)];
    // DRS zones on the longest straights
    const straight = new Uint8Array(N);
    for (let i = 0; i < N; i++) straight[i] = Math.abs(this.k[i]) < 1 / 700 ? 1 : 0;
    const runs = [];
    let i0 = 0; while (straight[i0] && i0 < N) i0++;
    for (let c = 0, i = i0; c < N; c++, i = (i + 1) % N) {
      if (straight[i] && !straight[(i - 1 + N) % N]) {
        let j = i, len = 0; while (straight[j] && len < N) { j = (j + 1) % N; len++; }
        runs.push({ start: i * ds, len: len * ds });
      }
    }
    runs.sort((a, b) => b.len - a.len);
    this.drs = runs.filter((r) => r.len >= 380).slice(0, 3).map((r) => ({
      detect: (((r.start - 260) % Lg) + Lg) % Lg,
      start: (r.start + 70) % Lg,
      end: (r.start + r.len - 90) % Lg,
      len: r.len - 160,
    }));
    // track limits / corner list (apexes) for analysis and commentary
    this.corners = [];
    let inCorner = false, cs = 0, peak = 0, peakI = 0, num = 0;
    for (let c = 0; c <= N; c++) {
      const i = c % N, k = Math.abs(this.k[i]);
      if (!inCorner && k > 1 / 400) { inCorner = true; cs = i; peak = k; peakI = i; }
      else if (inCorner && k > peak) { peak = k; peakI = i; }
      else if (inCorner && k < 1 / 600) {
        inCorner = false;
        if ((i - cs + N) % N * ds > 25 || peak > 1 / 90) this.corners.push({ n: ++num, s: peakI * ds, radius: 1 / peak, dir: this.k[peakI] > 0 ? "R" : "L" });
      }
    }
  }

  /** run-off and surface at sample i, lateral offset d */
  surfaceAt(i, d) {
    const side = d < 0 ? 0 : 1, ad = Math.abs(d), hw = this.hw[i];
    if (ad <= hw) return SURF.ROAD;
    const kerb = this.kerb[side][i];
    if (ad <= hw + kerb) return SURF.KERB;
    if (this.pit && side === this.pit.side && this.runSurf[side][i] === SURF.PIT) return SURF.PIT;
    if (ad <= hw + kerb + this.strip[side][i]) return this.def.runoffStyle === "asphalt" ? SURF.RUNOFF : SURF.GRASS;
    if (ad <= this.bar[side][i]) return this.runSurf[side][i];
    return SURF.WALL;
  }

  /** a few checks used by the tests and the debug view */
  validate() {
    const problems = [];
    if (this.tight) problems.push(`${this.tight} samples where two parts of the circuit are very close`);
    let minR = 1e9;
    for (let i = 0; i < this.N; i++) minR = Math.min(minR, 1 / Math.max(1e-6, Math.abs(this.k[i])));
    if (minR < 9) problems.push(`tightest bend radius ${minR.toFixed(1)} m is too tight for the cars`);
    if (!this.drs.length) problems.push("no DRS zone");
    return { minRadius: minR, problems };
  }
}

// cache so each circuit is built once
const cache = new Map();
export function getTrack(def) {
  if (!cache.has(def.id)) cache.set(def.id, new Track(def));
  return cache.get(def.id);
}
