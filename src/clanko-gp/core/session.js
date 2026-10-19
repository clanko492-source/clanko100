// CLANKO GP — a running session (practice, qualifying, race or time trial). Steps every car, runs AI,
// collisions and damage, timing and sectors, positions and gaps, start lights, DRS and ERS, flags,
// safety car and virtual safety car, pit stops and strategy, penalties and results.
// Pure logic: no rendering, runs in the browser or in Node.

import { Car, DT } from "./physics.js";
import { AIDriver, PitPilot } from "./ai.js";
import { computeRacingLine, lineCurvature, speedProfile, planParams } from "./racingline.js";
import { resolveBarriers, collidePair, applyDamage } from "./collide.js";
import { Weather } from "./weather.js";
import { COMPOUNDS, bestCompoundFor, defaultSetup, trackSetup } from "./car-specs.js";
import { POINTS } from "./teams.js";
import { clamp, lerp, rng, smoothstep } from "./math.js";

export const RULES = {
  arcade:   { id: "arcade", name: "Arcade", trackLimits: false, penalties: false, jumpStart: false, blueFlagPenalty: false, mandatoryCompounds: false, drsAfterLap: 0, manualClutch: false, autoPitLane: true, vscAssist: true, collisionPenalty: false, ghosting: false },
  standard: { id: "standard", name: "Standard", trackLimits: true, penalties: true, jumpStart: false, blueFlagPenalty: false, mandatoryCompounds: false, drsAfterLap: 2, manualClutch: false, autoPitLane: true, vscAssist: true, collisionPenalty: true },
  sim:      { id: "sim", name: "Simulation", trackLimits: true, penalties: true, jumpStart: true, blueFlagPenalty: true, mandatoryCompounds: true, drsAfterLap: 2, manualClutch: true, autoPitLane: false, vscAssist: false, collisionPenalty: true },
};

const FLAG = { GREEN: "green", YELLOW: "yellow", DYELLOW: "doubleYellow", SC: "sc", VSC: "vsc", RED: "red", CHEQUERED: "chequered" };
export { FLAG };

export class Session {
  /**
   * opts: { track, type, laps, timeLimit, rules, damage, weather (Weather) | weatherMode, tyreWear, fuelUse,
   *         start ('grid'|'pit'|'rolling'), safetyCar, aiDifficulty (0.85..1.02), seed, hour, mandatoryPit }
   */
  constructor(opts) {
    this.opts = opts;
    const tr = (this.track = opts.track);
    this.type = opts.type || "race";
    this.isRace = this.type === "race";
    this.laps = opts.laps || 5;
    this.timeLimit = opts.timeLimit || (this.isRace ? 0 : 600);
    this.rules = RULES[opts.rules] || RULES.standard;
    this.damage = opts.damage || "sim";
    this.tyreWear = opts.tyreWear != null ? opts.tyreWear : 1;
    this.fuelUse = opts.fuelUse != null ? opts.fuelUse : 1;
    this.safetyCarOn = opts.safetyCar !== false && this.isRace;
    this.flagsOn = opts.flags !== false;
    this.R = rng(opts.seed || 99);
    this.line = opts.line || computeRacingLine(tr);
    this.lineK = lineCurvature(tr, this.line);
    this.weather = opts.weather || new Weather({ track: tr, line: this.line, mode: opts.weatherMode || "dry", hour: opts.hour, seed: (opts.seed || 99) + 1, duration: 7200 });
    this.entities = [];
    this.time = 0;          // session clock (s)
    this.raceTime = 0;      // since lights out
    this.phase = "pre";     // pre | formation | lights | racing | finishing | done
    this.lights = 0;
    this.lightsTimer = 0;
    this.flag = FLAG.GREEN;
    this.sectorFlags = [FLAG.GREEN, FLAG.GREEN, FLAG.GREEN];
    this.sc = null;         // safety car state
    this.vsc = null;
    this.events = [];
    this.incidents = [];
    this.finishOrder = [];
    this.leaderFinished = false;
    this.fastestLap = null;
    this.loopSpacing = 50;
    this.nLoops = Math.max(4, Math.floor(tr.length / this.loopSpacing));
    this._posTimer = 0;
    this._profileTimer = 0;
    this.playerIds = new Set();
    this.netMode = opts.netMode || null; // null | "host" | "guest"
    this.paused = false;
    this.ctx = { track: tr, line: this.line, profile: null, time: 0, racing: false, cars: this.entities, waterAvg: 0 };
  }

  emit(type, data = {}) { const ev = { type, t: this.time, ...data }; this.events.push(ev); return ev; }
  drainEvents() { const e = this.events; this.events = []; return e; }

  /** add a car. cfg: { id, name, short, number, team, livery, player, remote, ai:{skill,personality,wetSkill}, setup, compound, perf, grid } */
  addCar(cfg) {
    const tr = this.track;
    const setup = { ...trackSetup(tr), ...(cfg.setup || {}) };
    const car = new Car({ id: cfg.id, cls: cfg.cls || "gp", setup, perf: cfg.perf, compound: cfg.compound || "medium", damage: this.damage, assists: cfg.assists || (cfg.player ? {} : { abs: true, tc: 1, autoGear: true }) });
    const e = {
      id: cfg.id, idx: this.entities.length, name: cfg.name || cfg.id, short: cfg.short || (cfg.name || cfg.id).slice(0, 3).toUpperCase(),
      number: cfg.number || this.entities.length + 1, team: cfg.team || null, livery: cfg.livery || null,
      isPlayer: !!cfg.player, remote: !!cfg.remote, car, ai: null, input: { steer: 0, throttle: 0, brake: 0, analog: true },
      grid: cfg.grid != null ? cfg.grid : this.entities.length,
      lap: 0, lapStart: null, armed: false, lastLap: null, bestLap: null, lapValid: true, lapTimes: [],
      sector: 0, sectorStart: null, curSectors: [null, null, null], bestSectors: [null, null, null], lastSectors: [null, null, null],
      progress: 0, position: this.entities.length + 1, gap: 0, interval: 0, lapsDown: 0,
      finished: false, finishTime: null, retired: false, dnf: null, removed: false,
      penalty: 0, penaltyServed: 0, warnings: 0, penalties: [],
      pit: { requested: false, plan: null, stops: 0, inLane: false, compoundsUsed: new Set([car.compound]), speeding: false, nextStopLap: null },
      pitPilot: null, held: false, resetHold: 0, stuck: 0,
      loops: new Float64Array(this.nLoops * 4).fill(NaN), loopLap: 0, lastLoop: -1,
      drsEligible: false, closeBehind: false, blueFlag: false, blueTime: 0, scTarget: null,
      offTrackTime: 0, trackLimitArmed: true, lastS: 0, startS: 0,
      stats: { overtakes: 0, topSpeed: 0, wallHits: 0, offs: 0 },
      profile: null, waterSeen: 0,
    };
    car.track = tr;
    if (!e.isPlayer && !e.remote) {
      const ai = cfg.ai || {};
      const diff = this.opts.aiDifficulty != null ? this.opts.aiDifficulty : 0.97;
      e.ai = new AIDriver(e, { skill: (ai.skill || 0.98) * diff, personality: ai.personality, wetSkill: ai.wetSkill, consistency: ai.consistency, seed: 1000 + this.entities.length * 17 + (this.opts.seed || 0) });
    }
    if (e.isPlayer) this.playerIds.add(e.id);
    this.entities.push(e);
    this._planProfile(e);
    return e;
  }

