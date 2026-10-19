// CLANKO GP — vehicle dynamics. A four-wheel model with tyre slip, load transfer, downforce, drag,
// slipstream, engine + ERS, gearbox, brakes, tyre temperature/wear and surface effects.
// Integrated at a fixed 240 Hz. No three.js here so it also runs in Node for tests.

import { clamp, lerp, G, RHO, wrapAngle, smoothstep } from "./math.js";
import { CAR_CLASSES, COMPOUNDS, wetGrip, ERS_MODES, FUEL_MIXES, defaultSetup } from "./car-specs.js";
import { SURF, SURF_PROPS } from "./track.js";

export const DT = 1 / 240;

// Magic-formula style lateral curve, normalised so the peak is at x = 1 (x = slip / peak slip)
const MF_C = 1.38, MF_E = 0.35;
const MF_B = (() => {
  let best = 1, bestPeak = 0;
  for (let b = 0.6; b < 4; b += 0.004) {
    const f = (x) => Math.sin(MF_C * Math.atan(b * x - MF_E * (b * x - Math.atan(b * x))));
    // peak position close to 1
    let px = 0, pv = -1;
    for (let x = 0.2; x < 3; x += 0.01) { const v = f(x); if (v > pv) { pv = v; px = x; } }
    if (Math.abs(px - 1) < Math.abs(bestPeak - 1)) { bestPeak = px; best = b; }
  }
  return best;
})();
const MF_PEAK = Math.sin(MF_C * Math.atan(MF_B - MF_E * (MF_B - Math.atan(MF_B))));
export function mf(x) {
  const ax = Math.abs(x);
  const v = Math.sin(MF_C * Math.atan(MF_B * ax - MF_E * (MF_B * ax - Math.atan(MF_B * ax)))) / MF_PEAK;
  return x < 0 ? -v : v;
}

const POWER_RPM = [0, 3000, 6000, 9000, 10500, 11500, 12200, 12800];
const POWER_FRAC = [0.0, 0.2, 0.47, 0.8, 0.93, 1.0, 0.985, 0.9];
function powerFrac(rpm, rev) {
  const r = (rpm / rev) * 12500;
  if (r <= 0) return 0;
  for (let i = 1; i < POWER_RPM.length; i++) if (r <= POWER_RPM[i]) {
    const t = (r - POWER_RPM[i - 1]) / (POWER_RPM[i] - POWER_RPM[i - 1]);
    return POWER_FRAC[i - 1] + (POWER_FRAC[i] - POWER_FRAC[i - 1]) * t;
  }
  return POWER_FRAC[POWER_FRAC.length - 1];
}

const WHEEL_NAMES = ["FL", "FR", "RL", "RR"];

export class Car {
  constructor(opts = {}) {
    this.id = opts.id || "car";
    this.cls = CAR_CLASSES[opts.cls || "gp"];
    this.setup = { ...defaultSetup(), ...(opts.setup || {}) };
    this.perf = { power: 1, aero: 1, grip: 1, drag: 1, reliability: 1, ...(opts.perf || {}) }; // team car performance factors
    this.compound = opts.compound || "medium";
    const c = this.cls, a = c.wheelbase * (1 - c.frontWeight), b = c.wheelbase * c.frontWeight;
    this.a = a; this.b = b;
    this.wheels = WHEEL_NAMES.map((name, i) => ({
      name, front: i < 2, side: i % 2 === 0 ? -1 : 1,
      x: i < 2 ? a : -b, z: (i % 2 === 0 ? -1 : 1) * (i < 2 ? c.trackF : c.trackR) / 2,
      Fz: 0, mu: 1, surf: SURF.ROAD, water: 0, slip: 0, slipVel: 0, Fx: 0, Fy: 0, locked: false, spinning: false, spin: 0,
      omega: 0, rot: 0, temp: 70, core: 70, wear: 0, grain: 0, blister: 0, puncture: false, detached: false, kerb: 0, i: 0, d: 0,
    }));
    this.brakeTemp = [300, 300, 300, 300];
    this.reset(opts);
    this.damageModel = opts.damage || "sim"; // off | reduced | sim
    this.assists = { abs: false, tc: 0, autoGear: true, stability: false, ...(opts.assists || {}) };
    this.q = { i: 0, t: 0, s: 0, d: 0, y: 0, heading: 0 };
    this.hint = -1;
  }

