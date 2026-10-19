// CLANKO GP — runs one session on screen: builds the session and the 3D world, reads the
// controls, steps the physics at a fixed rate, moves the cameras, draws the HUD and handles
// pause and results.

import * as THREE from "three";
import { Track, getTrack } from "../core/track.js";
import { TRACK_BY_ID } from "../core/tracks-data.js";
import { Session } from "../core/session.js";
import { Weather } from "../core/weather.js";
import { DT } from "../core/physics.js";
import { TEAMS, DRIVERS, TEAM_BY_ID, driverShort, teamLivery } from "../core/teams.js";
import { COMPOUNDS } from "../core/car-specs.js";
import { World } from "../render/world.js";
import { CameraRig, CAMERAS } from "../render/cameras.js";
import { HUD } from "../ui/hud.js";
import { Radio, PRIORITY } from "./radio.js";
import { clamp, fmtTime, rng } from "../core/math.js";
import { NetRace, NET } from "../net/race-net.js";
import { ReplayRecorder } from "./replay.js";

export class RaceController {
  /**
   * cfg: { trackId, type, laps, timeLimit, rules, damage, weather, aiCount, difficulty, start, hour, player:{name, short, number, livery, setup, assists, compound, teamId}, grid, ghost }
   */
  constructor(app, cfg) {
    this.app = app; this.cfg = cfg;
    this.g = app.graphics;
    this.settings = app.store.settings;
    this.accum = 0;
    this.timeScale = 1;
    this.paused = false;
    this.over = false;
    this.listeners = [];
  }