  _planProfile(e) {
    const water = this.weather.lineWater();
    const wetF = water > 0.02 ? lerp(1, 0.66, clamp(water, 0, 1)) : 1;
    const comp = COMPOUNDS[e.car.compound];
    // wrong tyres for the conditions are slow
    let tyreF = 1;
    if (comp.dry && water > 0.15) tyreF = lerp(1, 0.78, clamp((water - 0.15) * 2, 0, 1));
    if (!comp.dry && water < 0.1) tyreF = e.car.compound === "wet" ? 0.9 : 0.95;
    const p = planParams(e.car, wetF * tyreF);
    e.profile = speedProfile(this.track, this.line, this.lineK, p);
    e.waterSeen = water;
  }

  /** put cars on the grid / in the pits and get ready */
  start() {
    const tr = this.track;
    const startType = this.opts.start || (this.isRace ? "grid" : "pit");
    // grid order
    const order = this.entities.slice().sort((a, b) => a.grid - b.grid);
    const usedSlots = {};
    order.forEach((e, k) => {
      const c = e.car;
      if (startType === "grid") {
        const g = tr.grid[Math.min(k, tr.grid.length - 1)];
        c.placeOnTrack(tr, g.s, g.d);
        e.held = true; e.startS = g.s;
      } else if (startType === "rolling") {
        const s = -40 - k * 30;
        c.placeOnTrack(tr, s, this.line[tr.idx(s)], { speed: 45 });
      } else {
        // from the garages, released one by one
        const slot = e.team && e.team.slot != null ? e.team.slot : k % 10;
        usedSlots[slot] = (usedSlots[slot] || 0) + 1;
        const s = tr.boxS(slot) - (usedSlots[slot] - 1) * 7;
        c.placeOnTrack(tr, s, tr.pit.sign * tr.pit.work);
        c.h = tr.heading[tr.idx(s)];
        e.pitPilot = new PitPilot(e, tr, { box: slot, serviceTime: 0.1 + k * 1.2 });
        e.pitPilot.state = "service"; e.pitPilot.timer = 0.5 + k * 1.5;
        e.pit.inLane = true;
      }
      for (const w of c.wheels) { w.temp = startType === "grid" ? 75 : 60; w.core = w.temp; }
      e.lastS = c.q.s;
      // fuel for the distance (AI); players use their setup
      if (!e.isPlayer && this.isRace) c.fuel = Math.min(c.cls.fuelMax, this._fuelNeeded(e) * 1.04 + 1.5);
      else if (!e.isPlayer) c.fuel = 40;
      this._planStrategy(e);
    });
    this.phase = startType === "grid" ? "lights" : "racing";
    if (this.phase === "lights") { this.lightsTimer = this.opts.formationDelay != null ? this.opts.formationDelay : 3; this.lights = 0; }
    else this._goGreen();
    this.emit("sessionStart", { session: this.type, phase: this.phase });
  }

  _fuelNeeded(e) {
    // about 1.6 kg per km at full throttle on average (scaled by circuit character)
    return (this.laps * this.track.length / 1000) * 1.55 * this.fuelUse;
  }

  _planStrategy(e) {
    if (!this.isRace || e.isPlayer) return;
    const laps = this.laps;
    const wearRate = (COMPOUNDS[e.car.compound].wear || 1) * this.tyreWear;
    // laps a set of tyres lasts before the drop-off (rough; the AI also reacts to real wear)
    const life = Math.max(3, Math.round(30 / wearRate * (this.track.length / 5000) ** -0.3));
    if (laps > life * 0.9 || (this.rules.mandatoryCompounds && laps >= 6)) {
      const stopLap = clamp(Math.round(laps * (0.42 + this.R() * 0.18)), 2, laps - 2);
      e.pit.nextStopLap = stopLap;
      e.pit.nextCompound = e.car.compound === "medium" ? "hard" : "medium";
    }
  }

  _goGreen() {
    this.phase = "racing";
    this.ctx.racing = true;
    this.raceTime = 0;
    this.greenAt = this.time;
    for (const e of this.entities) {
      e.held = false;
      if (this.isRace) { e.lapStart = this.time; e.sectorStart = this.time; e.armed = false; }
    }
  }

  setInput(id, input) { const e = this.byId(id); if (e) Object.assign(e.input, input); }
  byId(id) { return this.entities.find((e) => e.id === id); }

  /** commands from players: pit, reset, ers, mix, bias, limiter */
  command(id, cmd, arg) {
    const e = this.byId(id); if (!e) return;
    const c = e.car;
    switch (cmd) {
      case "pit": e.pit.requested = arg !== false; e.pit.plan = { tyres: (arg && arg.tyres) || this._suggestCompound(e), wing: !!(arg && arg.wing), repair: true }; this.emit("pitRequest", { e, plan: e.pit.plan }); break;
      case "cancelPit": e.pit.requested = false; break;
      case "reset": this._requestReset(e); break;
      case "ersMode": c.ersMode = clamp(arg != null ? arg : (c.ersMode + 1) % 3, 0, 3); this.emit("ersMode", { e, mode: c.ersMode }); break;
      case "mix": c.fuelMix = clamp(arg, 0, 2); this.emit("fuelMix", { e, mix: c.fuelMix }); break;
      case "bias": c.setup.brakeBias = clamp(c.setup.brakeBias + arg, 50, 70); this.emit("bias", { e, bias: c.setup.brakeBias }); break;
      case "limiter": c.limiter = !c.limiter; e.manualLimiter = c.limiter; this.emit("limiter", { e, on: c.limiter }); break;
      case "drs": if (e.drsAllowedNow && !c.drsOpen) { c.drsOpen = true; this.emit("drsOpen", { e }); } break;
    }
  }

  _suggestCompound(e) {
    const w = this.weather.lineWater();
    if (w > 0.15) return bestCompoundFor(w);
    const lapsLeft = this.laps - e.lap;
    const used = e.pit.compoundsUsed;
    if (this.rules.mandatoryCompounds && used.size < 2 && !(used.has("soft") && used.has("medium"))) return e.car.compound === "hard" ? "medium" : "hard";
    return lapsLeft < 10 ? "soft" : lapsLeft < 22 ? "medium" : "hard";
  }

  // ---------------- main step ----------------
  step(dt = DT) {
    if (this.paused || this.phase === "done") return;
    this.time += dt;
    if (this.phase === "racing" || this.phase === "finishing") this.raceTime += dt;
    const tr = this.track, W = this.weather;
    W.step(dt);
    const ctx = this.ctx;
    ctx.time = this.time;
    ctx.waterAvg = W.lineWater();
    ctx.flag = this.flag;
    ctx.vsc = !!this.vsc;
    ctx.safetyCar = !!(this.sc && this.sc.deployed);
    if (this.phase === "lights" && this.netMode !== "guest") this._lights(dt);

    const env = { track: tr, water: (i, d) => W.waterAt(i, d), trackTemp: W.trackTemp, rubber: W.rubber, wearMul: this.tyreWear, fuelMul: this.fuelUse, pitSpeed: tr.pit.speedLimit };
    for (const e of this.entities) {
      if (e.removed) continue;
      const c = e.car;
      // a car driven by another player over the network: its position comes from the host
      if (e.netControlled) continue;
      // ----- who drives -----
      let inp;
      if (e.pitPilot) {
        const pilotIn = e.pitPilot.drive(dt, ctx);
        const st = e.pitPilot.state;
        // in Simulation the player drives the pit lane (and must use the limiter); the crew guides the stop
        if (e.pitPilot.manualLane && (st === "entry" || st === "lane" || st === "exit") && Math.abs(tr.sDelta(c.q.s, e.pitPilot.boxS)) > 45) {
          c.limiter = !!e.manualLimiter; inp = e.input;
        } else inp = pilotIn;
      }
      else if (e.ai) {
        ctx.noOvertake = !!(this.sc && this.sc.deployed) || !!this.vsc || this.sectorFlags[e.sector] !== FLAG.GREEN;
        ctx.paceScale = this._paceScale(e);
        ctx.yellowSector = this.sectorFlags.findIndex((f) => f !== FLAG.GREEN);
        inp = e.ai.update(dt, ctx);
        if (e.ai.wantReset) { e.ai.wantReset = false; this._reset(e, true); }
      } else inp = e.input;
      if (c.retired && !e.pitPilot) {
        // a retired car rolls to the nearest side of the track and stops there
        const side = c.q.d >= 0 ? 1 : -1, i = c.q.i;
        const target = side * (tr.hw[i] + tr.kerb[side < 0 ? 0 : 1][i] + 3);
        const err = target - c.q.d;
        const canRoll = c.speed > 1 && !c.wheels.some((w) => w.detached);
        inp = { steer: canRoll ? clamp(err * 0.08, -0.6, 0.6) : 0, throttle: 0, brake: Math.abs(err) > 1.5 && canRoll ? 0.15 : 1, reverse: false };
      }
      // ----- holds: grid, reset, pit box -----
      if (e.held || e.resetHold > 0) {
        if (e.resetHold > 0) e.resetHold -= dt;
        // revs only; the car does not move (manual clutch start may move it -> jump start)
        const launch = this.rules.manualClutch && e.isPlayer && e.held && this.phase === "lights" && inp.clutch === false && inp.throttle > 0.3;
        if (launch) {
          e.held = false;
          this.emit("jumpStart", { e });
          this._penalise(e, 5, "Jump start");
        } else {
          c.step(dt, { steer: inp.steer, throttle: Math.min(inp.throttle, 0.6), brake: 1 }, env);
          c.vx = c.vz = c.r = 0; c.x = c._hx ?? c.x; c.z = c._hz ?? c.z;
          if (c._hx == null) { c._hx = c.x; c._hz = c.z; }
          continue;
        }
      } else { c._hx = null; c._hz = null; }
      // VSC / SC assist for players on easier rules
      if (e.isPlayer && (this.vsc || (this.sc && this.sc.deployed)) && this.rules.vscAssist) {
        const lim = this._neutralSpeed(e);
        if (c.u > lim) { inp = { ...inp, throttle: Math.min(inp.throttle, 0.15), brake: Math.max(inp.brake, c.u > lim + 6 ? 0.25 : 0) }; }
      }
      // ----- DRS -----
      this._drs(e, inp);
      // ----- ERS overtake button -----
      if (inp.overtake && c.ers > 0) { if (c._ersBase == null) c._ersBase = c.ersMode; c.ersMode = 3; }
      else if (c._ersBase != null) { c.ersMode = c._ersBase; c._ersBase = null; }
      if (e.ai && !inp.overtake) this._aiErs(e);
      // ----- physics -----
      c.step(dt, inp, env);
      if (e.pit.inLane && (!e.pitPilot || e.pitPilot.manualLane) && !e.ai) this._pitLaneChecks(e);
    }
    // ----- collisions -----
    const evs = [];
    for (const e of this.entities) {
      if (e.removed) continue;
      const imp = resolveBarriers(e.car, tr, evs);
      if (imp > 1) e.stats.wallHits++;
    }
    const list = this.entities;
    for (let a = 0; a < list.length; a++) {
      const A = list[a]; if (A.removed || A.ghost) continue;
      for (let b = a + 1; b < list.length; b++) {
        const B = list[b]; if (B.removed || B.ghost) continue;
        const dx = A.car.x - B.car.x, dz = A.car.z - B.car.z;
        if (dx * dx + dz * dz > 64 || Math.abs(A.car.y - B.car.y) > 3) continue;
        collidePair(A.car, B.car, evs);
      }
    }
    for (const ev of evs) this._impact(ev);
    // ----- timing, pits, flags -----
    for (const e of this.entities) if (!e.removed && !e.netControlled) this._timing(e);
    this._posTimer += dt;
    if (this._posTimer >= 0.1) {
      this._positions();
      if (this.netMode !== "guest") { this._flags(this._posTimer); this._pitLogic(); }
      else this._guestFlags();
      this._posTimer = 0;
    }
    this._profileTimer += dt;
    if (this._profileTimer > 3) {
      this._profileTimer = 0;
      for (const e of this.entities) if (e.ai && (Math.abs(e.waterSeen - W.lineWater()) > 0.04 || e._replan)) { e._replan = false; this._planProfile(e); }
    }
    if (this.timeLimit && !this.isRace && this.phase === "racing" && this.time - (this.greenAt || 0) > this.timeLimit) { this.phase = "finishing"; this.flag = FLAG.CHEQUERED; this.emit("chequered", {}); }
    this._checkEnd();
  }

  // ---------------- start lights ----------------
  _lights(dt) {
    this.lightsTimer -= dt;
    if (this.lightsTimer > 0) return;
    if (this.lights < 5) {
      this.lights++;
      this.emit("light", { n: this.lights });
      this.lightsTimer = this.lights < 5 ? 1 : 0.4 + this.R() * 2.6;
    } else {
      this.lights = 0;
      this.emit("lightsOut", {});
      this._goGreen();
      // reaction times: AI pull away a little after the lights
      for (const e of this.entities) if (e.ai) { e.resetHold = 0.12 + this.R() * 0.22 * (1.2 - e.ai.skill); e.held = false; }
    }
  }

  _neutralSpeed(e) {
    const prof = e.profile;
    const v = prof ? prof[e.car.q.i] : 50;
    if (this.vsc) return Math.min(v * 0.62, 50);
    if (this.sc && this.sc.deployed) return e.scTarget != null ? e.scTarget : Math.min(v * 0.6, 48);
    return 999;
  }

  _paceScale(e) {
    let p = 1;
    // tyre and fuel management, blue flags
    if (e.blueFlag) p *= 0.94;
    return p;
  }

  _aiErs(e) {
    const c = e.car;
    if (!c.cls.ersPower) return;
    // attack: overtake mode on straights when close behind someone; otherwise balanced
    const straight = Math.abs(this.track.k[c.q.i]) < 1 / 600;
    if (e.closeBehind && straight && c.ers > c.cls.ersStore * 0.25) c.ersMode = 3;
    else c.ersMode = c.ers < c.cls.ersStore * 0.3 ? 0 : 1;
  }

  _drs(e, inp) {
    const c = e.car, tr = this.track;
    let zone = null;
    for (const z of tr.drs) { const d = tr.sDelta(z.start, c.q.s); if (d >= 0 && d <= z.len) { zone = z; break; } }
    const wet = this.weather.lineWater() > 0.28;
    const enabled = !wet && !(this.sc && this.sc.deployed) && !this.vsc && this.phase !== "lights" &&
      (!this.isRace || (this.rules.drsAfterLap === 0 || this._leaderLap() >= this.rules.drsAfterLap)) && this.sectorFlags[e.sector] === FLAG.GREEN;
    e.drsAllowedNow = !!zone && enabled && (!this.isRace || e.drsEligible) && !e.pitPilot;
    c.drsAllowed = e.drsAllowedNow;
    if (!e.drsAllowedNow) { if (c.drsOpen) c.drsOpen = false; return; }
    if (inp.brake > 0.2 && c.drsOpen) c.drsOpen = false;
    if (e.ai && inp.drs && !c.drsOpen) c.drsOpen = true;
    if (e.isPlayer && inp.drsHeld && !c.drsOpen && inp.brake < 0.1) { c.drsOpen = true; this.emit("drsOpen", { e }); }
  }

  _leaderLap() { let m = 0; for (const e of this.entities) m = Math.max(m, e.lap); return m; }

  // ---------------- impacts and damage ----------------
  _impact(ev) {
    const e = this.entities.find((x) => x.car === ev.car);
    if (!e) return;
    if (ev.speed > 1.2) this.emit(ev.type === "wall" ? "hitWall" : "hitCar", { e, speed: ev.speed, x: ev.x, y: ev.y, z: ev.z, other: ev.other ? this.entities.find((x) => x.car === ev.other) : null });
    if (ev.mirror && ev.type === "car") { /* the pair is reported twice; damage applies to both sides */ }
    const broken = applyDamage(e.car, ev, this.damage);
    for (const part of broken) this.emit("partBroken", { e, part, x: ev.x, y: ev.y, z: ev.z, speed: ev.speed });
    if (e.car.retired && !e.retired) this._retire(e, ev.speed > 20 ? "Accident" : "Damage");
    // anything broken on the front wing? AI comes in for a new nose
    if (e.ai && (e.car.damage.fwL > 0.5 || e.car.damage.fwR > 0.5)) { e.pit.requested = true; e.pit.plan = { tyres: this._suggestCompound(e), wing: true, repair: true }; }
    // causing a collision (rear-ending at speed)
    if (this.rules.collisionPenalty && ev.type === "car" && !ev.mirror && ev.speed > 7 && this.isRace && this.phase === "racing") {
      const other = this.entities.find((x) => x.car === ev.other);
      if (other) {
        const behind = this.track.sDelta(other.car.q.s, e.car.q.s) < 0 ? e : other;
        const victim = behind === e ? other : e;
        if (behind.isPlayer && victim.car.lastImpact >= 6) this._penalise(behind, 5, "Causing a collision");
      }
    }
    if (ev.type === "car" && ev.speed > 10 && this.isRace) this._incident(e, "contact");
  }

  _retire(e, reason) {
    e.retired = true; e.dnf = reason; e.car.retired = true;
    this.emit("retire", { e, reason });
    this._incident(e, "retired");
  }

  _incident(e, kind) {
    this.incidents.push({ t: this.time, e, kind, s: e.car.q.s, sector: e.sector, onTrack: Math.abs(e.car.q.d) < this.track.hw[e.car.q.i] + 1 });
  }