  reset(opts = {}) {
    this.x = opts.x || 0; this.z = opts.z || 0; this.y = opts.y || 0; this.h = opts.h || 0;
    this.vx = 0; this.vz = 0; this.r = 0;
    this.u = 0; this.v = 0; this.speed = 0;
    this.steer = 0; this.steerInput = 0; this.throttle = 0; this.brake = 0;
    this.gear = 1; this.rpm = this.cls.idle; this.shiftTimer = 0; this.reverse = false; this.reverseHold = 0;
    this.ax = 0; this.ay = 0; this.axF = 0; this.ayF = 0;
    this.fuel = opts.fuel != null ? opts.fuel : this.setup.fuel;
    this.ers = this.cls.ersStore * 0.85; this.ersMode = 1; this.ersDeployedLap = 0; this.ersHarvest = 0; this.ersDeploying = false;
    this.fuelMix = 1;
    this.drsOpen = false; this.drsAllowed = false;
    this.limiter = false;
    this.slipstream = 0; this.dirtyAir = 0;
    this.damage = { fwL: 0, fwR: 0, rw: 0, floor: 0, body: 0, susp: [0, 0, 0, 0], engine: 0, gearbox: 0, brakes: 0 };
    this.retired = false; this.engineOff = false;
    this.bodyPitch = 0; this.bodyRoll = 0; this.heave = 0; this.heaveV = 0; this.rumble = 0;
    this.offTrackWheels = 0; this.surfaceUnder = SURF.ROAD;
    this.contactEvents = [];
    this.lastImpact = 0;
    this.distance = 0;
    for (const w of this.wheels || []) {
      w.locked = w.spinning = false; w.spin = 0; w.omega = 0;
      if (opts.fresh !== false) { w.temp = opts.tyreTemp || 75; w.core = w.temp; w.wear = 0; w.grain = 0; w.blister = 0; w.puncture = false; w.detached = false; }
    }
  }

  /** put the car on the circuit at track distance s, offset d */
  placeOnTrack(track, s, d, opts = {}) {
    const p = track.toWorld(s, d);
    this.x = p.x; this.z = p.z; this.y = p.y; this.h = p.heading;
    this.vx = this.vz = this.r = 0; this.u = this.v = this.speed = 0;
    this.hint = p.i; track.query(this.x, this.z, this.hint, this.q); this.hint = this.q.i;
    if (opts.speed) { this.vx = Math.cos(this.h) * opts.speed; this.vz = Math.sin(this.h) * opts.speed; this.u = opts.speed; this.speed = opts.speed; }
    this.gear = opts.speed ? this._gearFor(opts.speed) : 1;
    this.rpm = this.cls.idle;
  }

  setCompound(compound, temp) {
    this.compound = compound;
    for (const w of this.wheels) { w.wear = 0; w.grain = 0; w.blister = 0; w.puncture = false; w.temp = temp || 70; w.core = w.temp; }
  }

  get mass() { return this.cls.mass + this.cls.driver + this.fuel; }
  get compoundData() { return COMPOUNDS[this.compound]; }
  get maxSpeedGear() { return this._ratioSpeed(this.cls.gears.length - 1, this.cls.revLimit); }

  _finalMul() { return 1 + (6 - this.setup.finalDrive) * 0.028; }
  _ratio(g) { return this.cls.gears[g - 1] * this._finalMul(); }
  _ratioSpeed(gi, rpm) { return (rpm * Math.PI * 2 / 60) * this.cls.wheelR / (this.cls.gears[gi] * this._finalMul()); }
  _gearFor(v) {
    for (let g = 1; g <= this.cls.gears.length; g++) if (this._ratioSpeed(g - 1, this.cls.shiftRpm * 0.98) > v) return g;
    return this.cls.gears.length;
  }

