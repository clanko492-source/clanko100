// CLANKO GP — contacts with barriers and other cars, plus the damage they cause.
// Barriers follow the circuit, so a car can never leave the world: every contact is resolved
// against the wall on that side of the track with a proper impulse (no bouncing into orbit).

import { clamp } from "./math.js";
import { SURF } from "./track.js";

const E_WALL = 0.18, MU_WALL = 0.32, E_CAR = 0.22, MU_CAR = 0.25;

/** collision outline of a car in body coordinates (x forward, z right) */
export function carOutline(car) {
  if (car._outline) return car._outline;
  const f = car.a + 1.05, r = -(car.b + 0.85), hw = 0.98;
  car._outline = {
    front: f, rear: r, hw,
    points: [
      [f, -0.45], [f, 0.45], [f - 0.25, -hw], [f - 0.25, hw],
      [car.a, -hw - 0.02], [car.a, hw + 0.02], [0.25, -0.86], [0.25, 0.86],
      [-car.b, -hw - 0.02], [-car.b, hw + 0.02], [r, -0.55], [r, 0.55],
    ],
  };
  return car._outline;
}

function inertia(car) { return car.cls.inertia * (car.mass / 798); }

/** push a car out of the walls; returns the strongest impact speed this step (m/s) */
export function resolveBarriers(car, track, events) {
  const o = carOutline(car), q = car.q;
  track.query(car.x, car.z, car.hint, q); car.hint = q.i;
  const ch = Math.cos(car.h), sh = Math.sin(car.h);
  const ti = q.i, tx = track.tx[ti], tz = track.tz[ti], nx = track.nx[ti], nz = track.nz[ti];
  const fdt = ch * tx + sh * tz, fdn = ch * nx + sh * nz, rdt = -sh * tx + ch * tz, rdn = -sh * nx + ch * nz;
  let strongest = 0;
  const pit = track.pit;
  const sCar = q.s;
  const pitWall = pit && track.hasPitWall(sCar);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < o.points.length; k++) {
      const [bx, bz] = o.points[k];
      const along = fdt * bx + rdt * bz, lat = fdn * bx + rdn * bz;
      const pi = track.wrap(q.i + Math.round(along / track.ds));
      const dp = q.d + lat;
      const side = dp < 0 ? 0 : 1;
      let pen = Math.abs(dp) - track.bar[side][pi];
      let sgn = dp < 0 ? -1 : 1; // normal points back toward the centre: -sgn * n
      // pit wall: a thin wall between the track and the pit lane
      if (pitWall && side === pit.side && track.hasPitWall(track.sOf(pi))) {
        const carSide = q.d * pit.sign; // where the car's centre is
        const ps = dp * pit.sign;
        if (carSide < pit.wall && ps > pit.wall - 0.3) { pen = Math.max(pen, ps - (pit.wall - 0.3)); sgn = pit.sign; }
        else if (carSide >= pit.wall && ps < pit.wall + 0.3) { pen = Math.max(pen, pit.wall + 0.3 - ps); sgn = -pit.sign; }
      }
      if (pen <= 0) continue;
      // world normal pointing away from the wall
      const wnx = -sgn * track.nx[pi], wnz = -sgn * track.nz[pi];
      const rx = ch * bx - sh * bz, rz = sh * bx + ch * bz;
      const impact = applyImpulse(car, rx, rz, wnx, wnz, E_WALL, MU_WALL);
      car.x += wnx * pen; car.z += wnz * pen;
      if (impact > strongest) strongest = impact;
      if (impact > 0.8 && events) events.push({ type: "wall", car, speed: impact, bx, bz, x: car.x + rx, z: car.z + rz, y: car.y + 0.3 });
      // re-evaluate offset after the push
      q.d = (car.x - track.x[q.i]) * track.nx[q.i] + (car.z - track.z[q.i]) * track.nz[q.i];
    }
  }
  // safety net: if anything ever put the car outside the corridor, bring it back
  const side = q.d < 0 ? 0 : 1, lim = track.bar[side][q.i];
  if (Math.abs(q.d) > lim + 2.5) {
    const back = (Math.abs(q.d) - lim + 0.5) * (q.d < 0 ? 1 : -1);
    car.x += track.nx[q.i] * back; car.z += track.nz[q.i] * back;
    car.vx *= 0.3; car.vz *= 0.3;
  }
  return strongest;
}

