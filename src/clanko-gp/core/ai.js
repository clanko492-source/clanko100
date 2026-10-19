// CLANKO GP — computer drivers and the automatic pit-lane pilot.
// AI cars drive the same physics as the player: they read the racing line and target speeds,
// steer with pure pursuit, and manage traffic, overtakes, defending, mistakes and recovery.

import { clamp, lerp, wrapAngle, smoothstep, rng } from "./math.js";

export const PERSONALITIES = {
  aggressive: { aggression: 0.9, defence: 0.85, consistency: 0.9, tyreCare: 0.85 },
  defensive: { aggression: 0.5, defence: 0.95, consistency: 0.95, tyreCare: 1.0 },
  cautious: { aggression: 0.35, defence: 0.5, consistency: 0.98, tyreCare: 1.1 },
  consistent: { aggression: 0.6, defence: 0.7, consistency: 0.99, tyreCare: 1.05 },
};

/** shared pure-pursuit steering toward a point given as (s ahead, lateral offset) */
function steerTo(car, track, sAhead, dTarget) {
  const p = track.toWorld(car.q.s + sAhead, dTarget, _tmp);
  const dx = p.x - car.x, dz = p.z - car.z;
  const ch = Math.cos(car.h), sh = Math.sin(car.h);
  const lx = dx * ch + dz * sh, lz = -dx * sh + dz * ch; // forward, right
  const Ld = Math.max(4, Math.hypot(lx, lz));
  const alpha = Math.atan2(lz, Math.max(0.5, lx));
  const kappa = (2 * Math.sin(alpha)) / Ld;
  const angle = Math.atan(kappa * car.cls.wheelbase);
  return angle / car.cls.maxSteer;
}
const _tmp = {};

export class AIDriver {
  constructor(entity, opts = {}) {
    this.e = entity;
    this.skill = opts.skill != null ? opts.skill : 0.97; // fraction of the ideal target speed
    const per = PERSONALITIES[opts.personality || "consistent"];
    this.aggression = opts.aggression != null ? opts.aggression : per.aggression;
    this.defence = opts.defence != null ? opts.defence : per.defence;
    this.consistency = opts.consistency != null ? opts.consistency : per.consistency;
    this.wetSkill = opts.wetSkill != null ? opts.wetSkill : 0.95;
    this.tyreCare = opts.tyreCare != null ? opts.tyreCare : per.tyreCare;
    this.rand = rng(opts.seed || 1234);
    this.offset = 0;           // current lateral offset from the racing line
    this.offsetTarget = 0;
    this.mistake = 0; this.mistakeUntil = -1;
    this.stuckTime = 0; this.recoverTimer = 0; this.recoverDir = 1;
    this.defendUntil = -1; this.lastDefend = -1e9;
    this.wantReset = false;
    this.input = { steer: 0, throttle: 0, brake: 0, drs: false, analog: true, reverse: false };
  }

  update(dt, ctx) {
    const e = this.e, car = e.car, track = ctx.track, inp = this.input;
    const line = ctx.line, prof = e.profile || ctx.profile;
    const q = car.q, N = track.N;
    const u = car.u, speed = car.speed;
    const now = ctx.time;
    inp.drs = false;
    inp.reverse = false;

    // ---------- recovery ----------
    const head = wrapAngle(car.h - track.heading[q.i]);
    const offTrack = Math.abs(q.d) > track.hw[q.i] + 0.8;
    if (speed < 1.5 && ctx.racing) this.stuckTime += dt; else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    if (this.recoverTimer > 0) {
      this.recoverTimer -= dt;
      // reverse out, steering to point the nose back down the track
      inp.throttle = 0; inp.brake = 1; inp.reverse = true; inp.steer = clamp(-head * 1.5, -1, 1) * this.recoverDir;
      if (this.recoverTimer <= 0) this.stuckTime = 0;
      return inp;
    }
    if (this.stuckTime > 10) { this.wantReset = true; this.stuckTime = 0; }
    if (this.stuckTime > 2.2 && (offTrack || Math.abs(head) > 1.2)) {
      if (this.stuckTime > 7) { this.wantReset = true; this.stuckTime = 0; }
      else if (car.reverse === false && Math.abs(head) > 0.6) { this.recoverTimer = 1.6; this.recoverDir = 1; }
    }
    // pointing the wrong way at speed? brake and turn
    if (Math.abs(head) > 1.9 && speed > 3) { inp.throttle = 0; inp.brake = 1; inp.steer = clamp(-head, -1, 1); return inp; }

    // ---------- where to drive ----------
    const lookTime = 0.32;
    const sAhead = clamp(6 + speed * lookTime, 7, 42);
    const iAhead = track.wrap(q.i + Math.round(sAhead / track.ds));
    const water = ctx.waterAvg || 0;
    let pace = this.skill * lerp(1, this.wetSkill, clamp(water * 1.4, 0, 1)) * (ctx.paceScale || 1);
    // damage and tyre wear slow the car down
    const dmg = car.damage;
    pace *= 1 - 0.08 * (dmg.fwL + dmg.fwR) / 2 - 0.1 * dmg.rw - 0.05 * dmg.floor;
    let wearAvg = 0; for (const w of car.wheels) wearAvg += w.wear; wearAvg /= 4;
    pace *= 1 - 0.05 * Math.max(0, wearAvg - 0.4);
    if (car.wheels.some((w) => w.puncture)) pace *= 0.45;
    if (ctx.flag === "yellow" && ctx.yellowSector === e.sector) pace *= 0.93;

    // mistakes: occasionally brake too late for a corner
    const brakeAhead = prof[track.wrap(q.i + Math.round((speed * 1.2) / track.ds))];
    if (now > this.mistakeUntil && brakeAhead < speed - 15 && this.mistake === 0) {
      const chance = (1 - this.consistency) * 0.9 * (1 + water * 3);
      if (this.rand() < chance * dt * 4) { this.mistake = 0.06 + this.rand() * 0.08; this.mistakeUntil = now + 3; }
    }
    if (now > this.mistakeUntil) this.mistake = 0;

    // target speed: the profile a short distance ahead (reaction time)
    const iNow = track.wrap(q.i + Math.round((speed * 0.22) / track.ds));
    let vTarget = Math.min(prof[iNow], prof[q.i]) * pace * (1 + this.mistake);

    // ---------- traffic ----------
    let desired = 0;
    const myD = q.d;
    let follow = Infinity;
    const hwHere = track.hw[q.i] - 1.2;
    let sideBlockL = false, sideBlockR = false;
    let dMin = -Infinity, dMax = Infinity; // hard limits: never steer into a car alongside
    if (ctx.cars) {
      for (const o of ctx.cars) {
        if (o === e || o.removed || o.ghost) continue;
        const oc = o.car;
        if (o.pitPilot && Math.abs(oc.q.d) > track.hw[oc.q.i] + 0.5) continue; // in the pit lane
        const gap = track.sDelta(q.s, oc.q.s);
        if (gap < -10 || gap > Math.max(40, u * 2.2)) continue;
        const lat = oc.q.d - myD;
        const obstacle = o.retired || oc.speed < Math.max(6, u * 0.45) || o.held;
        if (Math.abs(gap) < 6) {
          // alongside: keep a car's width of space and remember which side is taken
          if (lat > 0 && lat < 3.2) sideBlockR = true;
          if (lat < 0 && lat > -3.2) sideBlockL = true;
          const yawO = Math.abs(Math.sin(oc.h - track.heading[oc.q.i])) * 2.2;
          if (lat > 0.4) dMax = Math.min(dMax, oc.q.d - 2.9 - yawO);
          else if (lat < -0.4) dMin = Math.max(dMin, oc.q.d + 2.9 + yawO);
          if (Math.abs(lat) < 2.7) desired += (lat > 0 ? -1 : 1) * (2.8 - Math.abs(lat)) * 1.2;
          // side by side into a corner: the car on the outside and slightly behind gives way
          if (gap > 0.5 && Math.abs(lat) < 3.4) {
            let kSum = 0; for (let k = 10; k < 50; k += 5) kSum += track.k[track.wrap(q.i + k)];
            const outside = (kSum > 0 && lat > 0) || (kSum < 0 && lat < 0) ? false : true;
            if (outside && Math.abs(kSum) > 0.02) vTarget *= 0.96;
          }
          continue;
        }
        if (gap <= 0) continue;
        // ahead of us
        // a car sitting at an angle takes up more of the road
        const yawOff = Math.abs(Math.sin(oc.h - track.heading[oc.q.i]));
        const width = 2.35 + yawOff * 2.4 + (obstacle ? 0.8 : 0);
        const inLane = Math.abs(lat) < width;
        // where will our path be when we reach it?
        const iO = oc.q.i;
        const myPathD = line[iO] + this.offset;
        const onPath = Math.abs(oc.q.d - myPathD) < width + 0.15;
        const closing = u - oc.u;
        if ((onPath || inLane) && (obstacle || ((closing > 0.5 || vTarget > oc.u + 2) && gap < 50))) {
          const left = oc.q.d - (width + 0.7), right = oc.q.d + (width + 0.7);
          const lineD = line[iAhead];
          const canL = left > -hwHere && !sideBlockL, canR = right < hwHere && !sideBlockR;
          let side = 0;
          if (canL && canR) side = Math.abs(left - lineD) < Math.abs(right - lineD) ? -1 : 1;
          else if (canL) side = -1; else if (canR) side = 1;
          const mayPass = obstacle || (ctx.noOvertake !== true && this.aggression > 0.2);
          if (side !== 0 && mayPass) desired = (side < 0 ? left : right) - lineD;
        }
        if (inLane) {
          // never run into the back of anyone: keep a safe gap and match their braking
          const headway = 4.5 + u * (0.16 + (1 - this.aggression) * 0.08);
          const oNext = o.profile ? Math.min(oc.u, o.profile[track.wrap(iO + Math.round(Math.max(10, oc.u) * 0.8 / track.ds))]) : oc.u;
          const vObs = obstacle ? Math.min(oc.u, 2) : oNext;
          const aBrk = 14 + Math.min(18, u * 0.25);
          const room = gap - headway;
          const vKin = Math.sqrt(Math.max(0, vObs * vObs + 2 * aBrk * Math.max(0, room))) * (room < 0 ? 0.9 : 1);
          follow = Math.min(follow, Math.max(obstacle ? 0 : 6, vKin));
        }
      }
    }
    // defending: one move toward the inside of the next corner when someone is close behind
    if (ctx.cars && this.defence > 0.4 && now > this.defendUntil && now - this.lastDefend > 6) {
      for (const o of ctx.cars) {
        if (o === e || o.inPit) continue;
        const gap = track.sDelta(o.car.q.s, q.s);
        if (gap > 0 && gap < 22 && o.car.u > u + 1.5 && this.rand() < this.defence * dt * 2) {
          let kSum = 0; for (let k = 10; k < 60; k += 5) kSum += track.k[track.wrap(q.i + k)];
          this.defendSide = kSum > 0 ? 1 : -1; this.defendUntil = now + 2.2; this.lastDefend = now;
          break;
        }
      }
    }
    if (now < this.defendUntil) desired = this.defendSide * (track.hw[q.i] - 2.4) - line[iAhead];
    // blue flags: let faster cars through
    if (e.blueFlag) { desired = (line[q.i] > 0 ? -1 : 1) * 3.5; vTarget *= 0.92; }
    // safety car / virtual safety car
    if (ctx.vsc) vTarget = Math.min(vTarget, prof[q.i] * 0.62);
    if (ctx.safetyCar && e.scTarget != null) { vTarget = Math.min(vTarget, e.scTarget); desired = 0; }
    vTarget = Math.min(vTarget, follow);
    if (e.pitPilot) return e.pitPilot.drive(dt, ctx, inp);

    this.offsetTarget = clamp(desired, -6, 6);
    this.offset += clamp(this.offsetTarget - this.offset, -2.2 * dt, 2.2 * dt);
    let dT = line[iAhead] + this.offset;
    const hwA = track.hw[iAhead] - 1.1;
    dT = clamp(dT, -hwA, hwA);
    // respect the car alongside: hold our line (or the space we have) instead of turning in on it
    if (dMin > -Infinity || dMax < Infinity) {
      if (dMin <= dMax) dT = clamp(dT, dMin, dMax);
      else dT = myD; // squeezed from both sides: keep straight
      this.offset = clamp(this.offset, dMin - line[iAhead], dMax - line[iAhead]);
      if (dT !== line[iAhead] + this.offset && Math.abs(dT - (line[iAhead] + this.offset)) > 1.5) vTarget *= 0.985;
    }
    // when off the track, rejoin gently
    if (offTrack) dT = clamp(q.d * 0.6, -hwA, hwA);

    // ---------- steering ----------
    let st = steerTo(car, track, sAhead, dT);
    // damp yaw and catch slides
    const beta = Math.atan2(car.v, Math.max(3, Math.abs(car.u)));
    st += clamp(-beta * 1.6, -0.6, 0.6) * smoothstep(0.05, 0.2, Math.abs(beta));
    // understeer: more lock past the front tyres' peak only makes it worse, so hold the lock and lift
    const frontSlip = Math.max(Math.abs(car.wheels[0].slip), Math.abs(car.wheels[1].slip)) / 0.088;
    const last = this.lastSteer || 0;
    this.understeer = frontSlip > 1.0 && Math.sign(st) === Math.sign(last) && Math.abs(st) > Math.abs(last);
    if (this.understeer) st = last * (frontSlip > 1.15 ? 0.996 : 1);
    this.lastSteer = st;
    inp.steer = clamp(st, -1, 1);

    // ---------- pedals ----------
    const err = vTarget - u;
    let thr = 0, brk = 0;
    if (err > 0) thr = clamp(0.35 + err * 0.35, 0, 1);
    else if (err > -1.5) thr = clamp(0.3 + err * 0.2, 0, 0.3);
    else brk = clamp(-err * 0.16, 0, 1);
    // traction and lock-up management: feed the throttle in only as the rear tyres allow
    if (car.wheels[2].spinning || car.wheels[3].spinning) thr *= 0.8;
    const rearSlip = Math.max(Math.abs(car.wheels[2].slip), Math.abs(car.wheels[3].slip)) / 0.085;
    if (rearSlip > 0.65) thr *= clamp(1 - (rearSlip - 0.65) * 1.6, 0.15, 1);
    if (Math.abs(beta) > 0.07) thr *= 0.6;
    if (frontSlip > 1.0) { thr *= 0.55; if (frontSlip > 1.2 && speed > 25) { thr = 0; brk = Math.max(brk, 0.15); } }
    if (car.wheels[0].locked || car.wheels[1].locked) brk *= 0.75;
    // tyre care: lift a touch in long corners
    if (this.tyreCare > 1 && Math.abs(beta) > 0.05) thr *= 0.97;
    if (offTrack && Math.abs(q.d) > track.hw[q.i] + 3) thr = Math.min(thr, 0.55);
    inp.throttle = thr; inp.brake = brk;
    inp.drs = !!e.drsAllowed;
    return inp;
  }
}