  /**
   * Steady-state cornering limit (m/s^2) at a given speed with tyres in their window: the same load transfer,
   * load sensitivity and aero balance as step(), limited by whichever axle saturates first.
   */
  lateralCapacity(u, waterGrip = 1) {
    const c = this.cls, s = this.setup, m = this.mass, ae = this.aero();
    const down = 0.5 * RHO * u * u * ae.clA;
    const sF = m * G * c.frontWeight + down * ae.balance, sR = m * G * (1 - c.frontWeight) + down * (1 - ae.balance);
    const rollF = clamp(0.5 + (s.arbFront - s.arbRear) * 0.03, 0.25, 0.75);
    const mu0 = COMPOUNDS[this.compound].mu * c.tyreMu * this.perf.grip * waterGrip;
    const cap = (Fz, k) => { Fz = Math.max(0, Fz); return Fz * mu0 * k * clamp(1 - 0.07 * (Fz / 3200 - 1), 0.72, 1.12); };
    const camF = 1 + (-3.0 - s.camberFront) * 0.035, camR = 1 + (-1.5 - s.camberRear) * 0.035;
    const pF = 1 + (23 - s.pressFront) * 0.012, pR = 1 + (21.5 - s.pressRear) * 0.012;
    let ay = 30;
    for (let it = 0; it < 10; it++) {
      const latT = m * ay * c.cgH;
      const dF = latT * rollF / c.trackF, dR = latT * (1 - rollF) / c.trackR;
      const Ff = (cap(sF / 2 + dF, 1) + cap(sF / 2 - dF, 1)) * camF * pF;
      const Fr = (cap(sR / 2 + dR, 1.045) + cap(sR / 2 - dR, 1.045)) * camR * pR;
      ay = 0.5 * ay + 0.5 * Math.min(Ff / c.frontWeight, Fr / (1 - c.frontWeight)) / m;
    }
    return ay;
  }

  /** aero numbers for current state */
  aero() {
    const c = this.cls, s = this.setup, d = this.damage;
    const rideF = (s.rideFront - 4) * 0.022, rideR = (s.rideRear - 5) * 0.018;
    let floor = c.clBase * (1 - rideF - rideR) * (1 - 0.5 * d.floor);
    let front = (c.clFront0 + s.frontWing * c.clFrontPerStep) * (1 - 0.48 * (d.fwL + d.fwR) / 2);
    let rear = (c.clRear0 + s.rearWing * c.clRearPerStep) * (1 - 0.7 * d.rw);
    if (this.drsOpen) rear -= c.drsLift;
    const dirty = 1 - this.dirtyAir;
    front *= dirty * 0.92 + 0.08; floor *= 1 - this.dirtyAir * 0.35;
    const clA = (floor + front + rear) * this.perf.aero;
    const balance = (front + floor * 0.4) / Math.max(0.1, front + rear + floor);
    let cdA = (c.cdBase + s.frontWing * c.cdFrontPerStep + s.rearWing * c.cdRearPerStep + 0.08 * (d.body + d.fwL * 0.5 + d.fwR * 0.5)) * this.perf.drag;
    if (this.drsOpen) cdA -= c.drsDrag;
    if (d.rw >= 1) cdA -= 0.15;
    cdA *= 1 - this.slipstream * 0.32;
    return { clA, cdA, balance };
  }