  // ---------------- resets ----------------
  _requestReset(e) {
    const c = e.car;
    if (e.pitPilot || e.held) return;
    const off = Math.abs(c.q.d) > this.track.hw[c.q.i] + 0.5;
    const wrongWay = Math.abs(((c.h - this.track.heading[c.q.i] + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI / 2;
    if (c.speed < 18 || off || wrongWay || c.retired) this._reset(e, false);
    else this.emit("message", { e, text: "Slow down or leave the track to reset" });
  }
  _reset(e, auto) {
    const tr = this.track, c = e.car;
    // go back a little so nothing is gained, find a clear spot on the racing line
    let s = c.q.s - 25;
    for (let tries = 0; tries < 12; tries++) {
      let clear = true;
      for (const o of this.entities) {
        if (o === e || o.removed) continue;
        const d = tr.sDelta(s, o.car.q.s);
        if (d > -25 && d < 30 && Math.abs(o.car.q.d - this.line[tr.idx(s)]) < 4) { clear = false; break; }
      }
      if (clear) break;
      s -= 30;
    }
    const d = clamp(this.line[tr.idx(s)], -tr.hw[tr.idx(s)] + 2, tr.hw[tr.idx(s)] - 2);
    const fuel = c.fuel, ers = c.ers;
    c.placeOnTrack(tr, s, d);
    c.fuel = fuel; c.ers = ers;
    c.drsOpen = false;
    if (c.retired && this.damage !== "sim") c.retired = false;
    e.lastS = c.q.s;
    const timed = !this.isRace;
    if (timed) { e.lapValid = false; this.emit("lapInvalid", { e, reason: "Reset" }); }
    // penalty: a short hold
    e.resetHold = this.isRace ? (this.rules.id === "arcade" ? 1.5 : 3.5) : 0.8;
    e.ai && (e.ai.stuckTime = 0, e.ai.recoverTimer = 0);
    e.stuck = 0;
    this.emit("reset", { e, auto, hold: e.resetHold });
  }

  // ---------------- timing ----------------
  _timing(e) {
    const tr = this.track, c = e.car, L = tr.length;
    const s = c.q.s, prev = e.lastS;
    e.lastS = s;
    if (c.speed * 3.6 > e.stats.topSpeed) e.stats.topSpeed = c.speed * 3.6;
    // arm the lap once the car is well into it (handles grid starts and stops cheating by reversing)
    if (!e.armed && s > L * 0.3 && s < L * 0.7) e.armed = true;
    const crossed = prev > L - 60 && s < 60;
    const backwards = prev < 60 && s > L - 60;
    if (backwards) { e.armed = false; }
    // sectors
    for (let k = 1; k < 3; k++) {
      const sb = tr.sectors[k];
      if (prev < sb && s >= sb && s - prev < 60 && e.sector === k - 1 && e.sectorStart != null) {
        const st = this.time - e.sectorStart;
        e.curSectors[k - 1] = st; e.sectorStart = this.time; e.sector = k;
        const best = e.bestSectors[k - 1];
        const pb = best == null || st < best;
        if (pb && e.lapValid) e.bestSectors[k - 1] = st;
        this.emit("sector", { e, k: k - 1, time: st, pb, overall: this._overallBestSector(k - 1, st) });
      }
    }
    if (crossed) {
      // precise crossing time
      const over = s / Math.max(1, c.speed);
      const tCross = this.time - over;
      if (e.armed && e.lapStart != null) {
        const lapTime = tCross - e.lapStart;
        if (e.sectorStart != null) e.curSectors[2] = tCross - e.sectorStart;
        e.lastSectors = e.curSectors.slice();
        const valid = e.lapValid && !e.pitLap;
        e.lap++;
        e.lastLap = lapTime;
        e.lapTimes.push({ t: lapTime, valid, sectors: e.lastSectors.slice(), compound: c.compound });
        const pb = valid && (e.bestLap == null || lapTime < e.bestLap);
        if (pb) e.bestLap = lapTime;
        if (valid && e.curSectors[2] != null && (e.bestSectors[2] == null || e.curSectors[2] < e.bestSectors[2])) e.bestSectors[2] = e.curSectors[2];
        let fastest = false;
        if (valid && (!this.fastestLap || lapTime < this.fastestLap.t)) { this.fastestLap = { t: lapTime, e, lap: e.lap }; fastest = true; }
        this.emit("lap", { e, lap: e.lap, time: lapTime, valid, pb, fastest, sectors: e.lastSectors.slice() });
        // finishing
        if (this.isRace && (this.phase === "racing" || this.phase === "finishing")) {
          if (!this.leaderFinished && e.lap >= this.laps) { this.leaderFinished = true; this.phase = "finishing"; this.flag = FLAG.CHEQUERED; this.emit("chequered", { e }); }
          if (this.leaderFinished && !e.finished) this._finish(e, tCross);
        } else if (!this.isRace && this.phase === "finishing" && !e.finished) this._finish(e, tCross);
      } else if (!this.isRace && e.lapStart == null) {
        this.emit("lapStart", { e });
      }
      // a grid start keeps the time from the lights; any other crossing starts a new lap
      if (!(this.isRace && e.lap === 0 && !e.armed && e.lapStart != null && !e._startCrossed)) { e.lapStart = tCross; e.sectorStart = tCross; }
      if (this.isRace && e.lap === 0) e._startCrossed = true;
      e.sector = 0; e.curSectors = [null, null, null];
      e.lapValid = true; e.pitLap = e.pit.inLane;
      e.armed = false;
      e.warningsThisLap = 0;
    }
    // timing loops for gaps
    const li = Math.floor(s / this.loopSpacing) % this.nLoops;
    if (li !== e.lastLoop && e.lapStart != null) {
      const lapIdx = e.lap + (e.armed || s < L / 2 ? 0 : 0);
      e.loops[(lapIdx % 4) * this.nLoops + li] = this.time;
      e.lastLoop = li;
    }
    // progress along the race
    const sNorm = !e.armed && s > L / 2 ? s - L : s;
    e.progress = e.lap * L + sNorm;
    // track limits
    this._trackLimits(e);
    // weather: cars dry the line
    if (c.speed > 20) this.weather.carPass(c.q.i, c.speed);
    // stuck detection for players (prompt) and AI fallback
    if (c.speed < 1 && (this.phase === "racing") && !e.pitPilot && !e.held && e.resetHold <= 0) e.stuck += 1 / 240; else e.stuck = Math.max(0, e.stuck - 1 / 120);
    if (e.isPlayer && e.stuck > 4 && !e._stuckMsg) { e._stuckMsg = true; this.emit("stuck", { e }); }
    if (e.stuck < 1) e._stuckMsg = false;
  }

  _overallBestSector(k, t) {
    let best = Infinity;
    for (const e of this.entities) if (e.bestSectors[k] != null) best = Math.min(best, e.bestSectors[k]);
    return t <= best + 1e-6;
  }

  _trackLimits(e) {
    if (!this.rules.trackLimits || e.pitPilot || e.pit.inLane || this.phase !== "racing") return;
    const tr = this.track, c = e.car, i = c.q.i;
    const beyond = Math.abs(c.q.d) - tr.hw[i] - 0.95; // all four wheels past the white line
    const corner = Math.abs(tr.k[i]) > 1 / 500;
    if (beyond > 0 && corner && e.trackLimitArmed) {
      e.trackLimitArmed = false;
      if (!this.isRace) { if (e.lapValid) { e.lapValid = false; this.emit("lapInvalid", { e, reason: "Track limits" }); } return; }
      e.warnings++;
      e.lapValid = false;
      this.emit("trackLimits", { e, count: e.warnings });
      if (this.rules.penalties && e.warnings > 3 && (e.warnings - 4) % 3 === 0) this._penalise(e, 5, "Track limits");
    }
    if (beyond < -0.5) e.trackLimitArmed = true;
  }

  _penalise(e, seconds, reason) {
    if (!this.rules.penalties) return;
    e.penalty += seconds;
    e.penalties.push({ seconds, reason, t: this.time });
    this.emit("penalty", { e, seconds, reason });
  }

  _finish(e, t) {
    e.finished = true;
    // a car that is laps down is classified where it is, not on a time
    const full = !this.isRace || e.lap >= this.laps;
    e.finishTime = full ? t - (this.greenAt || 0) : null;
    e.notClassified = this.isRace && e.lap < this.laps * 0.5;
    this.finishOrder.push(e);
    this.emit("finish", { e, position: this.finishOrder.length });
    // finished cars cruise back
    if (e.ai) e.ai.skill *= 0.75;
  }

  _checkEnd() {
    if (this.phase !== "finishing") return;
    if (this._finishWait == null) this._finishWait = this.time;
    const waited = this.time - this._finishWait;
    const running = this.entities.filter((e) => !e.removed && !e.retired && !e.finished);
    const humanRunning = running.some((e) => e.isPlayer || e.remote);
    const lapEst = this.fastestLap ? this.fastestLap.t * 1.15 : 120;
    // a human still circulating gets a lap and a half to take the flag; one that is stopped does not hold it up
    const humanMoving = running.some((e) => (e.isPlayer || e.remote) && e.car.speed > 3);
    const limit = humanMoving ? Math.max(150, lapEst * 1.5) : 25;
    if (!running.length || (!humanRunning && waited > lapEst + 15) || waited > limit) {
      this._positions();
      // anyone still circulating takes the flag where they are, in track order
      for (const e of (this.order || []).slice()) if (!e.removed && !e.retired && !e.finished) this._finish(e, this.time);
      this._positions();
      this.phase = "done";
      this.emit("sessionEnd", { results: this.results() });
    }
  }

  // ---------------- positions and gaps ----------------
  _positions() {
    const list = this.entities.slice();
    if (this.isRace) {
      list.sort((a, b) => {
        if (a.finished !== b.finished) {
          // a finished car is ahead of everyone still running on the same or lower lap
          if (a.finished && b.lap <= a.lap) return -1;
          if (b.finished && a.lap <= b.lap) return 1;
        }
        if (a.finished && b.finished) return this.finishOrder.indexOf(a) - this.finishOrder.indexOf(b);
        if (a.retired !== b.retired) return a.retired ? 1 : -1;
        if (a.retired && b.retired) return b.progress - a.progress;
        return b.progress - a.progress;
      });
    } else {
      list.sort((a, b) => (a.bestLap == null ? 1e9 : a.bestLap) - (b.bestLap == null ? 1e9 : b.bestLap) || b.progress - a.progress);
    }
    const leader = list[0];
    list.forEach((e, k) => {
      const before = e.position;
      e.position = k + 1;
      if (this.isRace && this.phase === "racing" && before > e.position && k > 0 && !e.pitPilot) {
        const passed = list[k + 1];
        if (passed && !passed.pitPilot && !passed.retired) { e.stats.overtakes++; this.emit("overtake", { e, other: passed, position: e.position }); this._checkIllegalPass(e, passed); }
      }
      if (this.isRace) {
        e.gap = k === 0 ? 0 : this._gapTo(e, leader);
        e.interval = k === 0 ? 0 : this._gapTo(e, list[k - 1]);
        e.lapsDown = Math.max(0, Math.floor((leader.progress - e.progress) / this.track.length));
      } else {
        e.gap = k === 0 || e.bestLap == null || leader.bestLap == null ? 0 : e.bestLap - leader.bestLap;
        e.interval = k === 0 || e.bestLap == null || list[k - 1].bestLap == null ? 0 : e.bestLap - list[k - 1].bestLap;
      }
    });
    this.order = list;
  }
  /** time gap from e to the car ahead `a` measured at the timing loops */
  _gapTo(e, a) {
    if (!a || e === a) return 0;
    if (e.lastLoop < 0) return 0;
    const li = e.lastLoop;
    const lapsBehind = Math.round((a.progress - e.progress) / this.track.length - (e.car.q.s > a.car.q.s ? -0.0 : 0));
    // time e passed loop li on its current lap vs time a passed the same loop on the same lap
    const eLap = e.lap, k = (eLap % 4) * this.nLoops + li;
    const tE = e.loops[k], tA = a.loops[k];
    if (!isNaN(tE) && !isNaN(tA) && tA <= tE && tE - tA < 400) return tE - tA;
    // fall back: distance over speed
    const d = a.progress - e.progress;
    return d / Math.max(20, e.car.speed);
  }

  _checkIllegalPass(e, passed) {
    if (!e.isPlayer || !this.rules.penalties) return;
    if ((this.sc && this.sc.deployed) || this.vsc) this._penalise(e, 5, "Overtaking under the safety car");
    else if (this.sectorFlags[e.sector] !== FLAG.GREEN) this._penalise(e, 5, "Overtaking under yellow flags");
  }

  // ---------------- flags, blue flags, SC/VSC ----------------
  _flags(dt) {
    if (!this.flagsOn || this.phase === "lights") return;
    const tr = this.track;
    // stopped or crashed cars make yellow flags in their sector; long stops on track bring out the SC or VSC
    const sec = [0, 0, 0];
    let stoppedOnTrack = null, stoppedOff = null;
    for (const e of this.entities) {
      if (e.removed || e.finished) continue;
      const c = e.car;
      const off = Math.abs(c.q.d) > tr.hw[c.q.i] + 0.5;
      const stopped = (c.speed < 6 && !e.pitPilot && !e.held && e.resetHold <= 0) || e.retired;
      if (stopped && (this.phase === "racing" || this.phase === "finishing")) {
        e.stoppedTime = (e.stoppedTime || 0) + dt;
        if (e.stoppedTime > 1.5) sec[e.sector] = Math.max(sec[e.sector], off ? 1 : 2);
        if (e.retired && e.stoppedTime > 4) { if (off) stoppedOff = stoppedOff || e; else stoppedOnTrack = stoppedOnTrack || e; }
      } else e.stoppedTime = 0;
      // retired cars are taken away by the marshals after a while
      if (e.retired && e.stoppedTime > (off ? 25 : 45)) { e.removed = true; this.emit("removed", { e }); }
    }
    this.sectorFlags = sec.map((v) => (v === 2 ? FLAG.DYELLOW : v === 1 ? FLAG.YELLOW : FLAG.GREEN));
    if (this.isRace && this.safetyCarOn && this.phase === "racing") {
      if (!this.sc && !this.vsc) {
        if (stoppedOnTrack && this.damage !== "off") this._deploySC(stoppedOnTrack);
        else if (stoppedOff && this.rules.id === "sim" && this.R() < 0.02) this._deployVSC(stoppedOff);
      }
      this._runSC(dt);
    }
    if (this.flag !== FLAG.CHEQUERED) this.flag = this.sc && this.sc.deployed ? FLAG.SC : this.vsc ? FLAG.VSC : this.sectorFlags.some((f) => f !== FLAG.GREEN) ? FLAG.YELLOW : FLAG.GREEN;
    // blue flags for lapped cars
    if (this.isRace) for (const e of this.entities) {
      if (e.removed || e.finished || e.pitPilot) { e.blueFlag = false; continue; }
      let blue = false;
      for (const o of this.entities) {
        if (o === e || o.removed || o.pitPilot) continue;
        if (o.progress - e.progress > this.track.length * 0.5) {
          const gap = tr.sDelta(o.car.q.s, e.car.q.s);
          if (gap > 0 && gap < Math.max(25, o.car.speed * 1.1)) { blue = true; break; }
        }
      }
      if (blue && !e.blueFlag) this.emit("blueFlag", { e });
      e.blueFlag = blue;
      if (blue) { e.blueTime += dt; if (e.isPlayer && this.rules.blueFlagPenalty && e.blueTime > 12) { e.blueTime = 0; this._penalise(e, 5, "Ignoring blue flags"); } }
      else e.blueTime = Math.max(0, e.blueTime - dt);
    }
    // DRS eligibility at detection points
    for (const e of this.entities) {
      if (e.removed) continue;
      const s = e.car.q.s;
      for (const z of tr.drs) {
        const before = tr.sDelta(z.detect, e._lastDetectS == null ? s : e._lastDetectS), after = tr.sDelta(z.detect, s);
        if (before < 0 && after >= 0) {
          const ahead = this._carAhead(e);
          e.drsEligible = !!ahead && this._gapTo(e, ahead) < 1.0 && ahead.lapsDown <= e.lapsDown + 1;
          if (e.drsEligible) this.emit("drsEnabled", { e });
        }
      }
      e._lastDetectS = s;
      // being close behind someone (AI uses it for ERS)
      const ah = this._carAhead(e);
      e.closeBehind = !!ah && tr.sDelta(e.car.q.s, ah.car.q.s) > 0 && tr.sDelta(e.car.q.s, ah.car.q.s) < Math.max(20, e.car.speed * 0.9);
    }
  }
  /** on a guest, DRS and blue flags still need working out locally for the HUD */
  _guestFlags() {
    const tr = this.track;
    for (const e of this.entities) {
      if (e.removed) continue;
      const s = e.car.q.s;
      for (const z of tr.drs) {
        const before = tr.sDelta(z.detect, e._lastDetectS == null ? s : e._lastDetectS), after = tr.sDelta(z.detect, s);
        if (before < 0 && after >= 0) {
          const ahead = this._carAhead(e);
          e.drsEligible = !!ahead && this._gapTo(e, ahead) < 1.0;
        }
      }
      e._lastDetectS = s;
    }
  }

  _carAhead(e) {
    let best = null, bd = Infinity;
    for (const o of this.entities) {
      if (o === e || o.removed || o.pitPilot) continue;
      const d = this.track.sDelta(e.car.q.s, o.car.q.s);
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    return best;
  }

  _deployVSC(cause) {
    this.vsc = { since: this.time, until: this.time + 25 + this.R() * 25, cause };
    this.emit("vsc", { deployed: true, cause });
  }
  _deploySC(cause) {
    const scLaps = this.laps <= 5 ? 1 : this.laps <= 12 ? 1 + Math.floor(this.R() * 2) : 2 + Math.floor(this.R() * 2);
    this.sc = { deployed: true, since: this.time, laps: scLaps, startLap: this._leaderLap(), inThisLap: false, cause };
    this.emit("safetyCar", { deployed: true, cause });
    // the train forms up behind the leader at a steady pace
  }
  _runSC(dt) {
    if (this.vsc && this.time > this.vsc.until) { this.vsc = null; this.emit("vsc", { deployed: false }); }
    const sc = this.sc;
    if (!sc) return;
    const order = (this.order || []).filter((e) => !e.removed && !e.retired && !e.finished && !e.pitPilot);
    if (sc.deployed) {
      // speeds: the leader runs at the SC pace, everyone else closes up to ~ 0.9 s behind the car ahead
      for (let k = 0; k < order.length; k++) {
        const e = order[k];
        const base = (e.profile ? e.profile[e.car.q.i] : 50) * 0.55;
        if (k === 0) e.scTarget = Math.min(base, 45);
        else {
          const ahead = order[k - 1];
          const gapM = this.track.sDelta(e.car.q.s, ahead.car.q.s);
          e.scTarget = clamp(ahead.car.u + (gapM - 22) * 0.35, 8, Math.min(base * 1.35, 62));
        }
      }
      const leaderLap = this._leaderLap();
      if (!sc.inThisLap && leaderLap - sc.startLap >= sc.laps && !this.entities.some((e) => e.retired && !e.removed && e.stoppedTime > 0 && Math.abs(e.car.q.d) < this.track.hw[e.car.q.i])) {
        sc.inThisLap = true; sc.endLap = leaderLap + 1;
        this.emit("safetyCarIn", {});
      }
      if (sc.inThisLap && leaderLap >= sc.endLap) {
        sc.deployed = false; this.sc = null;
        for (const e of this.entities) e.scTarget = null;
        this.emit("safetyCar", { deployed: false });
      }
    }
  }

  // ---------------- pit stops ----------------
  _pitLogic() {
    const tr = this.track, pit = tr.pit;
    for (const e of this.entities) {
      if (e.removed || e.retired || e.finished) continue;
      const c = e.car, s = c.q.s;
      const toEntry = tr.sDelta(s, pit.sIn);
      // AI decides whether to stop this lap
      if (e.ai && !e.pitPilot && this.isRace && this.phase === "racing" && !e.pit.requested) this._aiPitDecision(e);
      // player in a timed session: entering the pit lane by driving in
      const inEntryZone = tr.sDelta(pit.sIn, s) >= 0 && tr.sDelta(pit.sIn, s) < pit.ramp;
      const onPitSide = Math.sign(c.q.d) === pit.sign && Math.abs(c.q.d) > tr.hw[c.q.i] + 1.5;
      const wantsIn = e.pit.requested || (e.isPlayer && inEntryZone && onPitSide);
      if (!e.pitPilot && wantsIn && toEntry < 30 && toEntry > -5 && (e.ai || this.rules.autoPitLane || (inEntryZone && onPitSide))) this._enterPit(e);
      if (e.pitPilot && e.pitPilot.done) {
        e.pitPilot = null; e.pit.inLane = false; c.limiter = false; e.manualLimiter = false; e.pit.speeding = false;
        this.emit("pitExit", { e });
      }
    }
  }
  _aiPitDecision(e) {
    const c = e.car, w = this.weather.lineWater(), comp = COMPOUNDS[c.compound];
    const lapsLeft = this.laps - e.lap;
    let reason = null, tyres = null;
    let wear = 0; for (const wh of c.wheels) wear = Math.max(wear, wh.wear);
    if (comp.dry && w > 0.22) { reason = "rain"; tyres = bestCompoundFor(w); }
    else if (!comp.dry && w < 0.1 && lapsLeft > 1) { e._dryLaps = (e._dryLaps || 0) + 0.1 / 60; if (e._dryLaps > 0.6) { reason = "dry"; tyres = lapsLeft < 12 ? "soft" : "medium"; } }
    else if (c.compound === "inter" && w > 0.7) { reason = "heavy rain"; tyres = "wet"; }
    else if (wear > 0.66 && lapsLeft > 1) { reason = "tyres"; tyres = this._suggestCompound(e); }
    else if (e.pit.nextStopLap != null && e.lap + 1 >= e.pit.nextStopLap && lapsLeft > 1) { reason = "plan"; tyres = e.pit.nextCompound || this._suggestCompound(e); }
    else if (this.sc && this.sc.deployed && e.pit.nextStopLap != null && e.pit.nextStopLap - e.lap < 8 && lapsLeft > 2) { reason = "safety car"; tyres = e.pit.nextCompound || this._suggestCompound(e); }
    else if (c.puncture || c.wheels.some((wh) => wh.puncture)) { reason = "puncture"; tyres = this._suggestCompound(e); }
    if (reason) { e.pit.requested = true; e.pit.plan = { tyres, wing: c.damage.fwL > 0.3 || c.damage.fwR > 0.3, repair: true, reason }; }
  }
  _enterPit(e) {
    const tr = this.track, c = e.car;
    const slot = e.team && e.team.slot != null ? e.team.slot : e.idx % 10;
    const plan = e.pit.plan || { tyres: this._suggestCompound(e), wing: false, repair: true };
    let service = 2.1 + this.R() * 0.9;
    if (plan.wing) service += 5.5;
    if (this.R() < 0.04) service += 2 + this.R() * 4; // a slow stop happens
    const penaltyHold = this.isRace ? Math.max(0, e.penalty - e.penaltyServed) : 0;
    e.pit.inLane = true;
    e.pitLap = true;
    const manual = e.isPlayer && !this.rules.autoPitLane;
    e.pitPilot = new PitPilot(e, tr, {
      box: slot, serviceTime: service, penaltyHold,
      onStop: () => this.emit("pitStop", { e, plan, service: service + penaltyHold }),
      onService: () => {
        const was = c.compound;
        if (plan.tyres) { c.setCompound(plan.tyres, plan.tyres === "inter" || plan.tyres === "wet" ? 55 : 75); e.pit.compoundsUsed.add(plan.tyres); }
        if (plan.wing) { c.damage.fwL = 0; c.damage.fwR = 0; }
        if (plan.repair) { c.damage.susp = c.damage.susp.map((v) => v * 0.6); c.damage.body *= 0.5; for (const w of c.wheels) { w.puncture = false; } }
        e.penaltyServed += penaltyHold;
        e.pit.stops++;
        e.pit.requested = false; e.pit.plan = null;
        if (e.pit.nextStopLap != null && e.lap + 1 >= e.pit.nextStopLap) e.pit.nextStopLap = null;
        e._replan = true;
        this.emit("pitService", { e, from: was, to: c.compound, wing: plan.wing, served: penaltyHold });
      },
      onRelease: () => this.emit("pitRelease", { e }),
    });
    if (manual) e.pitPilot.manualLane = true;
    this.emit("pitEntry", { e });
  }
  _pitLaneChecks(e) {
    const tr = this.track, pit = tr.pit, c = e.car;
    const rel = tr.sDelta(pit.limitStart, c.q.s), len = pit.limitEnd - pit.limitStart;
    if (rel > 0 && rel < len && c.u > pit.speedLimit + 0.4 && !e.pit.speeding) { e.pit.speeding = true; this._penalise(e, 5, "Pit lane speeding"); }
  }

  // ---------------- results ----------------
  results() {
    const order = (this.order || this.entities).slice();
    const leader = order[0];
    return order.map((e, k) => {
      const timeWithPen = e.finishTime != null ? e.finishTime + Math.max(0, e.penalty - e.penaltyServed) : null;
      return {
        id: e.id, name: e.name, short: e.short, number: e.number, team: e.team ? e.team.name : "", teamId: e.team ? e.team.id : null, color: e.team ? e.team.color : "#888",
        position: k + 1, laps: e.lap, time: timeWithPen, bestLap: e.bestLap, gap: e.gap, lapsDown: e.lapsDown,
        penalty: e.penalty, stops: e.pit.stops, status: e.retired ? "DNF" : e.notClassified ? "NC" : e.finished ? "Finished" : "Running", dnf: e.dnf,
        points: this.isRace && !e.retired && k < POINTS.length ? POINTS[k] : 0, isPlayer: e.isPlayer, remote: e.remote,
        fastest: this.fastestLap && this.fastestLap.e === e, topSpeed: e.stats.topSpeed, overtakes: e.stats.overtakes,
        compounds: [...e.pit.compoundsUsed],
      };
    }).sort((a, b) => {
      if (!this.isRace) return 0;
      if (a.status !== b.status) return a.status === "DNF" ? 1 : b.status === "DNF" ? -1 : 0;
      if (a.time != null && b.time != null && a.laps === b.laps) return a.time - b.time;
      return 0;
    }).map((r, k, arr) => {
      // apply time penalties to the classification and the mandatory compound rule
      r.position = k + 1;
      if (this.isRace && this.rules.mandatoryCompounds && r.status === "Finished") {
        const dry = r.compounds.filter((c) => COMPOUNDS[c].dry);
        const wetUsed = r.compounds.some((c) => !COMPOUNDS[c].dry);
        if (!wetUsed && new Set(dry).size < 2 && this.laps >= 6) { r.dq = true; r.status = "DSQ"; }
      }
      r.points = this.isRace && !r.dq && r.status !== "DNF" && r.status !== "NC" && k < POINTS.length ? POINTS[k] : 0;
      if (r.fastest && r.points > 0 && k < 10) r.points += 1;
      return r;
    });
  }

  /** compact state for networking and replays */
  snapshot() {
    return this.entities.map((e) => {
      const c = e.car;
      return [c.x, c.y, c.z, c.h, c.u, c.v, c.r, c.steer, c.rpm, c.gear, c.throttle, c.brake, c.drsOpen ? 1 : 0, c.bodyPitch, c.bodyRoll,
        c.wheels[0].rot, c.wheels[2].rot, c.limiter ? 1 : 0, e.removed ? 1 : 0];
    });
  }
}