function applyImpulse(car, rx, rz, nx, nz, e, mu) {
  const m = car.mass, I = inertia(car);
  const vpx = car.vx - car.r * rz, vpz = car.vz + car.r * rx;
  const vn = vpx * nx + vpz * nz;
  if (vn >= 0) return 0;
  const rn = rx * nz - rz * nx;
  const j = (-(1 + e) * vn) / (1 / m + (rn * rn) / I);
  const tx = -nz, tz = nx;
  const vt = vpx * tx + vpz * tz;
  const rt = rx * tz - rz * tx;
  let jt = -vt / (1 / m + (rt * rt) / I);
  jt = clamp(jt, -mu * j, mu * j);
  const Jx = j * nx + jt * tx, Jz = j * nz + jt * tz;
  car.vx += Jx / m; car.vz += Jz / m;
  car.r += (rx * Jz - rz * Jx) / I;
  car.r = clamp(car.r, -5, 5);
  return -vn;
}

// ---------- car to car ----------
function corners(car, o, out) {
  const ch = Math.cos(car.h), sh = Math.sin(car.h);
  const cx = car.x + ch * (o.front + o.rear) / 2, cz = car.z + sh * (o.front + o.rear) / 2;
  const hl = (o.front - o.rear) / 2, hw = o.hw;
  out.cx = cx; out.cz = cz; out.fx = ch; out.fz = sh; out.rx = -sh; out.rz = ch; out.hl = hl; out.hw = hw;
  return out;
}
const A = {}, B = {};
function project(b, ax, az) {
  const c = b.cx * ax + b.cz * az;
  const r = Math.abs(b.fx * ax + b.fz * az) * b.hl + Math.abs(b.rx * ax + b.rz * az) * b.hw;
  return [c - r, c + r];
}

/** resolve contacts between every pair of nearby cars */
export function resolveCars(cars, events) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.ghost || a.removed) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.ghost || b.removed) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      if (dx * dx + dz * dz > 49 || Math.abs(a.y - b.y) > 3) continue;
      collidePair(a, b, events);
    }
  }
}

export function collidePair(a, b, events) {
  const oa = carOutline(a), ob = carOutline(b);
  corners(a, oa, A); corners(b, ob, B);
  const axes = [[A.fx, A.fz], [A.rx, A.rz], [B.fx, B.fz], [B.rx, B.rz]];
  let minPen = 1e9, nX = 0, nZ = 0;
  for (const [ax, az] of axes) {
    const pa = project(A, ax, az), pb = project(B, ax, az);
    const pen = Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]);
    if (pen <= 0) return 0;
    if (pen < minPen) {
      minPen = pen;
      const dir = (B.cx - A.cx) * ax + (B.cz - A.cz) * az;
      nX = dir >= 0 ? ax : -ax; nZ = dir >= 0 ? az : -az; // normal from A to B
    }
  }
  // contact point: the centre of the overlap region (along the normal and along the contact face)
  const tXn = -nZ, tZn = nX;
  const ta = project(A, tXn, tZn), tb = project(B, tXn, tZn);
  const ct = (Math.max(ta[0], tb[0]) + Math.min(ta[1], tb[1])) / 2;
  const na = project(A, nX, nZ), nb = project(B, nX, nZ);
  const cn = (na[1] + nb[0]) / 2;
  const px = tXn * ct + nX * cn, pz = tZn * ct + nZ * cn;
  // tyres on the ground resist being spun round, so contacts act on a stiffer yaw
  const ma = a.mass, mb = b.mass, Ia = inertia(a) * 1.8, Ib = inertia(b) * 1.8;
  const rax = px - a.x, raz = pz - a.z, rbx = px - b.x, rbz = pz - b.z;
  const vax = a.vx - a.r * raz, vaz = a.vz + a.r * rax;
  const vbx = b.vx - b.r * rbz, vbz = b.vz + b.r * rbx;
  const rvx = vbx - vax, rvz = vbz - vaz;
  const vn = rvx * nX + rvz * nZ;
  // separate positions (split by mass)
  const corr = minPen + 0.01, wa = mb / (ma + mb), wb = ma / (ma + mb);
  a.x -= nX * corr * wa; a.z -= nZ * corr * wa; b.x += nX * corr * wb; b.z += nZ * corr * wb;
  if (vn >= 0) return 0;
  const ran = rax * nZ - raz * nX, rbn = rbx * nZ - rbz * nX;
  const j = (-(1 + E_CAR) * vn) / (1 / ma + 1 / mb + (ran * ran) / Ia + (rbn * rbn) / Ib);
  const tX = -nZ, tZ = nX, vt = rvx * tX + rvz * tZ;
  const rat = rax * tZ - raz * tX, rbt = rbx * tZ - rbz * tX;
  let jt = -vt / (1 / ma + 1 / mb + (rat * rat) / Ia + (rbt * rbt) / Ib);
  jt = clamp(jt, -MU_CAR * j, MU_CAR * j);
  const Jx = j * nX + jt * tX, Jz = j * nZ + jt * tZ;
  a.vx -= Jx / ma; a.vz -= Jz / ma; a.r -= (rax * Jz - raz * Jx) / Ia;
  b.vx += Jx / mb; b.vz += Jz / mb; b.r += (rbx * Jz - rbz * Jx) / Ib;
  a.r = clamp(a.r, -5, 5); b.r = clamp(b.r, -5, 5);
  const impact = -vn;
  if (events && impact > 0.6) {
    const toBody = (car, wx, wz) => { const ch = Math.cos(car.h), sh = Math.sin(car.h); return [wx * ch + wz * sh, -wx * sh + wz * ch]; };
    const [abx, abz] = toBody(a, rax, raz), [bbx, bbz] = toBody(b, rbx, rbz);
    events.push({ type: "car", car: a, other: b, speed: impact, bx: abx, bz: abz, x: px, z: pz, y: (a.y + b.y) / 2 + 0.3 });
    events.push({ type: "car", car: b, other: a, speed: impact, bx: bbx, bz: bbz, x: px, z: pz, y: (a.y + b.y) / 2 + 0.3, mirror: true });
  }
  return impact;
}