  /**
   * Advance one fixed step.
   * input: { steer -1..1, throttle 0..1, brake 0..1, shiftUp, shiftDown, drs }
   * env: { track, water(i,d) -> 0..1, airTemp, trackTemp, rubber, wearMul, fuelMul }
   */
  step(dt, input, env) {
    const c = this.cls, s = this.setup, track = env.track;
    const m = this.mass;

    // ----- controls -----
    const steerTarget = clamp(input.steer, -1, 1) * c.maxSteer;
    const steerRate = 3.2 + (input.analog ? 3 : 0);
    this.steer += clamp(steerTarget - this.steer, -steerRate * dt, steerRate * dt);
    this.steerInput = input.steer;
    const thrIn = this.retired || this.engineOff ? 0 : clamp(input.throttle, 0, 1);
    const brkIn = clamp(input.brake, 0, 1);
    this.throttle += clamp(thrIn - this.throttle, -10 * dt, (input.analog ? 12 : 6) * dt);
    this.brake += clamp(brkIn - this.brake, -12 * dt, (input.analog ? 14 : 7) * dt);

    // body-frame velocity
    const ch = Math.cos(this.h), sh = Math.sin(this.h);
    let u = this.vx * ch + this.vz * sh;          // forward
    let v = -this.vx * sh + this.vz * ch;          // right
    const speed = Math.hypot(u, v);

    // reverse gear: hold brake while stopped
    // (AI drivers say explicitly when they want reverse; players hold the brake while stopped)
    const wantRev = input.reverse === true || (input.reverse !== false && brkIn > 0.5 && thrIn < 0.1);
    if (!this.reverse && Math.abs(u) < 0.6 && wantRev) { this.reverseHold += dt; if (this.reverseHold > 0.45) { this.reverse = true; this.reverseHold = 0; } }
    else if (!this.reverse) this.reverseHold = 0;
    if (this.reverse && (thrIn > 0.1 || u > 1 || input.reverse === false)) this.reverse = false;

    // gears
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const nG = c.gears.length;
    if (this.assists.autoGear || input.autoGear) {
      if (this.shiftTimer <= 0) {
        if (this.rpm > c.shiftRpm && this.gear < nG) { this.gear++; this.shiftTimer = 0.05; this.onShift && this.onShift(1); }
        else if (this.gear > 1) {
          const lowerRpm = (Math.abs(u) / c.wheelR) * this._ratio(this.gear - 1) * 60 / (Math.PI * 2);
          if (lowerRpm < c.shiftRpm * 0.82 && (this.rpm < c.shiftRpm * 0.6 || (this.brake > 0.3 && lowerRpm < c.shiftRpm * 0.88))) { this.gear--; this.shiftTimer = 0.05; this.onShift && this.onShift(-1); }
        }
      }
    } else {
      if (input.shiftUp && this.gear < nG) { this.gear++; this.shiftTimer = 0.04; this.onShift && this.onShift(1); }
      if (input.shiftDown && this.gear > 1) {
        const lowerRpm = (Math.abs(u) / c.wheelR) * this._ratio(this.gear - 1) * 60 / (Math.PI * 2);
        if (lowerRpm < c.revLimit * 1.02) { this.gear--; this.shiftTimer = 0.04; this.onShift && this.onShift(-1); }
      }
    }

    // ----- where are we -----
    track.query(this.x, this.z, this.hint, this.q);
    this.hint = this.q.i;
    const q = this.q;
    const ti = q.i, tx = track.tx[ti], tz = track.tz[ti], nx = track.nx[ti], nz = track.nz[ti];
    const fdt = ch * tx + sh * tz, fdn = ch * nx + sh * nz;      // car forward in track frame
    const rdt = -sh * tx + ch * tz, rdn = -sh * nx + ch * nz;    // car right in track frame

    // ----- aero and loads -----
    const ae = this.aero();
    const qd = 0.5 * RHO * u * u;
    const down = qd * ae.clA;
    const drag = qd * ae.cdA * Math.sign(u);
    const vc = clamp(1 + track.vcurv[ti] * u * u / G, 0.25, 2.6); // crest/compression
    const weight = m * G * vc * Math.cos(track.pitch[ti]);
    const staticF = weight * c.frontWeight, staticR = weight * (1 - c.frontWeight);
    const downF = down * ae.balance, downR = down * (1 - ae.balance);
    const longT = (m * this.axF * c.cgH) / c.wheelbase;
    const rollF = clamp(0.5 + (s.arbFront - s.arbRear) * 0.03, 0.25, 0.75);
    const latT = (m * this.ayF * c.cgH);
    const latF = latT * rollF / c.trackF, latR = latT * (1 - rollF) / c.trackR;
    const W = this.wheels;
    // right turn (ay > 0) moves load onto the left (outside) wheels; accelerating moves it rearwards
    W[0].Fz = (staticF + downF) / 2 - longT / 2 + latF;
    W[1].Fz = (staticF + downF) / 2 - longT / 2 - latF;
    W[2].Fz = (staticR + downR) / 2 + longT / 2 + latR;
    W[3].Fz = (staticR + downR) / 2 + longT / 2 - latR;

    // ----- engine -----
    const gearR = this._ratio(this.gear);
    const wheelOmega = Math.abs(u) / c.wheelR;
    const rearSpin = (W[2].spin + W[3].spin) / 2;
    let rpm = (wheelOmega + rearSpin * 0.6 / c.wheelR) * gearR * 60 / (Math.PI * 2);
    const launch = this.gear === 1 && thrIn > 0.2 ? c.idle + 4500 * this.throttle : c.idle;
    rpm = Math.max(rpm, launch);
    if (this.reverse) rpm = c.idle + 2000 * this.brake;
    this.rpm = lerp(this.rpm, Math.min(rpm, c.revLimit + 150), 0.5);
    const limiterCut = this.rpm >= c.revLimit ? 0.15 : 1;
    const mix = FUEL_MIXES[this.fuelMix];
    let enginePower = c.power * powerFrac(this.rpm, c.revLimit) * this.perf.power * mix.power * (1 - 0.55 * this.damage.engine) * limiterCut;
    if (this.fuel <= 0) enginePower = 0;
    // ERS deployment
    const ersMode = ERS_MODES[this.ersMode];
    let ersP = 0;
    this.ersDeploying = false;
    if (c.ersPower > 0 && this.throttle > 0.85 && this.ers > 0 && !this.limiter && this.fuel > 0) {
      ersP = c.ersPower * ersMode.deploy;
      if (ersP > 0) { this.ers = Math.max(0, this.ers - ersP * dt); this.ersDeploying = true; }
    }
    const totalP = (enginePower + ersP) * this.throttle;
    const omegaE = Math.max(this.rpm, 1000) * Math.PI * 2 / 60;
    let driveForce = (totalP / omegaE) * gearR * c.drivetrain / c.wheelR;
    // engine braking off throttle
    let engineBrake = 0;
    if (this.throttle < 0.05 && !this.reverse && Math.abs(u) > 2) engineBrake = (0.03 + 0.05 * (this.rpm / c.revLimit)) * m * G * (1 - (s.diffOff - 50) / 200);
    if (this.reverse) driveForce = -this.brake * 0.35 * m * G * (Math.abs(u) < 5 ? 1 : 0);
    // pit limiter
    if (this.limiter && u > env.pitSpeed) driveForce = Math.min(driveForce, 0);
    // fuel and harvesting
    this.fuel = Math.max(0, this.fuel - c.fuelRate * this.throttle * (this.rpm / c.revLimit) * mix.use * (env.fuelMul || 1) * dt);
    if (c.ersPower > 0) {
      const brakeHarvest = this.brake > 0.1 ? Math.min(c.ersPower, this.brake * Math.abs(u) * 2000) : 0;
      const liftHarvest = this.throttle < 0.6 && Math.abs(u) > 20 ? 25e3 : 0;
      const h = (brakeHarvest + liftHarvest) * ersMode.harvest * dt;
      this.ers = Math.min(c.ersStore, this.ers + h);
    }

    // ----- brakes -----
    const brakeTotal = this.reverse ? 0 : this.brake * c.maxBrake * (s.brakePressure / 100) * (1 - 0.4 * this.damage.brakes);
    const bias = s.brakeBias / 100;

    // ----- tyres -----
    const cd = COMPOUNDS[this.compound];
    let Fx = 0, Fy = 0, Mz = 0;
    let offWheels = 0, kerbHit = 0, rumble = 0, bump = 0;
    const tyreMu = cd.mu * c.tyreMu * this.perf.grip;
    const diffOn = s.diffOn / 100;
    for (let k = 0; k < 4; k++) {
      const w = W[k];
      if (w.detached) { w.Fx = w.Fy = 0; continue; }
      // wheel location on the circuit
      const along = fdt * w.x + rdt * w.z, lat = fdn * w.x + rdn * w.z;
      const wi = track.wrap(ti + Math.round(along / track.ds));
      const wd = q.d + lat;
      w.i = wi; w.d = wd;
      const surf = track.surfaceAt(wi, wd);
      w.surf = surf;
      const sp = SURF_PROPS[surf];
      if (surf !== SURF.ROAD && surf !== SURF.KERB && surf !== SURF.PIT) offWheels++;
      if (surf === SURF.KERB) { kerbHit++; rumble += 1; }
      bump += sp.bump;
      const water = env.water ? env.water(wi, wd) : 0;
      w.water = water;

      // load
      let Fz = Math.max(0, w.Fz);
      if (w.puncture) Fz *= 0.92;
      // grip
      const T = w.temp, [tLo, tHi] = cd.opt;
      let tempF = 1;
      if (T < tLo) tempF = 1 - 0.24 * clamp((tLo - T) / 45, 0, 1);
      else if (T > tHi) tempF = 1 - 0.28 * clamp((T - tHi) / 35, 0, 1);
      const wearF = 1 - 0.16 * w.wear - (w.wear > 0.72 ? (w.wear - 0.72) * 1.4 : 0);
      const pressOpt = w.front ? 23 : 21.5, press = w.front ? s.pressFront : s.pressRear;
      const pressF = 1 + (pressOpt - press) * 0.012;
      const camber = w.front ? s.camberFront : s.camberRear, camberOpt = w.front ? -3.0 : -1.5;
      const camberLat = 1 + (camberOpt - camber) * 0.035; // more negative camber -> a little more cornering grip
      const loadSens = clamp(1 - 0.07 * (Fz / 3200 - 1), 0.72, 1.12);
      let aquaplane = 1;
      if (water > 0.45) {
        const limit = cd.dry ? 52 : this.compound === "inter" ? 68 : 85;
        aquaplane = 1 - 0.45 * smoothstep(limit, limit + 18, Math.abs(u)) * smoothstep(0.45, 0.9, water);
      }
      const rubber = env.rubber != null ? env.rubber : 1;
      let mu = tyreMu * (w.front ? 1 : 1.045) * wetGrip(this.compound, water) * sp.grip * tempF * wearF * pressF * loadSens * aquaplane
        * (1 - 0.09 * w.grain - 0.1 * w.blister) * (1 - 0.3 * this.damage.susp[k]) * (surf === SURF.ROAD ? rubber : 1);
      if (w.puncture) mu *= 0.28;
      if (kerbHit && s.rideFront + s.rideRear < 7 && surf === SURF.KERB) mu *= 0.88; // bottoming over kerbs
      w.mu = mu;
      const Fmax = mu * Fz;

      // wheel velocity in body frame
      const uw = u - this.r * w.z, vw = v + this.r * w.x;
      let delta = 0;
      if (w.front) {
        delta = this.steer;
        // suspension damage knocks the toe out
        delta += (this.damage.susp[k] * 0.035) * w.side;
      }
      const cs = Math.cos(delta), sn = Math.sin(delta);
      const ul = uw * cs + vw * sn, vl = -uw * sn + vw * cs;

      // longitudinal demand at this wheel (in wheel frame)
      let demand = 0;
      const dirU = ul >= 0 ? 1 : -1;
      const bShare = (w.front ? bias : 1 - bias) / 2;
      const brakeF = brakeTotal * bShare * this._brakeEff(k);
      if (!w.front) {
        // open-ish diff: inside wheel spins first; diff lock shares torque
        demand += driveForce / 2;
        demand -= (engineBrake / 2) * dirU;
      }
      // rolling resistance and surface drag
      const rr = (0.012 * Fz + sp.drag * m / 4 + sp.vdrag * m / 4 * Math.abs(ul)) * (Math.abs(ul) > 0.05 ? dirU : ul / 0.05);
      demand -= rr;
      // brake opposes motion
      let braking = false;
      if (brakeF > 0 && Math.abs(ul) > 0.05) { demand -= brakeF * dirU; braking = true; }
      else if (brakeF > 0) demand -= clamp(ul * m * 20, -brakeF, brakeF);

      // assists: traction control and ABS
      if (!w.front && demand > 0 && this.assists.tc > 0) {
        const cap = Fmax * (this.assists.tc >= 2 ? 0.93 : 1.03) * (0.92 + 0.08 * diffOn);
        if (demand > cap) demand = cap;
      }
      if (braking && this.assists.abs && Math.abs(demand) > Fmax * 0.97) demand = -dirU * Fmax * 0.97;

      // lateral force from slip angle
      const ref = Math.max(Math.abs(ul), 5);
      const alpha = Math.atan2(vl, ref);
      const peakSlip = 0.088 * (w.front ? 1 : 0.95);
      let fy = -Fmax * mf(alpha / peakSlip) * camberLat;
      let fx = demand;
      w.locked = false; w.spinning = false;
      const tractionCap = Fmax * (w.front ? 1 : 0.92 + 0.08 * diffOn);
      if (braking && Math.abs(demand) > Fmax * 0.995 && Math.abs(ul) > 1) {
        // locked wheel: slides in the direction of travel
        const sv = Math.hypot(ul, vl) || 1;
        fx = -0.86 * Fmax * ul / sv; fy = -0.86 * Fmax * vl / sv;
        w.locked = true; w.spin = -ul;
      } else if (!w.front && demand > tractionCap && Fz > 50) {
        // wheelspin: the extra torque spins the wheel up past the peak slip ratio. Combined slip:
        // longitudinal and lateral slip share the friction circle, so a little wheelspin costs a
        // little side grip and a lot of wheelspin costs most of it.
        const excess = (demand - tractionCap) / Math.max(1, tractionCap);
        const refU = Math.max(Math.abs(ul), 4);
        const kT = 0.1 * (1.08 + excess * 3.5);
        w.spin = lerp(w.spin, clamp(kT * refU, 0.4, 18), 0.12);
        const kx = (w.spin / refU) / 0.1, ky = alpha / peakSlip;
        const sig = Math.hypot(kx, ky) || 1;
        const F = Fmax * mf(sig);
        fx = (F * kx) / sig; fy = (-F * ky / sig) * camberLat;
        w.spinning = true;
      } else {
        w.spin = lerp(w.spin, 0, 0.25);
        // friction ellipse: longitudinal use reduces lateral capacity
        const fxClamped = clamp(fx, -Fmax, Fmax);
        const latCap = Math.sqrt(Math.max(0, Fmax * Fmax - fxClamped * fxClamped));
        fy = clamp(fy, -latCap, latCap);
        fx = fxClamped;
      }
      // low speed: kill sideways creep smoothly
      if (Math.abs(ul) < 3) fy = lerp(-vl * m * 2.5, fy, Math.abs(ul) / 3);
      w.Fx = fx; w.Fy = fy;
      w.slip = alpha; w.slipVel = Math.abs(vl) + (w.locked ? Math.abs(ul) : 0) + (w.spinning ? w.spin : 0);

      // into body frame
      const bx = fx * cs - fy * sn, by = fx * sn + fy * cs;
      Fx += bx; Fy += by;
      Mz += w.x * by - w.z * bx;

      // wheel rotation for visuals
      w.omega = w.locked ? 0 : (ul + (w.spinning ? w.spin : 0)) / c.wheelR;
      w.rot += w.omega * dt;

      // ----- tyre temperature and wear -----
      const slipPower = Math.abs(fy * vl) + Math.abs(fx) * (w.locked || w.spinning ? w.slipVel : Math.abs(fx) / Math.max(1, Fmax) * 0.6);
      // the tyre surface relaxes toward a working temperature set by speed, load and sliding
      const trackT = env.trackTemp || 35;
      const target = trackT + 55 * Math.min(1, Math.abs(ul) / 28) + 0.0005 * slipPower * cd.heat * (1 + (pressOpt - press) * 0.05)
        + 0.0012 * Fz - water * 42 * (cd.dry ? 1 : 0.55);
      const tau = target > w.temp ? 3.6 : 7.5;
      w.temp += (target - w.temp) * Math.min(1, dt / tau);
      w.core += (w.temp - w.core) * 0.12 * dt;
      w.temp = clamp(w.temp, 10, 160);
      const over = Math.max(0, w.core - tHi - 12) / 25;
      const wearRate = (slipPower * 0.00000006 + 0.000012 * Math.abs(ul) / 80) * cd.wear * (1 + 2.5 * over) * (cd.dry ? 1 : 1 + 3.5 * (1 - smoothstep(0.1, 0.35, water))) * (env.wearMul || 1);
      w.wear = Math.min(1, w.wear + wearRate * dt);
      if (T < tLo - 12 && slipPower > 4000) w.grain = Math.min(1, w.grain + 0.02 * dt);
      else if (T >= tLo && w.grain > 0) w.grain = Math.max(0, w.grain - 0.004 * dt);
      if (over > 0.3) w.blister = Math.min(1, w.blister + 0.01 * over * dt);
      if (w.wear > 0.985 && !w.puncture && this.damageModel !== "off") w.puncture = true;
    }
    this.offTrackWheels = offWheels;
    this.rumble = rumble;
    this.kerbWheels = kerbHit;

    // diff yaw damping (locked diff resists rotation under power) and off-throttle stability
    Mz -= this.r * (diffOn * this.throttle * 900 + (s.diffOff / 100) * (1 - this.throttle) * 450);
    // stability assist: trims oversteer
    if (this.assists.stability && Math.abs(u) > 8) {
      const beta = Math.atan2(v, Math.abs(u));
      Mz -= clamp(beta * 25000 + this.r * 2500, -12000, 12000) * smoothstep(0.03, 0.12, Math.abs(beta));
    }
    // slope and drag
    const slope = -m * G * Math.sin(Math.atan(track.pitch[ti])) * fdt;
    Fx += slope - drag;
    // kerb kick
    if (kerbHit && speed > 25) {
      const kick = (Math.random() - 0.5) * kerbHit * speed * 6 * (1 + (11 - s.rideFront) * 0.02);
      Mz += kick * 18; Fy += kick;
    }

    // ----- integrate -----
    const axB = Fx / m, ayB = Fy / m;
    this.ax = axB; this.ay = ayB;
    const lpf = 1 - Math.exp(-dt / 0.06);
    this.axF += (axB - this.axF) * lpf;
    // lateral load transfer follows lateral acceleration in the body (right turn = +ay)
    this.ayF += (ayB - this.ayF) * lpf;
    const wx = axB * ch - ayB * sh, wz = axB * sh + ayB * ch;
    this.vx += wx * dt; this.vz += wz * dt;
    this.r += (Mz / (c.inertia * (m / 798))) * dt;
    this.r = clamp(this.r, -6, 6);
    // stop creeping at rest
    if (Math.abs(this.vx) + Math.abs(this.vz) < 0.15 && this.throttle < 0.05 && !this.reverse) { this.vx *= 0.8; this.vz *= 0.8; this.r *= 0.8; }
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.h = wrapAngle(this.h + this.r * dt);
    this.u = this.vx * Math.cos(this.h) + this.vz * Math.sin(this.h);
    this.v = -this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
    this.speed = Math.hypot(this.vx, this.vz);
    this.distance += this.speed * dt;

    // height and body motion
    const base = q.y;
    this.heaveV += ((bump * 0.012 * Math.min(1, speed / 30)) * (Math.random() - 0.5) * 60 - this.heave * 400 - this.heaveV * 30) * dt;
    this.heave += this.heaveV * dt;
    this.y = base + this.heave;
    this.bodyPitch = lerp(this.bodyPitch, clamp(-this.axF * 0.0016, -0.03, 0.03), 0.2);
    this.bodyRoll = lerp(this.bodyRoll, clamp(this.ayF * 0.0011, -0.03, 0.03), 0.2);

    // brakes temperature
    for (let k = 0; k < 4; k++) {
      const w = W[k];
      const heat = (k < 2 ? bias : 1 - bias) * brakeTotal * Math.abs(u) * 0.000065;
      const cool = (this.brakeTemp[k] - 120) * (0.05 + 0.0045 * Math.abs(u));
      this.brakeTemp[k] = clamp(this.brakeTemp[k] + (heat - cool) * dt * 6, 40, 1300);
    }
  }

  _brakeEff(k) {
    const t = this.brakeTemp[k];
    if (t < 200) return 0.86 + (t / 200) * 0.1;
    if (t > 1050) return Math.max(0.65, 1 - (t - 1050) / 800);
    return 1;
  }

  /** summary used by HUD, AI and networking */
  telemetry() {
    return {
      speed: this.u, gear: this.reverse ? "R" : this.gear, rpm: this.rpm, throttle: this.throttle, brake: this.brake, steer: this.steerInput,
      fuel: this.fuel, ers: this.cls.ersStore ? this.ers / this.cls.ersStore : 0, drs: this.drsOpen,
    };
  }
}
