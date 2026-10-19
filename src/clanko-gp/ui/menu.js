// CLANKO GP — menus and screens: main menu, race setup, time trial, settings, controls, pause,
// results, loading, radio menu, car settings panel. Plain DOM, keyboard/gamepad friendly.

import { h, clear, esc } from "./dom.js";
import { TRACKS, TRACK_BY_ID } from "../core/tracks-data.js";
import { getTrack } from "../core/track.js";
import { buildLayout } from "../core/layout.js";
import { TEAMS } from "../core/teams.js";
import { COMPOUNDS, ERS_MODES, FUEL_MIXES } from "../core/car-specs.js";
import { QUALITY } from "../render/graphics.js";
import { ACTIONS, DEFAULT_KEYS, keyName } from "../game/input.js";
import { fmtTime, clamp } from "../core/math.js";

const thumbCache = new Map();
export function trackThumb(def, w = 220, hgt = 140, color = "#ffd23a") {
  const key = def.id + w + hgt + color;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const L = buildLayout({ ...def, preview: true });
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < L.N; i++) { minx = Math.min(minx, L.x[i]); maxx = Math.max(maxx, L.x[i]); minz = Math.min(minz, L.z[i]); maxz = Math.max(maxz, L.z[i]); }
  const c = document.createElement("canvas"); c.width = w * 2; c.height = hgt * 2;
  const g = c.getContext("2d");
  const pad = 16, sc = Math.min((c.width - pad * 2) / (maxx - minx), (c.height - pad * 2) / (maxz - minz));
  const ox = (c.width - (maxx - minx) * sc) / 2, oz = (c.height - (maxz - minz) * sc) / 2;
  g.lineJoin = g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i <= L.N; i += 2) { const k = i % L.N; const x = ox + (L.x[k] - minx) * sc, y = oz + (L.z[k] - minz) * sc; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath();
  g.strokeStyle = "rgba(255,255,255,0.15)"; g.lineWidth = 12; g.stroke();
  g.strokeStyle = color; g.lineWidth = 5; g.stroke();
  const sx = ox + (L.x[0] - minx) * sc, sy = oz + (L.z[0] - minz) * sc;
  g.fillStyle = "#fff"; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill();
  const url = c.toDataURL();
  thumbCache.set(key, url);
  return url;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.root = app.uiRoot;
    this.stack = [];
    this.toastEl = h("div", { class: "gp-toast" });
    document.body.appendChild(this.toastEl);
    this.root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); } });
  }
  get S() { return this.app.store.settings; }
  save() { this.app.store.save(); }

  // ---------- generic ----------
  screen(cls, ...children) {
    clear(this.root);
    const el = h("div", { class: "screen " + cls }, ...children);
    this.root.appendChild(el);
    this.root.classList.add("on");
    const first = el.querySelector("button, [tabindex], select, input");
    if (first) setTimeout(() => first.focus(), 30);
    return el;
  }
  hideAll() { clear(this.root); this.root.classList.remove("on"); this.app.input.enabled = true; }
  push(fn) { this.stack.push(fn); fn(); }
  back() { this.stack.pop(); const prev = this.stack[this.stack.length - 1]; if (prev) prev(); else this.mainMenu(); }
  toast(text, ms = 2500) { this.toastEl.textContent = text; this.toastEl.classList.add("on"); clearTimeout(this._tt); this._tt = setTimeout(() => this.toastEl.classList.remove("on"), ms); }
  error(text) { this.toast(text, 8000); }
  header(title, sub) {
    return h("div", { class: "scr-head" }, h("button", { class: "btn ghost back", onclick: () => this.back(), "aria-label": "Back" }, "← Back"), h("div", {}, h("h2", {}, title), sub ? h("p", {}, sub) : null));
  }

  loading(p, text) {
    if (!this._loadEl || !this.root.contains(this._loadEl)) {
      this._loadBar = h("i");
      this._loadText = h("p", {}, text || "Loading");
      this._loadEl = this.screen("loading", h("div", { class: "load-box" }, h("h1", { class: "logo" }, "CLANKO ", h("span", {}, "GP")), h("div", { class: "load-bar" }, this._loadBar), this._loadText,
        h("p", { class: "tip" }, TIPS[Math.floor(Math.random() * TIPS.length)])));
    }
    this._loadBar.style.transform = `scaleX(${clamp(p, 0, 1)})`;
    if (text) this._loadText.textContent = text;
  }

  // ---------- main menu ----------
  mainMenu() {
    this.stack = [() => this.mainMenu()];
    const prof = this.app.store.data.profile;
    const item = (label, sub, fn, cls = "") => h("button", { class: "menu-item " + cls, onclick: fn }, h("b", {}, label), h("small", {}, sub));
    this.screen("main",
      h("div", { class: "main-left" },
        h("h1", { class: "logo big" }, "CLANKO ", h("span", {}, "GP")),
        h("p", { class: "tagline" }, "Open-wheel racing in your browser"),
        h("nav", { class: "menu" },
          item("Quick Race", "Pick a circuit and go racing", () => this.push(() => this.raceSetup("race"))),
          item("Grand Prix Weekend", "Practice, qualifying and the race", () => this.push(() => this.weekendSetup())),
          item("Time Trial", "Chase your ghost and your records", () => this.push(() => this.timeTrialSetup())),
          item("Career", "From junior driver to team owner", () => this.push(() => this.career())),
          item("Online", "Race a friend, one on one", () => this.push(() => this.online())),
          item("Garage", "Setup, livery and car editor", () => this.push(() => this.garageMenu())),
          item("Driver", prof ? `${prof.name} #${prof.number}` : "Create your driver", () => this.push(() => this.driverMenu())),
          item("Replays & Records", "Lap records, ghosts and saved replays", () => this.push(() => this.records())),
          item("Achievements", "Challenges and milestones", () => this.push(() => this.achievements())),
          item("Settings", "Graphics, sound, HUD, accessibility", () => this.push(() => this.settings())),
          item("Controls", "Keyboard, gamepad and wheel", () => this.push(() => this.controls())),
          item("Help", "How to drive, rules and credits", () => this.push(() => this.help())),
        )),
      h("div", { class: "main-foot" }, h("span", {}, "Made by clanko · CLANKO100.COM"), h("span", {}, `Graphics: ${QUALITY[this.app.qualityId] ? QUALITY[this.app.qualityId].name : this.app.qualityId}`)));
  }

  // ---------- track picker ----------
  trackPicker(selected, onPick) {
    const grid = h("div", { class: "track-grid" });
    for (const def of TRACKS) {
      const rec = this.app.store.data.records[def.id] || this.app.store.data.records[def.id + ":tt"];
      const card = h("button", { class: "track-card" + (def.id === selected ? " sel" : ""), onclick: () => { grid.querySelectorAll(".track-card").forEach((c) => c.classList.remove("sel")); card.classList.add("sel"); onPick(def.id); } },
        h("img", { src: trackThumb(def), alt: "" }),
        h("div", { class: "tc-body" }, h("b", {}, def.name), h("small", {}, def.place + (def.night ? " · Night" : "") + (def.street ? " · Street" : "")), h("p", {}, def.character),
          rec ? h("small", { class: "rec" }, "Your best " + fmtTime(rec.time)) : null));
      card.style.setProperty("--flag", def.flag);
      grid.appendChild(card);
    }
    return grid;
  }

  field(label, control, help) { return h("label", { class: "field" }, h("span", {}, label), control, help ? h("small", {}, help) : null); }
  select(value, options, onChange) {
    const s = h("select", { onchange: () => onChange(s.value) }, options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(value) }, t)));
    return s;
  }
  range(value, min, max, step, onChange, fmt = (v) => v) {
    const out = h("output", {}, fmt(value));
    const r = h("input", { type: "range", min, max, step, value, oninput: () => { out.textContent = fmt(+r.value); onChange(+r.value); } });
    return h("div", { class: "range" }, r, out);
  }
  toggleCtl(value, onChange) {
    const b = h("button", { class: "toggle" + (value ? " on" : ""), role: "switch", "aria-checked": String(!!value), onclick: () => { value = !value; b.classList.toggle("on", value); b.setAttribute("aria-checked", String(value)); onChange(value); } }, h("i"));
    return b;
  }

  // ---------- race setup ----------
  raceSetup(type = "race", preset = {}) {
    const G = this.S.gameplay;
    const cfg = this._lastCfg = { trackId: preset.trackId || this._lastTrack || "fiorella", type, laps: G.laps || 5, aiCount: 19, difficulty: G.difficulty, rules: G.rules, damage: G.damage, weather: G.weather, grid: "random", hour: null, timeLimit: 900, start: null, safetyCar: true, tyreWear: G.tyreWear, ...preset };
    const def = () => TRACK_BY_ID[cfg.trackId];
    const hourSel = () => this.select(cfg.hour == null ? "default" : cfg.hour, [["default", "Circuit default"], [9, "Morning"], [13, "Midday"], [17, "Late afternoon"], [19.6, "Sunset"], [22, "Night"]], (v) => (cfg.hour = v === "default" ? null : +v));
    const opts = h("div", { class: "setup-opts" },
      this.field("Session", this.select(cfg.type, [["race", "Race"], ["qualifying", "Qualifying"], ["practice", "Practice"]], (v) => { cfg.type = v; })),
      this.field("Race length", this.select(cfg.laps, [[1, "1 lap"], [3, "3 laps"], [5, "5 laps"], [8, "8 laps"], [12, "12 laps"], [20, "20 laps"], [30, "30 laps"], ["full", "Full distance"]], (v) => (cfg.laps = v === "full" ? def().laps : +v))),
      this.field("Opponents", this.range(cfg.aiCount, 0, 19, 1, (v) => (cfg.aiCount = v))),
      this.field("AI difficulty", this.range(Math.round(cfg.difficulty * 100), 80, 103, 1, (v) => { cfg.difficulty = v / 100; G.difficulty = cfg.difficulty; }, (v) => (v < 88 ? "Easy " : v < 94 ? "Medium " : v < 99 ? "Hard " : "Expert ") + v)),
      this.field("Weather", this.select(cfg.weather, [["dry", "Dry"], ["changing", "Changing (rain may come)"], ["wet", "Wet"], ["storm", "Storm"], ["random", "Random"]], (v) => { cfg.weather = v; G.weather = v; })),
      this.field("Time of day", hourSel()),
      this.field("Rules", this.select(cfg.rules, [["arcade", "Arcade"], ["standard", "Standard"], ["sim", "Simulation"]], (v) => { cfg.rules = v; G.rules = v; }), "Simulation: manual starts, pit lane limiter, penalties and two-compound rule."),
      this.field("Damage", this.select(cfg.damage, [["off", "Off"], ["reduced", "Reduced"], ["sim", "Simulation"]], (v) => { cfg.damage = v; G.damage = v; })),
      this.field("Tyre wear", this.select(cfg.tyreWear, [[0, "Off"], [1, "Normal"], [2, "Double"], [3, "Triple"]], (v) => { cfg.tyreWear = +v; G.tyreWear = +v; })),
      this.field("Starting position", this.select(cfg.grid, [["random", "Random"], ["back", "Back of the grid"], ["front", "Pole position"]], (v) => (cfg.grid = v))),
      this.field("Safety car", this.toggleCtl(cfg.safetyCar, (v) => (cfg.safetyCar = v))),
      this.field("Team", this.select(cfg.teamId || "", [["", "Your own team"], ...TEAMS.map((t) => [t.id, t.name])], (v) => (cfg.teamId = v || null))));
    const go = h("button", { class: "btn primary big", onclick: () => { this._lastTrack = cfg.trackId; if (cfg.laps === "full") cfg.laps = def().laps; this.save(); this.app.startRace(this._raceConfig(cfg)); } }, "Start");
    const strategy = h("button", { class: "btn", onclick: () => this.push(() => this.prerace(cfg)) }, "Car setup & strategy");
    this.screen("setup", this.header(type === "race" ? "Quick Race" : "Session", "Choose a circuit and how you want to race"),
      h("div", { class: "setup-body" }, this.trackPicker(cfg.trackId, (id) => (cfg.trackId = id)), h("div", { class: "setup-side" }, opts, h("div", { class: "row" }, strategy, go))));
  }

  _raceConfig(cfg) {
    const prof = this.app.store.data.profile;
    const garage = this.app.store.data.garage;
    const setup = garage.setups[cfg.trackId] || null;
    const player = {
      name: prof ? prof.name : "You", short: prof ? prof.short : "YOU", number: prof ? prof.number : 1,
      livery: prof && prof.livery && !cfg.teamId ? prof.livery : null, teamId: cfg.teamId || null,
      teamName: cfg.teamName || (prof ? prof.teamName : null), teamShort: prof ? prof.teamShort : null,
      setup: setup ? { ...setup } : null, compound: cfg.compound || null, fuel: cfg.fuel != null ? cfg.fuel : null,
      perf: cfg.perf || null,
    };
    return { ...cfg, timeLimit: cfg.type === "race" ? 0 : cfg.timeLimit || 900, player, start: cfg.type === "race" ? "grid" : "pit" };
  }

  weekendSetup() {
    if (this.app.weekend) return this.app.weekend.setup();
    this.raceSetup("race");
  }

  timeTrialSetup() {
    const cfg = { trackId: this._lastTrack || "fiorella", type: "timetrial", ghost: this.S.gameplay.ghost, hour: null, weather: "dry" };
    const opts = h("div", { class: "setup-opts" },
      this.field("Ghost of your best lap", this.toggleCtl(cfg.ghost, (v) => { cfg.ghost = v; this.S.gameplay.ghost = v; })),
      this.field("Time of day", this.select("default", [["default", "Circuit default"], [9, "Morning"], [13, "Midday"], [19.6, "Sunset"], [22, "Night"]], (v) => (cfg.hour = v === "default" ? null : +v))),
      this.field("Conditions", this.select("dry", [["dry", "Dry"], ["wet", "Wet"]], (v) => (cfg.weather = v))),
      h("p", { class: "note" }, "Time trial runs on its own: no other cars. Your best lap is saved on this device with its ghost. Leaderboards are local to this browser — online leaderboards need a server (see Online)."));
    const go = h("button", { class: "btn primary big", onclick: () => {
      this._lastTrack = cfg.trackId;
      const g = this.app.store.data.ghosts[cfg.trackId];
      const c = this._raceConfig({ ...cfg, aiCount: 0, laps: 99, timeLimit: 0 });
      c.type = "timetrial"; c.start = "rolling"; c.timeLimit = 0; c.recordGhost = true;
      if (cfg.ghost && g) c.ghost = { frames: Float32Array.from(g.frames), time: g.time };
      this.app.startRace(c);
    } }, "Start");
    this.screen("setup", this.header("Time Trial", "Set the fastest lap you can"), h("div", { class: "setup-body" }, this.trackPicker(cfg.trackId, (id) => (cfg.trackId = id)), h("div", { class: "setup-side" }, opts, h("div", { class: "row" }, go))));
  }

  prerace(cfg) {
    if (this.app.garageUI) return this.app.garageUI.setupScreen(cfg);
    this.toast("The setup screen is still being built.");
    this.back();
  }
  career() { if (this.app.career) return this.app.career.open(); this.toast("Career mode is not available."); this.back(); }
  online() { if (this.app.onlineUI) return this.app.onlineUI.open(); this.toast("Online is still being built."); this.back(); }
  garageMenu() { if (this.app.garageUI) return this.app.garageUI.open(); this.toast("The garage is still being built."); this.back(); }
  driverMenu() { if (this.app.garageUI) return this.app.garageUI.driver(); this.toast("The driver creator is still being built."); this.back(); }
  achievements() { if (this.app.achievements) return this.app.achievements.open(); this.toast("Achievements are not available."); this.back(); }

  lapAnalysis(trackId) {
    const id = trackId || this._lastTrack || "fiorella";
    const rec = this.app.store.data.records;
    const r = rec[id + ":tt"] || rec[id];
    const other = rec[id + ":tt"] && rec[id] ? rec[id] : null;
    const def = TRACK_BY_ID[id];
    const tr = getTrack(def);
    const canvas = h("canvas", { class: "telemetry", width: 980, height: 420 });
    setTimeout(() => import("./garage-ui.js").then((m) => m.drawTelemetry(canvas, tr, r, other)), 0);
    const sec = r && r.sectors ? r.sectors.map((t, k) => h("li", {}, "Sector " + (k + 1), h("b", {}, t != null ? t.toFixed(3) : "—"))) : [];
    this.screen("records", this.header("Lap analysis", def.name),
      this.field("Circuit", this.select(id, TRACKS.map((t) => [t.id, t.name]), (v) => { this._lastTrack = v; this.lapAnalysis(v); })),
      h("div", { class: "row" }, h("b", {}, r ? "Best lap " + fmtTime(r.time) : "No lap yet"), other ? h("span", { class: "note" }, "Grey line: your best race lap") : null),
      canvas,
      sec.length ? h("ul", { class: "facts" }, sec) : null);
  }

  records() {
    const rec = this.app.store.data.records;
    const rows = TRACKS.map((d) => {
      const r = rec[d.id], tt = rec[d.id + ":tt"], g = this.app.store.data.ghosts[d.id];
      return h("tr", {}, h("td", {}, d.name), h("td", {}, r ? fmtTime(r.time) : "—"), h("td", {}, tt ? fmtTime(tt.time) : "—"), h("td", {}, g ? "Saved" : "—"));
    });
    const list = (this.app.store.data.replays || []).map((r, k) => h("li", {}, `${r.title} — ${new Date(r.date).toLocaleString()}`, " ", h("button", { class: "btn small", onclick: () => this.app.replays && this.app.replays.play(k) }, "Watch")));
    this.screen("records", this.header("Replays & Records", "Stored on this device"),
      h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", {}, "Circuit"), h("th", {}, "Best race lap"), h("th", {}, "Best time trial"), h("th", {}, "Ghost"))), h("tbody", {}, rows)),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => this.push(() => this.lapAnalysis()) }, "Lap analysis")),
      h("h3", {}, "Saved replays"), list.length ? h("ul", { class: "replay-list" }, list) : h("p", { class: "note" }, "Save a replay from the results screen after a race."));
  }

  // ---------- settings ----------
  settings(tab = "graphics") {
    const S = this.S, app = this.app;
    const tabs = [["graphics", "Graphics"], ["audio", "Sound"], ["gameplay", "Gameplay"], ["assists", "Assists"], ["hud", "HUD"], ["access", "Accessibility"], ["data", "Saved data"]];
    const body = h("div", { class: "set-body" });
    const save = () => { this.save(); if (app.race && app.race.hud) app.race.hud.applySettings(S.hud); if (app.audio) app.audio.apply(S.audio); };
    const F = (label, ctl, help) => this.field(label, ctl, help);
    const sel = (obj, key, options, after) => this.select(obj[key], options, (v) => { obj[key] = isNaN(+v) || v === "" ? (v === "true" ? true : v === "false" ? false : v) : +v; save(); after && after(obj[key]); });
    const rng = (obj, key, min, max, step, fmt) => this.range(obj[key], min, max, step, (v) => { obj[key] = v; save(); }, fmt);
    const tog = (obj, key, after) => this.toggleCtl(obj[key] !== false && !!obj[key], (v) => { obj[key] = v; save(); after && after(v); });
    const pct = (v) => Math.round(v * 100) + "%";
    const sections = {
      graphics: () => [
        F("Quality", this.select(S.graphics.quality, [["auto", "Automatic"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["ultra", "Ultra"]], (v) => { app.setQuality(v); this.toast("Graphics: " + (QUALITY[app.qualityId] || {}).name + (app.race ? " (restart the session for the full change)" : "")); }), "Low works on most laptops and phones. Ultra needs a strong graphics card."),
        F("Automatic resolution", tog(S.graphics, "autoScale", (v) => (app.graphics.settings.autoScale = v)), "Lowers the resolution a little when the frame rate drops."),
        F("Target frame rate", sel(S.graphics, "targetFps", [[30, "30"], [60, "60"], [120, "120"]], (v) => (app.graphics.settings.targetFps = v))),
        F("Field of view (outside)", rng(S.graphics, "fov", 50, 80, 1)),
        F("Field of view (cockpit)", rng(S.graphics, "cockpitFov", 55, 100, 1)),
        F("Live mirrors in the cockpit", tog(S.graphics, "mirrors")),
        F("Rear-view mirror on the HUD", tog(S.graphics, "hudMirror")),
        F("Show frame rate", tog(S.graphics, "showFps")),
      ],
      audio: () => [
        F("Master volume", rng(S.audio, "master", 0, 1, 0.05, pct)), F("Engines", rng(S.audio, "engine", 0, 1, 0.05, pct)), F("Effects", rng(S.audio, "effects", 0, 1, 0.05, pct)),
        F("Crowd and ambience", rng(S.audio, "ambience", 0, 1, 0.05, pct)), F("Team radio", rng(S.audio, "radio", 0, 1, 0.05, pct)), F("Commentary", rng(S.audio, "commentary", 0, 1, 0.05, pct)),
        F("Spoken radio (text-to-speech)", tog(S.audio, "voice"), "Uses your browser's built-in voices."), F("Subtitles", tog(S.audio, "subtitles")), F("Commentary on", tog(S.audio, "commentaryOn")),
      ],
      gameplay: () => [
        F("Default rules", sel(S.gameplay, "rules", [["arcade", "Arcade"], ["standard", "Standard"], ["sim", "Simulation"]])),
        F("Damage", sel(S.gameplay, "damage", [["off", "Off"], ["reduced", "Reduced"], ["sim", "Simulation"]])),
        F("Default camera", sel(S.gameplay, "camera", [["chase", "Chase"], ["far", "Far chase"], ["cockpit", "Cockpit"], ["helmet", "Helmet"], ["tcam", "T-cam"]])),
        F("Speed units", sel(S.hud, "units", [["kmh", "km/h"], ["mph", "mph"]])),
        F("Fuel use", sel(S.gameplay, "fuelUse", [[0, "Off"], [1, "Normal"], [2, "Double"]])),
      ],
      assists: () => [
        F("Automatic gears", tog(S.assists, "autoGear")), F("Anti-lock brakes", tog(S.assists, "abs")),
        F("Traction control", sel(S.assists, "tc", [[0, "Off"], [1, "Medium"], [2, "Full"]])), F("Stability help", tog(S.assists, "stability"), "Gently catches slides."),
        F("Automatic pit lane", tog(S.assists, "autoPit"), "Drives you down the pit lane (always on outside Simulation rules)."),
        F("Keyboard steering speed", rng(S.controls, "kbSteerRate", 1.5, 6, 0.1)), F("Keyboard speed sensitivity", rng(S.controls, "kbSpeedSens", 0, 1, 0.05, pct), "Less steering at high speed so keyboard players can be smooth."),
      ],
      hud: () => [
        F("Show HUD", tog(S.hud, "show")), F("HUD size", rng(S.hud, "scale", 0.7, 1.4, 0.05, pct)), F("HUD opacity", rng(S.hud, "opacity", 0.4, 1, 0.05, pct)),
        F("Timing tower", tog(S.hud, "tower")), F("Track map", tog(S.hud, "map")), F("Tyres and car panel", tog(S.hud, "tyres")), F("Pedal bars", tog(S.hud, "inputs")), F("Live delta", tog(S.hud, "delta")), F("Mirror", tog(S.hud, "mirror")),
        F("Gaps in the tower", sel(S.hud, "towerMode", [["interval", "To the car ahead"], ["leader", "To the leader"]])),
      ],
      access: () => [
        F("Colour-blind friendly colours", sel(S.accessibility, "colourblind", [["off", "Off"], ["deuteranopia", "Red-green"], ["tritanopia", "Blue-yellow"]], (v) => document.documentElement.dataset.cb = v)),
        F("High contrast HUD", tog(S.accessibility, "highContrast", (v) => document.documentElement.classList.toggle("hc", v))),
        F("Larger text", tog(S.accessibility, "largeText", (v) => document.documentElement.classList.toggle("lt", v))),
        F("Reduce motion", tog(S.accessibility, "reduceMotion"), "Less camera shake and head movement."),
        F("Camera shake", rng(S.accessibility, "shakeAmount", 0, 1, 0.1, pct)),
        F("Flashing lights", tog(S.accessibility, "flashes"), "Turn off to stop blinking shift lights and flag panels."),
      ],
      data: () => [
        h("p", { class: "note" }, "Everything is saved in this browser. Export a backup code to move it to another device."),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => { const t = app.store.exportAll(); navigator.clipboard && navigator.clipboard.writeText(t).then(() => this.toast("Backup code copied"), () => {}); this._showText("Backup code", t); } }, "Export backup"),
          h("button", { class: "btn", onclick: () => { const t = prompt("Paste a backup code"); if (t) try { app.store.importAll(t); this.toast("Backup restored"); } catch (e) { this.toast("That code did not work: " + e.message); } } }, "Import backup"),
          h("button", { class: "btn danger", onclick: () => { if (confirm("Delete all saved data, records and career progress?")) { app.store.reset(); this.toast("Saved data cleared"); this.settings("data"); } } }, "Delete everything")),
        F("Debug overlay", tog(app.store.data.settings, "debug", (v) => app.toggleDebug && app.toggleDebug(v)), "Shows physics, AI and performance data while driving."),
      ],
    };
    const nav = h("div", { class: "tabs" }, tabs.map(([id, t]) => h("button", { class: "tab" + (id === tab ? " on" : ""), onclick: () => this.settings(id) }, t)));
    body.append(...sections[tab]());
    this.screen("settings", this.header("Settings"), nav, body);
  }
  _showText(title, text) {
    const ta = h("textarea", { readonly: true, rows: 6 }, text);
    const el = h("div", { class: "modal" }, h("div", { class: "modal-box" }, h("h3", {}, title), ta, h("button", { class: "btn", onclick: () => el.remove() }, "Close")));
    this.root.appendChild(el); ta.select();
  }

  // ---------- controls ----------
  controls() {
    const S = this.S, inp = this.app.input;
    const keys = S.controls.keys;
    const rows = ACTIONS.map(([id, label]) => {
      const cur = (keys[id] || DEFAULT_KEYS[id] || []);
      const btn = h("button", { class: "btn small keybtn", onclick: () => {
        btn.textContent = "Press a key…";
        inp.listening = (code) => { if (code !== "Escape") { keys[id] = [code]; this.save(); } this.controls(); };
      } }, cur.map(keyName).join(" / ") || "—");
      return h("tr", {}, h("td", {}, label), h("td", {}, btn));
    });
    const pad = inp.padName();
    const W = S.controls.wheel;
    const wheelBox = h("div", { class: "wheel-box" },
      this.field("Use a steering wheel", this.toggleCtl(W.enabled, (v) => { W.enabled = v; this.save(); })),
      this.field("Wheel rotation (degrees)", this.range(W.rotation, 180, 1080, 10, (v) => { W.rotation = v; this.save(); })),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => this._calibrate("steer") }, "Calibrate steering"),
        h("button", { class: "btn", onclick: () => this._calibrate("throttle") }, "Calibrate throttle"),
        h("button", { class: "btn", onclick: () => this._calibrate("brake") }, "Calibrate brake")),
      this._calStatus = h("p", { class: "note" }, "Wheels and pedals appear to the browser as game controllers. Force feedback is not available to web pages; controllers that support rumble will vibrate."));
    this.screen("controls", this.header("Controls", pad ? "Connected: " + pad : "No gamepad or wheel detected — press a button on it to wake it up"),
      h("div", { class: "cols" },
        h("div", {}, h("h3", {}, "Keyboard"), h("table", { class: "table keys" }, h("tbody", {}, rows)), h("button", { class: "btn", onclick: () => { S.controls.keys = {}; this.save(); this.controls(); } }, "Reset keys")),
        h("div", {}, h("h3", {}, "Gamepad"),
          this.field("Steering dead zone", this.range(S.controls.padDeadzone, 0, 0.3, 0.01, (v) => { S.controls.padDeadzone = v; this.save(); })),
          this.field("Steering linearity", this.range(S.controls.padLinearity, 1, 3, 0.1, (v) => { S.controls.padLinearity = v; this.save(); }), "Higher = finer control near the centre."),
          this.field("Speed sensitivity", this.range(S.controls.padSpeedSens, 0, 1, 0.05, (v) => { S.controls.padSpeedSens = v; this.save(); })),
          this.field("Vibration", this.toggleCtl(S.controls.rumble, (v) => { S.controls.rumble = v; this.save(); })),
          h("p", { class: "note" }, "Default gamepad: left stick steer, right trigger throttle, left trigger brake, bumpers shift, A = DRS, X = ERS overtake, Y = camera, B = look back, Start = pause, View = reset."),
          h("h3", {}, "Steering wheel"), wheelBox)));
  }
  _calibrate(what) {
    const inp = this.app.input, W = this.S.controls.wheel;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (!pads.length) { this._calStatus.textContent = "No wheel found. Plug it in and press a button, then try again."; return; }
    const pad = pads[0];
    const base = pad.axes.slice();
    this._calStatus.textContent = what === "steer" ? "Turn the wheel fully to the right…" : `Press the ${what} pedal all the way…`;
    const t0 = performance.now();
    const poll = () => {
      const p = [...navigator.getGamepads()].filter(Boolean)[0];
      if (!p) return;
      let best = -1, bd = 0;
      p.axes.forEach((v, i) => { const d = Math.abs(v - base[i]); if (d > bd) { bd = d; best = i; } });
      if (bd > 0.6) {
        if (what === "steer") { W.steerAxis = best; W.steerInvert = p.axes[best] < base[best]; W.steerCentre = 0; }
        else W[what] = { axis: best, min: base[best], max: p.axes[best] };
        this.save();
        this._calStatus.textContent = `Done: ${what} is axis ${best}.`;
        return;
      }
      if (performance.now() - t0 < 8000) requestAnimationFrame(poll); else this._calStatus.textContent = "Nothing moved. Try again.";
    };
    requestAnimationFrame(poll);
  }

  help() {
    this.screen("help", this.header("Help"),
      h("div", { class: "help" },
        h("h3", {}, "Driving"),
        h("p", {}, "W / S throttle and brake, A / D steer. Brake before the corner, turn in, then feed the throttle in as you straighten up. The car is faster when the tyres are in their temperature window — green on the tyre panel."),
        h("p", {}, "Q / E change gear (when automatic gears are off). Space opens DRS in a DRS zone when it is lit. Hold Left Shift for an ERS boost. R puts you back on the track (with a short penalty). C changes the camera, V looks back, Esc pauses."),
        h("p", {}, "In Simulation rules the start is manual: hold Space (the clutch) and the throttle, and let go of Space when the lights go out. In the pit lane press L for the speed limiter."),
        h("h3", {}, "Race rules"),
        h("p", {}, "Five red lights come on one by one; when they all go out, go. Yellow flags: no overtaking in that sector. Safety car and virtual safety car: slow down, no overtaking. Blue flags: let the leaders through. Track limits: keep at least one wheel on the track — warnings turn into a 5 second penalty."),
        h("h3", {}, "About"),
        h("p", {}, "CLANKO GP is an original game made by clanko for CLANKO100.COM. Teams, drivers, circuits and liveries are fictional. Built with three.js (MIT licence). No real-world series, team or driver is represented or endorsed.")));
  }

  // ---------- in race ----------
  pauseMenu(rc) {
    const S = rc.session;
    this.screen("pause",
      h("div", { class: "pause-box" },
        h("h2", {}, "Paused"),
        h("p", {}, `${rc.track.def.name} · ${S.isRace ? `Lap ${Math.max(1, rc.player.lap + 1)}/${S.laps}` : S.type} · P${rc.player.position}`),
        h("nav", { class: "menu" },
          h("button", { class: "menu-item", onclick: () => this.app.resume() }, h("b", {}, "Resume")),
          h("button", { class: "menu-item", onclick: () => { rc.restart(); } }, h("b", {}, "Restart")),
          h("button", { class: "menu-item", onclick: () => this.pauseSub(rc, () => this.settings()) }, h("b", {}, "Settings")),
          h("button", { class: "menu-item", onclick: () => this.pauseSub(rc, () => this.controls()) }, h("b", {}, "Controls")),
          h("button", { class: "menu-item", onclick: () => this.app.quitRace() }, h("b", {}, "Quit to menu")))));
  }
  pauseSub(rc, fn) { this.stack = [() => this.pauseMenu(rc)]; this.push(fn); }

  results(rc) {
    const S = rc.session, res = S.results();
    const me = res.find((r) => r.isPlayer);
    this.app.onResults && this.app.onResults(rc, res);
    const rows = res.map((r) => h("tr", { class: r.isPlayer ? "me" : "" },
      h("td", {}, r.dq ? "DSQ" : r.status === "DNF" ? "DNF" : String(r.position)), h("td", {}, h("i", { class: "tc", style: { background: r.color } }), " ", r.name), h("td", {}, r.team),
      h("td", {}, S.isRace ? (r.status === "DNF" ? (r.dnf || "Out") : r.position === 1 && r.time != null ? fmtTime(r.time) : r.lapsDown > 0 ? `+${r.lapsDown} lap${r.lapsDown > 1 ? "s" : ""}` : r.time != null && res[0].time != null ? "+" + (r.time - res[0].time).toFixed(3) : "") : r.bestLap ? fmtTime(r.bestLap) : "—"),
      h("td", {}, r.bestLap ? fmtTime(r.bestLap) : "—", r.fastest ? " ★" : ""), h("td", {}, String(r.stops)), h("td", {}, r.penalty ? `+${r.penalty}s` : ""), h("td", {}, S.isRace ? String(r.points) : "")));
    const podium = S.isRace && me && me.position <= 3 && me.status === "Finished";
    this.screen("results",
      h("div", { class: "res-box" },
        h("h2", {}, S.isRace ? "Race result" : "Session result", " — ", rc.track.def.name),
        me ? h("p", { class: "res-me" + (podium ? " podium" : "") }, me.status === "DNF" ? "Did not finish" : `You finished P${me.position}` + (S.isRace ? ` · ${me.points} points` : "") + (me.bestLap ? ` · best lap ${fmtTime(me.bestLap)}` : "")) : null,
        h("table", { class: "table results" }, h("thead", {}, h("tr", {}, ["Pos", "Driver", "Team", S.isRace ? "Time" : "Best", "Best lap", "Stops", "Pen.", S.isRace ? "Pts" : ""].map((t) => h("th", {}, t)))), h("tbody", {}, rows)),
        h("div", { class: "row" },
          rc.net && rc.net.isHost ? h("button", { class: "btn primary", onclick: () => { rc.net.sendRestart(rc.cfg); rc.restart(); } }, "Rematch") : null,
          rc.net && !rc.net.isHost ? h("span", { class: "note" }, "The host can start a rematch.") : null,
          this.app.replays ? h("button", { class: "btn", onclick: () => this.app.replays.watch(rc) }, "Watch replay") : null,
          this.app.replays ? h("button", { class: "btn", onclick: () => { this.app.replays.save(rc); this.toast("Replay saved"); } }, "Save replay") : null,
          h("button", { class: "btn", onclick: () => rc.restart() }, "Race again"),
          h("button", { class: "btn primary", onclick: () => (this.app.afterResults ? this.app.afterResults(rc, res) : this.app.quitRace()) }, "Continue"))));
  }

  radioMenu(rc) {
    const e = rc.player, S = rc.session;
    const close = () => { this.hideAll(); rc._radioOpen = false; };
    if (rc._radioOpen) return close();
    rc._radioOpen = true;
    const pick = (fn) => () => { fn(); close(); };
    const comps = ["soft", "medium", "hard", "inter", "wet"];
    const el = h("div", { class: "radio-menu" }, h("h3", {}, "Team radio"),
      h("div", { class: "radio-group" }, h("small", {}, "Box this lap for"), comps.map((c, k) => h("button", { class: "btn small", style: { borderColor: COMPOUNDS[c].color }, onclick: pick(() => rc.cmd("pit", { tyres: c, wing: e.car.damage.fwL > 0.2 || e.car.damage.fwR > 0.2 })) }, `${k + 1} ${COMPOUNDS[c].name}`))),
      h("div", { class: "radio-group" }, h("button", { class: "btn small", onclick: pick(() => rc.cmd("cancelPit")) }, "Cancel the stop"),
        h("button", { class: "btn small", onclick: pick(() => rc.radio.answer("tyres", e, S)) }, "How are the tyres?"),
        h("button", { class: "btn small", onclick: pick(() => rc.radio.answer("gap", e, S)) }, "What are the gaps?"),
        h("button", { class: "btn small", onclick: pick(() => rc.radio.answer("weather", e, S)) }, "Weather update"),
        h("button", { class: "btn small", onclick: pick(() => rc.radio.answer("fuel", e, S)) }, "Fuel check")),
      h("small", { class: "note" }, "T to close"));
    clear(this.root); this.root.appendChild(el); this.root.classList.add("on", "overlay-only");
    const onKey = (ev) => { const n = +ev.key; if (n >= 1 && n <= 5) { S.command(e.id, "pit", { tyres: comps[n - 1] }); close(); window.removeEventListener("keydown", onKey); } if (!rc._radioOpen) window.removeEventListener("keydown", onKey); };
    window.addEventListener("keydown", onKey);
  }

  mfd(rc) {
    const e = rc.player, S = rc.session, c = e.car;
    if (rc._mfdOpen) { rc._mfdOpen = false; this.hideAll(); return; }
    rc._mfdOpen = true;
    const render = () => {
      const el = h("div", { class: "radio-menu mfd" }, h("h3", {}, "Car settings"),
        h("div", { class: "radio-group" }, h("small", {}, "ERS deployment"), ERS_MODES.slice(0, 3).map((m, k) => h("button", { class: "btn small" + (c.ersMode === k ? " on" : ""), onclick: () => { rc.cmd("ersMode", k); render(); } }, m.name))),
        h("div", { class: "radio-group" }, h("small", {}, "Fuel mix"), FUEL_MIXES.map((m, k) => h("button", { class: "btn small" + (c.fuelMix === k ? " on" : ""), onclick: () => { rc.cmd("mix", k); render(); } }, m.name))),
        h("div", { class: "radio-group" }, h("small", {}, `Brake bias ${c.setup.brakeBias}%`), h("button", { class: "btn small", onclick: () => { rc.cmd("bias", -1); render(); } }, "− rearward"), h("button", { class: "btn small", onclick: () => { rc.cmd("bias", 1); render(); } }, "+ forward")),
        h("small", { class: "note" }, "F to close"));
      clear(this.root); this.root.appendChild(el); this.root.classList.add("on", "overlay-only");
    };
    render();
  }
}

const TIPS = [
  "Brake in a straight line, then release the brake as you turn in.",
  "Tyres grip best in their temperature window — green on the tyre panel.",
  "DRS opens the rear wing on the straights when you are within a second of the car ahead.",
  "In the rain, intermediates work on a damp track and full wets in standing water.",
  "Kerbs are fine to use, but bouncing over them unsettles the car.",
  "Press R if you get stuck — it costs a few seconds.",
  "Hold Left Shift for an ERS boost when you need to overtake.",
  "A dry line forms where cars drive — stay on it when the track is drying.",
];