  async build(progress = () => {}) {
    const cfg = this.cfg, S = this.settings;
    progress(0.05, "Building the circuit");
    await tick();
    const def = TRACK_BY_ID[cfg.trackId];
    const track = getTrack(def);
    this.track = track;
    progress(0.2, "Planning the racing line");
    await tick();
    const weather = new Weather({ track, mode: cfg.weather || "dry", hour: cfg.hour != null ? cfg.hour : def.time, seed: cfg.seed || 11, dynamicTime: cfg.dynamicTime !== false, timeScale: cfg.timeScale || 1, duration: 7200 });
    const session = new Session({
      track, type: cfg.type || "race", laps: cfg.laps || 5, timeLimit: cfg.timeLimit, rules: cfg.rules || S.gameplay.rules,
      damage: cfg.damage || S.gameplay.damage, weather, tyreWear: cfg.tyreWear != null ? cfg.tyreWear : S.gameplay.tyreWear,
      fuelUse: cfg.fuelUse != null ? cfg.fuelUse : S.gameplay.fuelUse, start: cfg.start, safetyCar: cfg.safetyCar !== false,
      aiDifficulty: cfg.difficulty != null ? cfg.difficulty : S.gameplay.difficulty, seed: cfg.seed || 7,
      netMode: cfg.net ? (cfg.net.isHost ? "host" : "guest") : null,
    });
    weather.line = session.line;
    this.session = session;
    // ----- the field -----
    const P = cfg.player || {};
    const playerTeam = P.teamId && TEAM_BY_ID[P.teamId] ? { ...TEAM_BY_ID[P.teamId], slot: TEAMS.findIndex((t) => t.id === P.teamId) }
      : { id: "player", name: P.teamName || "Clanko Racing", short: P.teamShort || "CLK",
          color: (P.livery && P.livery.base) || "#ffd23a", color2: (P.livery && P.livery.secondary) || "#17181c", accent: (P.livery && P.livery.accent) || "#ff4b3e",
          pattern: (P.livery && P.livery.pattern) || "chevron", sponsor: (P.livery && P.livery.sponsor) || "CLANKO100.COM",
          slot: 9, perf: P.perf || { power: 1, aero: 1, grip: 1 } };
    const aiCount = cfg.net || cfg.type === "timetrial" ? 0 : clamp(cfg.aiCount != null ? cfg.aiCount : 19, 0, 23);
    const R = rng(cfg.seed || 7);
    let drivers = DRIVERS.slice();
    // the player takes a seat: if racing for a team, that team's second driver sits out
    if (P.teamId) { const out = drivers.filter((d) => d.team === P.teamId).pop(); drivers = drivers.filter((d) => d !== out); }
    drivers = drivers.slice(0, aiCount);
    if (cfg.fixedDrivers) drivers = cfg.fixedDrivers.map((id) => DRIVERS.find((d) => d.id === id)).filter(Boolean);
    this.fieldIds = ["player", ...drivers.map((d) => d.id)];
    const grid = this._gridOrder(drivers.length + 1, cfg.grid || "random", R, P.gridSlot);
    const playerAssists = { ...S.assists, ...(P.assists || {}) };
    const pc = session.addCar({
      id: "player", name: P.name || (app.store.data.profile ? app.store.data.profile.name : "You"), short: P.short || (app.store.data.profile ? app.store.data.profile.short : "YOU"),
      number: P.number || (app.store.data.profile ? app.store.data.profile.number : 1), team: playerTeam, livery: P.livery || teamLivery(playerTeam, { number: P.number || 1, helmet: ["#ffd23a", "#111"] }),
      player: true, setup: P.setup, compound: P.compound || (cfg.weather === "wet" ? "inter" : "medium"), perf: playerTeam.perf, assists: playerAssists, grid: grid[0],
    });
    if (P.fuel != null) pc.car.setup.fuel = P.fuel;
    drivers.forEach((d, k) => {
      const team = { ...TEAM_BY_ID[d.team], slot: TEAMS.findIndex((t) => t.id === d.team) };
      session.addCar({ id: d.id, name: `${d.first} ${d.last}`, short: driverShort(d), number: d.number, team, livery: teamLivery(team, d), perf: team.perf,
        ai: { skill: d.skill, personality: d.personality, wetSkill: d.wet }, grid: grid[k + 1], compound: cfg.weather === "wet" ? "inter" : cfg.weather === "storm" ? "wet" : "medium" });
    });
    this.player = pc;
    // online: the other player's car, driven over the network
    if (cfg.net) {
      const r = cfg.net.remote || {};
      const oppTeam = { id: "opp", name: r.teamName || "Opponent", short: r.short || "OPP", color: (r.livery && r.livery.base) || "#2b6fd6", color2: (r.livery && r.livery.secondary) || "#f4f4f4", accent: (r.livery && r.livery.accent) || "#ffffff", pattern: (r.livery && r.livery.pattern) || "split", sponsor: (r.livery && r.livery.sponsor) || "", slot: 8, perf: { power: 1, aero: 1, grip: 1 } };
      const oc = session.addCar({ id: "remote", name: r.name || "Opponent", short: r.short || "OPP", number: r.number || 2, team: oppTeam,
        livery: r.livery || teamLivery(oppTeam, { number: r.number || 2, helmet: ["#ffffff", oppTeam.color] }), remote: true, grid: grid[1], compound: P.compound || "medium" });
      oc.netControlled = !cfg.net.isHost; // on the host the guest's car runs the real physics from their inputs
      this.opponent = oc;
    }
    progress(0.35, "Building the world");
    await tick();
    // ----- 3D -----
    const teams = TEAMS.map((t) => ({ color: t.color }));
    if (!P.teamId) teams[9] = { color: playerTeam.color };
    this.world = new World(this.g, session, { teams });
    progress(0.75, "Preparing the cars");
    await tick();
    for (const e of session.entities) this.world.addCar(e, { player: e === pc });
    this.rig = new CameraRig(this.g.camera, { ...S.graphics, camera: S.gameplay.camera });
    this.rig.setMode(S.gameplay.camera || "chase");
    // atmosphere
    this._atmoTimer = 0;
    this._applyAtmosphere(true);
    // HUD and radio
    this.hud = new HUD(this.app.overlay, session, pc, S.hud);
    this.radio = new Radio({ hud: this.hud, settings: S.audio });
    // audio
    if (this.app.audio) this.app.audio.attachRace(this);
    // ghost (time trial)
    if (cfg.ghost) this._setupGhost(cfg.ghost);
    session.start();
    this.recorder = new ReplayRecorder(session);
    if (cfg.net) {
      this.net = new NetRace({
        link: cfg.net.link, isHost: cfg.net.isHost, session, myId: "player", remoteId: "remote",
        onEvent: (e, d) => this._netEvent(e, d),
        onResult: (r) => { this._netResults = r; },
        onRestart: () => this.restart(),
        onChat: (text) => this.hud.subtitle(String(text).slice(0, 160), (cfg.net.remote && cfg.net.remote.name) || "OPPONENT", 5000),
      });
      this.online = cfg.net.online;
    }
    pc._fuelStart = pc.car.fuel;
    const nSlots = Math.ceil(track.length / 10) + 2;
    this._lapProfile = new Float32Array(nSlots).fill(NaN);
    this._lapTrace = { v: new Float32Array(nSlots), thr: new Float32Array(nSlots), brk: new Float32Array(nSlots), steer: new Float32Array(nSlots), gear: new Float32Array(nSlots) };
    const rec = this.app.store.data.records[track.id];
    this._bestProfile = cfg.bestProfile || (rec && rec.profile ? Float32Array.from(rec.profile.map((x) => (x === null ? NaN : x))) : null);
    progress(1, "Ready");
    this.g.updateEnvironment(true);
    this.hud.message(cfg.type === "race" ? `${def.name} — ${session.laps} laps` : `${def.name} — ${cfg.type === "timetrial" ? "Time Trial" : cfg.type === "qualifying" ? "Qualifying" : "Practice"}`, "title", 3000);
    if (session.phase === "lights") this.radio.say("Get ready. Watch the lights.", { priority: PRIORITY.HIGH });
    return this;
  }