// ---------- damage ----------
/**
 * Turn an impact into component damage. Returns a list of parts that broke off (for debris).
 * model: "off" | "reduced" | "sim"
 */
export function applyDamage(car, ev, model) {
  if (model === "off" || !ev || car.retired) return [];
  const v = ev.speed, d = car.damage, bx = ev.bx, bz = ev.bz;
  const scale = model === "reduced" ? 0.4 : 1;
  const cap = model === "reduced" ? 0.85 : 1;
  const broken = [];
  const add = (key, amount, idx) => {
    if (amount <= 0) return;
    if (idx != null) {
      const before = d[key][idx];
      d[key][idx] = Math.min(cap, before + amount * scale);
      return before < 1 && d[key][idx] >= 1;
    }
    const before = d[key];
    d[key] = Math.min(cap, before + amount * scale);
    return before < 1 && d[key] >= 1;
  };
  const front = car.a + 0.3, rear = -car.b - 0.2;
  if (bx > front) {
    // nose and front wing
    const side = Math.abs(bz) < 0.3 ? "both" : bz < 0 ? "L" : "R";
    const amt = (v - 2.2) / 8;
    if ((side === "both" || side === "L") && add("fwL", amt)) broken.push("fwL");
    if ((side === "both" || side === "R") && add("fwR", amt)) broken.push("fwR");
    if (v > 16) add("engine", (v - 16) / 25);
  } else if (bx < rear) {
    if (add("rw", (v - 4.5) / 11)) broken.push("rw");
    add("floor", (v - 3) / 16);
    if (v > 12) add("gearbox", (v - 12) / 20);
  }
  // wheels and suspension
  for (let k = 0; k < 4; k++) {
    const w = car.wheels[k];
    const near = Math.abs(bx - w.x) < 0.75 && Math.sign(bz) === Math.sign(w.z);
    if (!near) continue;
    if (add("susp", (v - 3.2) / 9, k)) {
      if (model === "sim" && v > 13) { w.detached = true; broken.push("wheel" + k); }
    }
    if (model !== "reduced" && v > 6 && Math.random() < clamp((v - 6) / 14, 0, 0.7)) w.puncture = true;
  }
  add("body", (v - 3) / 22);
  car.lastImpact = v;
  if (model === "sim") {
    const wheelGone = car.wheels.some((w) => w.detached);
    if (wheelGone || v > 30 || d.engine >= 1) car.retired = true;
  }
  return broken;
}

/** a car stopped in the run-off or against a wall for a while counts as stuck */
export function isOffTrack(car, track) {
  const s = track.surfaceAt(car.q.i, car.q.d);
  return s !== SURF.ROAD && s !== SURF.KERB && s !== SURF.PIT;
}