/**
 * Drives a car through the pit lane: in along the entry, at the speed limit, into its box,
 * waits for the service, and back out when the lane is clear.
 */
export class PitPilot {
  constructor(entity, track, opts = {}) {
    this.e = entity; this.track = track;
    this.boxS = track.boxS(opts.box || 0);
    this.service = opts.service || { tyres: "medium", wing: false, repair: false, fuel: 0 };
    this.serviceTime = opts.serviceTime || 2.5;
    this.state = "entry"; this.timer = 0; this.done = false;
    this.penaltyHold = opts.penaltyHold || 0;
    this.onService = opts.onService; this.onRelease = opts.onRelease; this.onStop = opts.onStop;
    this.safeRelease = opts.safeRelease !== false;
    this.input = { steer: 0, throttle: 0, brake: 0, analog: true };
  }
  drive(dt, ctx, inp) {
    inp = inp || this.input;
    const e = this.e, car = e.car, track = this.track, pit = track.pit;
    const s = car.q.s, rel = track.sDelta(pit.sIn, s), len = pit.sOut - pit.sIn;
    const toBox = track.sDelta(s, this.boxS);
    const limit = pit.speedLimit * 0.985;
    let vT = limit, dT;
    const path = track.pitPathOffset(s);
    dT = path == null ? car.q.d : path;
    car.limiter = rel > 25 && rel < len - 25;
    if (this.state === "entry" || this.state === "lane") {
      this.state = rel > 40 ? "lane" : "entry";
      if (this.state === "entry") vT = Math.max(limit, Math.min(car.u, 60) - 10);
      if (toBox < 60 && toBox > -2) { this.state = "box"; }
    }
    if (this.state === "box") {
      dT = pit.sign * pit.work;
      vT = Math.min(limit, Math.sqrt(Math.max(0, 2 * 5.5 * (toBox - 0.4))));
      if (toBox < 0.6 && car.speed < 1.2) {
        this.state = "service"; this.timer = this.serviceTime + this.penaltyHold;
        car.vx = car.vz = car.r = 0;
        this.onStop && this.onStop(this);
      }
    }
    if (this.state === "service") {
      inp.steer = 0; inp.throttle = 0; inp.brake = 1;
      car.vx *= 0.5; car.vz *= 0.5; car.r *= 0.5;
      this.timer -= dt;
      if (this.timer <= 0) { this.onService && this.onService(this); this.state = "release"; this.holdTimer = 0; }
      return inp;
    }
    if (this.state === "release") {
      // wait for a gap in the fast lane
      let clear = true;
      if (this.safeRelease && ctx.cars) for (const o of ctx.cars) {
        if (o === this.e || !o.pitPilot) continue;
        const g = track.sDelta(o.car.q.s, s);
        if (g > 0 && g < 30 && Math.abs(o.car.q.d - pit.sign * pit.fast) < 3) clear = false;
      }
      this.holdTimer += dt;
      if (!clear && this.holdTimer < 6) { inp.throttle = 0; inp.brake = 1; inp.steer = 0; return inp; }
      this.state = "exit"; this.onRelease && this.onRelease(this);
    }
    if (this.state === "exit") {
      dT = path == null ? car.q.d : path;
      if (rel > len - 10 || path == null) { this.done = true; car.limiter = false; }
      if (rel > len - 25) vT = 70;
    }
    const sAhead = clamp(5 + car.speed * 0.3, 6, 25);
    const dAhead = this.state === "box" && toBox < 25 ? pit.sign * pit.work : (track.pitPathOffset(s + sAhead) ?? dT);
    inp.steer = clamp(steerTo(car, track, sAhead, this.state === "box" ? dT : dAhead), -1, 1);
    const err = vT - car.u;
    inp.throttle = err > 0 ? clamp(0.3 + err * 0.3, 0, 1) : 0;
    inp.brake = err < -0.5 ? clamp(-err * 0.25, 0, 1) : 0;
    return inp;
  }
}