  _gridOrder(n, mode, R, playerSlot) {
    const slots = [...Array(n).keys()];
    if (mode === "back") return [n - 1, ...slots.slice(0, n - 1)];
    if (mode === "front") return slots;
    if (mode === "slot" && playerSlot != null) { const rest = slots.filter((s) => s !== playerSlot); return [playerSlot, ...rest]; }
    if (mode === "order" && this.cfg.gridOrder) return this.cfg.gridOrder;
    // random: shuffle, the AI roughly by skill
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    return slots;
  }

  _applyAtmosphere(force) {
    const W = this.session.weather, def = this.track.def;
    this.g.setAtmosphere({ hour: W.hour, clouds: W.clouds, rain: W.rain, floodlit: !!def.night, fogBase: this.world.trackView.theme.fogDay });
    if (force) this.g.updateEnvironment(true);
  }

  _setupGhost(g) {
    // g: { frames: Float32Array [x,y,z,h,...] at 20 Hz, time }
    this.ghost = g;
    this.ghostView = this.world.addCar({ id: "ghost", car: { x: 0, y: 0, z: 0, h: 0, compound: "medium" }, livery: { base: "#9ad7ff", secondary: "#ffffff", accent: "#ffffff", pattern: "none", number: 0, name: "GHOST", sponsor: "" } });
    this.ghostView.root.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } o.castShadow = false; });
  }

  // ---------------- controls ----------------
  _controls(dt) {
    const inp = this.app.input, S = this.session, e = this.player, c = e.car;
    const o = inp.poll(dt, Math.abs(c.u));
    if (this.paused) return;
    if (inp.take("pause")) { this.app.pause(); return; }
    if (inp.take("camera")) { const m = this.rig.cycle(1); this.hud.message(CAMERAS.find((x) => x.id === m).name + " camera", "small", 900); this.settings.gameplay.camera = m; }
    if (inp.take("reset")) this.cmd("reset");
    if (inp.take("limiter")) this.cmd("limiter");
    if (inp.take("biasUp")) this.cmd("bias", 1);
    if (inp.take("biasDown")) this.cmd("bias", -1);
    if (inp.take("ersMode")) this.cmd("ersMode");
    if (inp.take("hud")) { this.settings.hud.show = !(this.settings.hud.show !== false); this.hud.applySettings(this.settings.hud); }
    if (inp.take("tower")) { this.settings.hud.tower = !(this.settings.hud.tower !== false); this.hud.applySettings(this.settings.hud); }
    if (inp.take("radio")) this.app.ui.radioMenu(this);
    if (inp.take("mfd")) this.app.ui.mfd(this);
    if (inp.take("shiftUp")) c.gear < c.cls.gears.length && !c.assists.autoGear && (S.byId(e.id).input.shiftUp = true);
    if (inp.take("shiftDown")) !c.assists.autoGear && (S.byId(e.id).input.shiftDown = true);
    this.rig.lookBack = o.lookBack;
    if (this.net && !this.net.isHost) this.net.sendInput(o);
    const manualClutch = S.rules.manualClutch && S.phase === "lights";
    S.setInput(e.id, {
      steer: o.steer, throttle: o.throttle, brake: o.brake, analog: o.analog,
      drsHeld: o.drsHeld && !manualClutch, overtake: o.overtake, clutch: manualClutch ? o.drsHeld : undefined,
    });
  }

  /** a command from the player: run it here, or ask the host to run it when racing online as a guest */
  cmd(name, arg) {
    if (this.net && !this.net.isHost) this.net.sendCommand(name, arg);
    else this.session.command(this.player.id, name, arg);
  }

  // ---------------- per frame ----------------
  frame(dt) {
    if (this.over && !this.resultsShown && !this.replay) return;
    const S = this.session, W = this.world, e = this.player;
    if (this.replay) return this._replayFrame(dt);
    this._controls(dt);
    // physics at a fixed 240 Hz
    if (!this.paused && S.phase !== "done") {
      this.accum += dt * this.timeScale;
      const maxSteps = 48; let steps = 0;
      if (this.accum >= DT) W.beforeSteps();
      while (this.accum >= DT && steps < maxSteps) {
        S.step(DT);
        // one-shot gear inputs only last one step
        e.input.shiftUp = false; e.input.shiftDown = false;
        this.accum -= DT; steps++;
      }
      if (steps >= maxSteps) this.accum = 0;
      if (steps) this.recorder.step(steps * DT);
      this._ghostRecord();
    }
    if (this.net) {
      this.net.update(dt);
      this.net.interpolate(dt);
      if (this.net.isHost && S.phase === "done" && !this._sentResults) { this._sentResults = true; this.net.sendResult(S.results()); }
    }
    const alpha = clamp(this.accum / DT, 0, 1);
    for (const ev of S.drainEvents()) this._event(ev);
    this._delta();
    W.sync(dt, alpha, e);
    W.updateSignals(dt);
    W.updateWeather(dt);
    this._ghostPlay();
    // camera
    const view = W.cars.get(this.focusId || e.id);
    const focus = this.focusId ? S.byId(this.focusId) : e;
    this.rig.update(dt, focus.car, view, this.track, W.trackView.tvSpots, (x, z) => W.trackView.groundY(x, z));
    // hide the driver's own car body bits that block the cockpit view
    view.main.parts.driver.grp.visible = !(this.rig.mode === "cockpit" || this.rig.mode === "helmet") || focus !== e;
    if (view.main.parts.driver.helmet) view.main.parts.driver.helmet.visible = !(this.rig.mode === "cockpit" || this.rig.mode === "helmet");
    this.g.followShadows(focus.car);
    W.update(dt, this.g.camera, focus.car);
    // atmosphere follows the clock and the clouds
    this._atmoTimer -= dt;
    if (this._atmoTimer <= 0) { this._atmoTimer = 2; this._applyAtmosphere(false); if (this.g.preset.envEvery && (this._envT = (this._envT || 0) + 2) >= this.g.preset.envEvery) { this._envT = 0; this.g.updateEnvironment(true); } }
    // live mirrors in the cockpit
    const inside = this.rig.mode === "cockpit" || this.rig.mode === "helmet";
    if (inside && this.settings.graphics.mirrors !== false) W.mirrors.renderSide(view);
    this.g.render(dt);
    const rect = !inside && this.settings.graphics.hudMirror !== false && this.settings.hud.mirror !== false && this.rig.mode !== "tv" && this.rig.mode !== "heli" ? this.hud.mirrorRect() : null;
    if (rect) W.mirrors.renderCentre(view, rect);
    this.hud.showMirrorFrame(!!rect);
    this.hud.root.classList.toggle("inside", inside);
    this.hud.update(dt, { fps: this.g.stats.fps, res: Math.round(this.g.scale * 100), calls: this.g.stats.calls, showFps: this.settings.graphics.showFps || this.settings.debug,
      net: this.net ? { connected: this.net.connected, ping: this.net.ping, lost: this.net.stats.lost } : null });
    this.radio.update();
    if (this.app.audio) this.app.audio.update(dt, this);
    if (this.app.debug) this.app.debug.update(this);
    if (S.phase === "done" && !this.over) { this.over = true; setTimeout(() => this.app.ui.results(this), 1800); }
  }

  _netEvent(e, d) {
    if (e === "disconnect") this.hud.message("Opponent disconnected", "warn", 4000);
  }

  /** playing a replay: the recording drives the cars, the cameras still work */
  _replayFrame(dt) {
    const W = this.world, R = this.replay;
    W.beforeSteps();
    R.update(dt);
    R.onTick && R.onTick();
    const focus = this.session.entities[R.focus] || this.player;
    this.focusId = focus.id;
    W.sync(dt, 1, focus);
    W.updateSignals(dt);
    const view = W.cars.get(focus.id);
    this.rig.update(dt, focus.car, view, this.track, W.trackView.tvSpots, (x, z) => W.trackView.groundY(x, z));
    this.g.followShadows(focus.car);
    W.update(dt, this.g.camera, focus.car);
    this.g.render(dt);
    this.hud.e = focus;
    this.hud.update(dt, { fps: this.g.stats.fps, res: Math.round(this.g.scale * 100), calls: this.g.stats.calls, showFps: this.settings.graphics.showFps });
  }

  _event(ev) {
    const S = this.session, e = this.player, hud = this.hud;
    if (this.recorder && ["hitWall", "hitCar", "overtake", "retire", "pitStop", "lap", "penalty", "safetyCar"].includes(ev.type)) this.recorder.note(ev.type, S.time, { who: ev.e ? ev.e.short : null });
    this.world.handleEvent(ev);
    this.radio.react(ev, e, S);
    if (this.app.audio) this.app.audio.event(ev, this);
    const mine = ev.e === e;
    switch (ev.type) {
      case "light": break;
      case "lightsOut": hud.message("GO!", "go", 1200); this.app.input.rumble(0.4, 0.6, 200); break;
      case "lap": if (mine) { hud.message(`${ev.valid ? "" : "INVALID — "}LAP ${fmtTime(ev.time)}`, ev.valid ? (ev.fastest ? "purple" : ev.pb ? "green" : "info") : "warn", 2200); this._lapDone(ev); } break;
      case "sector": break;
      case "penalty": if (mine) hud.message(`+${ev.seconds}s PENALTY — ${ev.reason}`, "warn", 3000); break;
      case "trackLimits": if (mine) hud.message(`TRACK LIMITS — WARNING ${ev.count}`, "warn", 2000); break;
      case "lapInvalid": if (mine) hud.message("LAP INVALIDATED", "warn", 1500); break;
      case "safetyCar": hud.message(ev.deployed ? "SAFETY CAR DEPLOYED" : "SAFETY CAR IN — GREEN FLAG", ev.deployed ? "warn" : "go", 3000); if (!ev.deployed) S._greenFlash = S.time; break;
      case "vsc": hud.message(ev.deployed ? "VIRTUAL SAFETY CAR" : "VSC ENDING — GREEN FLAG", ev.deployed ? "warn" : "go", 3000); if (!ev.deployed) S._greenFlash = S.time; break;
      case "hitWall": case "hitCar": if (mine && ev.speed > 3) { this.rig.bump(Math.min(0.06, ev.speed * 0.004) * (this.settings.accessibility.shakeAmount ?? 1)); this.app.input.rumble(Math.min(1, ev.speed / 15), 0.5, 160); } break;
      case "reset": if (mine) hud.message("BACK ON TRACK", "info", 1500); break;
      case "stuck": if (mine) hud.message("Press R to return to the track", "info", 2500); break;
      case "pitEntry": if (mine) hud.message("PIT LANE", "info", 1500); break;
      case "pitExit": if (mine) hud.message("PIT EXIT — watch the white line", "info", 2000); break;
      case "chequered": hud.message("CHEQUERED FLAG", "title", 3000); break;
      case "finish": if (mine) hud.message(S.isRace ? `FINISHED P${ev.position}` : "SESSION OVER", "title", 4000); break;
      case "message": if (mine) hud.message(ev.text, "info", 1600); break;
      case "drsOpen": break;
      case "sessionEnd": break;
    }
  }

  // live delta to the best lap, sampled every 10 m
  _delta() {
    const e = this.player, S = this.session;
    if (e.lapStart == null || S.phase === "lights") { e.deltaLive = null; return; }
    const t = S.time - e.lapStart, k = Math.floor(e.car.q.s / 10);
    if (e.armed || e.car.q.s < this.track.length / 2) {
      this._lapProfile[k] = t;
      const T = this._lapTrace, c = e.car;
      T.v[k] = Math.abs(c.u) * 3.6; T.thr[k] = c.throttle; T.brk[k] = c.brake; T.steer[k] = c.steerInput; T.gear[k] = c.gear;
    }
    if (this._bestProfile && !isNaN(this._bestProfile[k])) e.deltaLive = t - this._bestProfile[k];
    else e.deltaLive = null;
  }
  _lapDone(ev) {
    const isBest = ev.valid && ev.pb;
    if (isBest) {
      this._bestProfile = this._lapProfile.slice();
      this._saveRecord(ev);
      this._beatRecord = true;
    }
    this._lapProfile.fill(NaN);
    // ghost: keep the best lap's frames
    if (this._ghostRec && isBest) { this.bestGhost = { frames: Float32Array.from(this._ghostRec), time: ev.time, v: 1 }; this.app.saveGhost(this.track.id, this.bestGhost, ev.time); }
    this._ghostRec = [];
    this._ghostT = 0;
    if (this.ghost) this._ghostClock = 0;
  }
  _saveRecord(ev) {
    const rec = this.app.store.data.records;
    const id = this.track.id;
    const key = id + (this.session.type === "timetrial" ? ":tt" : "");
    if (!rec[key] || ev.time < rec[key].time) {
      const T = this._lapTrace;
      const down = (arr, dp) => Array.from(arr, (x) => (isNaN(x) ? null : Math.round(x * dp) / dp));
      rec[key] = { time: ev.time, date: Date.now(), sectors: ev.sectors, compound: this.player.car.compound,
        profile: down(this._lapProfile, 100), trace: { v: down(T.v, 1), thr: down(T.thr, 100), brk: down(T.brk, 100), steer: down(T.steer, 100) } };
      if (!this.app.store.save()) { delete rec[key].trace; delete rec[key].profile; this.app.store.save(); }
    }
  }
  _ghostRecord() {
    if (this.session.type !== "timetrial" && !this.cfg.recordGhost) return;
    const c = this.player.car;
    this._ghostRec = this._ghostRec || [];
    this._ghostT = (this._ghostT || 0) + 1;
    if (this._ghostT % 3 === 0) this._ghostRec.push(c.x, c.y, c.z, c.h); // ~80 Hz / 3 frames at 60 fps
  }
  _ghostPlay() {
    if (!this.ghost || !this.ghostView) return;
    const e = this.player, S = this.session;
    const v = this.ghostView;
    if (e.lapStart == null) { v.root.visible = false; return; }
    const t = S.time - e.lapStart;
    const fr = this.ghost.frames, n = fr.length / 4;
    const rate = n / this.ghost.time;
    const f = t * rate, i = Math.floor(f);
    if (i >= n - 1) { v.root.visible = false; return; }
    const a = f - i;
    const x = fr[i * 4] + (fr[i * 4 + 4] - fr[i * 4]) * a, y = fr[i * 4 + 1] + (fr[i * 4 + 5] - fr[i * 4 + 1]) * a, z = fr[i * 4 + 2] + (fr[i * 4 + 6] - fr[i * 4 + 2]) * a;
    let dh = fr[i * 4 + 7] - fr[i * 4 + 3]; if (dh > Math.PI) dh -= Math.PI * 2; if (dh < -Math.PI) dh += Math.PI * 2;
    v.root.visible = true;
    v.update({ x, y, z, h: fr[i * 4 + 3] + dh * a, bodyPitch: 0, bodyRoll: 0, steer: 0, wheels: [0, 1, 2, 3].map(() => ({ rot: t * 30, Fz: 3000, detached: false })), brakeTemp: [300, 300, 300, 300], rpm: 10000, cls: this.player.car.cls, damage: null }, 0.016, {});
  }

  pause(on) { this.paused = on; this.session.paused = on; if (on) this.radio.stop(); }
  restart() { this.app.startRace(this.cfg); }
  dispose() {
    this.net && this.net.dispose();
    this.radio && this.radio.stop();
    this.hud && this.hud.dispose();
    this.world && this.world.dispose();
    if (this.app.audio) this.app.audio.detachRace();
  }
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }
