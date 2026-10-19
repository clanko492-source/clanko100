// CLANKO GP — garage screens: driver creator, livery designer, car setup and strategy.
// Every change shows on the 3D car behind the menu, and setup changes feed the real physics.

import { h, clear } from "./dom.js";
import { SETUP_RANGES, defaultSetup, trackSetup, COMPOUNDS, COMPOUND_LIST, CAR_CLASSES } from "../core/car-specs.js";
import { PATTERNS, defaultLivery } from "../render/car-model.js";
import { TRACK_BY_ID, TRACKS } from "../core/tracks-data.js";
import { Track, getTrack } from "../core/track.js";
import { NATIONS, TEAMS } from "../core/teams.js";
import { clamp, fmtTime } from "../core/math.js";
import { trackThumb } from "./menu.js";

const FINISHES = [["gloss", "Gloss"], ["matte", "Matte"], ["metallic", "Metallic"]];

/** how a setup change feels, in plain words */
const SETUP_EFFECT = {
  frontWing: (v, s) => (v > s.rearWing + 1 ? "Sharp turn-in, the rear may feel loose." : v < s.rearWing - 1 ? "Safe and stable, but it will understeer." : "Balanced."),
  rearWing: (v) => (v >= 9 ? "Lots of rear grip, slow on the straights." : v <= 3 ? "Fast on the straights, nervous in fast corners." : "Balanced."),
  brakeBias: (v) => (v >= 62 ? "Very stable braking, the fronts will lock." : v <= 54 ? "Sharp into corners, the rear may step out." : "Neutral braking."),
  diffOn: (v) => (v >= 90 ? "Strong traction out of corners, more understeer." : v <= 60 ? "Turns well on throttle, less traction." : "Balanced."),
  arbFront: (v, s) => (v > s.arbRear + 2 ? "More understeer, calmer in quick changes of direction." : "More rotation."),
  fuel: (v) => `About ${(v / 1.6).toFixed(0)} km of running.`,
};

export class GarageUI {
  constructor(app) { this.app = app; this.ui = app.ui; }
  get store() { return this.app.store; }
  get garage() { return this.app.garage; }

  // ---------------- main garage ----------------
  open() {
    const d = this.store.data;
    const prof = d.profile;
    this.garage && this.garage.focus("wide");
    this.ui.screen("garage", this.ui.header("Garage", "Your car, your driver, your setup"),
      h("div", { class: "garage-cols" },
        h("nav", { class: "menu" },
          h("button", { class: "menu-item", onclick: () => this.ui.push(() => this.livery()) }, h("b", {}, "Livery designer"), h("small", {}, "Colours, patterns, numbers and finishes")),
          h("button", { class: "menu-item", onclick: () => this.ui.push(() => this.liveryList()) }, h("b", {}, "Saved liveries"), h("small", {}, `${(d.garage.liveries || []).length} saved · import and export codes`)),
          h("button", { class: "menu-item", onclick: () => this.ui.push(() => this.driver()) }, h("b", {}, "Driver"), h("small", {}, prof ? `${prof.name} · #${prof.number} · ${prof.nat}` : "Create your driver")),
          h("button", { class: "menu-item", onclick: () => this.ui.push(() => this.setupScreen(null)) }, h("b", {}, "Car setup"), h("small", {}, "Wings, differential, brakes, tyres and fuel")),
          h("button", { class: "menu-item", onclick: () => this.ui.push(() => this.trackGuide()) }, h("b", {}, "Track guide"), h("small", {}, "Corner by corner, with your records"))),
        h("div", { class: "stats-card" }, h("h3", {}, "Career statistics"), this.statsTable(),
          h("p", { class: "note" }, "Everything here is saved on this device and used in every race."))));
  }

  // ---------------- driver ----------------
  driver() {
    const d = this.store.data;
    const p = (d.profile = d.profile || { name: "Clanko", short: "CLK", number: 7, nat: "GBR", teamName: "Clanko Racing", teamShort: "CLK", livery: defaultLivery(), helmet: { base: "#ffd23a", stripe: "#17181c" }, bio: "", created: Date.now() });
    p.livery = p.livery || defaultLivery();
    const save = () => { p.livery.helmet = p.helmet; this.store.save(); this.garage && this.garage.setLivery(p.livery); };
    const text = (key, label, max = 20, up = false) => this.ui.field(label, h("input", { type: "text", value: p[key] || "", maxlength: max, oninput: (e) => { p[key] = up ? e.target.value.toUpperCase() : e.target.value; save(); } }));
    const colour = (obj, key, label) => this.ui.field(label, h("input", { type: "color", value: obj[key], oninput: (e) => { obj[key] = e.target.value; save(); } }));
    this.garage && this.garage.focus("cockpit");
    this.ui.screen("garage", this.ui.header("Driver", "Your racing identity"),
      h("div", { class: "garage-cols" },
        h("div", { class: "setup-opts" },
          text("name", "Name", 22),
          this.ui.field("Three-letter code", h("input", { type: "text", value: p.short, maxlength: 3, oninput: (e) => { p.short = e.target.value.toUpperCase().slice(0, 3); save(); } })),
          this.ui.field("Racing number", h("input", { type: "number", min: 1, max: 99, value: p.number, oninput: (e) => { p.number = clamp(+e.target.value || 1, 1, 99); p.livery.number = p.number; save(); } })),
          this.ui.field("Nationality", this.ui.select(p.nat, NATIONS.map((n) => [n, n]), (v) => { p.nat = v; save(); })),
          text("teamName", "Team name", 24),
          this.ui.field("Team code", h("input", { type: "text", value: p.teamShort || "", maxlength: 3, oninput: (e) => { p.teamShort = e.target.value.toUpperCase().slice(0, 3); save(); } })),
          colour(p.helmet, "base", "Helmet colour"),
          colour(p.helmet, "stripe", "Helmet stripe"),
          this.ui.field("Short biography", h("textarea", { rows: 3, maxlength: 240, oninput: (e) => { p.bio = e.target.value; save(); } }, p.bio || "")),
          h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => { save(); this.ui.toast("Driver saved"); this.ui.back(); } }, "Save"))),
        h("div", { class: "stats-card" }, h("h3", {}, "Career statistics"), this.statsTable())));
  }
  statsTable() {
    const s = this.store.data.stats;
    const rows = [["Races", s.races], ["Wins", s.wins], ["Podiums", s.podiums], ["Pole positions", s.poles], ["Laps completed", s.laps], ["Distance", (s.km || 0).toFixed(0) + " km"]];
    return h("table", { class: "table" }, h("tbody", {}, rows.map(([k, v]) => h("tr", {}, h("td", {}, k), h("td", {}, String(v))))));
  }

  // ---------------- livery ----------------
  livery(target) {
    const d = this.store.data;
    d.profile = d.profile || { name: "Clanko", short: "CLK", number: 7, nat: "GBR", teamName: "Clanko Racing", livery: defaultLivery(), helmet: { base: "#ffd23a", stripe: "#17181c" } };
    const L = target || (d.profile.livery = d.profile.livery || defaultLivery());
    const apply = () => { this.store.save(); this.garage && this.garage.setLivery(L); };
    apply();
    const colour = (key, label) => this.ui.field(label, h("input", { type: "color", value: L[key], oninput: (e) => { L[key] = e.target.value; apply(); } }));
    const view = (mode) => h("button", { class: "btn small", onclick: () => this.garage && this.garage.focus(mode) }, mode[0].toUpperCase() + mode.slice(1));
    this.garage && this.garage.focus("wide");
    this.ui.screen("garage", this.ui.header("Livery designer", "Original designs only — no real team branding"),
      h("div", { class: "garage-cols" },
        h("div", { class: "setup-opts" },
          colour("base", "Base colour"), colour("secondary", "Second colour"), colour("accent", "Accent colour"), colour("wing", "Wing colour"),
          this.ui.field("Pattern", this.ui.select(L.pattern, PATTERNS.map((p) => [p, p[0].toUpperCase() + p.slice(1)]), (v) => { L.pattern = v; apply(); })),
          this.ui.field("Finish", this.ui.select(L.finish, FINISHES, (v) => { L.finish = v; apply(); })),
          this.ui.field("Racing number", h("input", { type: "number", min: 1, max: 99, value: L.number, oninput: (e) => { L.number = clamp(+e.target.value || 1, 1, 99); apply(); } })),
          this.ui.field("Team text", h("input", { type: "text", value: L.name, maxlength: 10, oninput: (e) => { L.name = e.target.value.toUpperCase(); apply(); } })),
          this.ui.field("Sponsor text", h("input", { type: "text", value: L.sponsor, maxlength: 12, oninput: (e) => { L.sponsor = e.target.value.toUpperCase(); apply(); } }), "Use your own or invented names — not real brands."),
          h("div", { class: "row" }, h("span", { class: "note" }, "Camera:"), view("wide"), view("front"), view("rear"), view("cockpit"),
            h("button", { class: "btn small", onclick: () => { this.garage.spin = !this.garage.spin; } }, "Spin on/off")),
          h("div", { class: "row" },
            h("button", { class: "btn primary", onclick: () => { this.saveLivery(L); } }, "Save to my liveries"),
            h("button", { class: "btn", onclick: () => { const code = this.exportLivery(L); this.ui._showText("Livery share code", code); } }, "Export code"),
            h("button", { class: "btn", onclick: () => { const t = prompt("Paste a livery code"); if (t) this.importLivery(t); } }, "Import code"),
            h("button", { class: "btn", onclick: () => { Object.assign(L, defaultLivery()); apply(); this.livery(target); } }, "Reset")))));
  }
  exportLivery(L) { return "CGPL1:" + btoa(JSON.stringify([L.base, L.secondary, L.accent, L.wing, L.pattern, L.finish, L.number, L.name, L.sponsor, L.helmet && L.helmet.base, L.helmet && L.helmet.stripe])); }
  importLivery(code) {
    try {
      if (!code.startsWith("CGPL1:")) throw new Error("not a livery code");
      const a = JSON.parse(atob(code.slice(6)));
      if (!Array.isArray(a) || a.length < 9) throw new Error("code is incomplete");
      const hex = (v, f) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : f);
      const L = { base: hex(a[0], "#d01f2f"), secondary: hex(a[1], "#f4f4f4"), accent: hex(a[2], "#ffd23a"), wing: hex(a[3], "#151515"),
        pattern: PATTERNS.includes(a[4]) ? a[4] : "stripes", finish: ["gloss", "matte", "metallic"].includes(a[5]) ? a[5] : "gloss",
        number: clamp(+a[6] || 1, 1, 99), name: String(a[7] || "CLANKO").slice(0, 10), sponsor: String(a[8] || "").slice(0, 12),
        helmet: { base: hex(a[9], "#ffd23a"), stripe: hex(a[10], "#111") } };
      this.saveLivery(L, true);
      this.ui.toast("Livery imported");
      this.liveryList();
    } catch (e) { this.ui.toast("That code did not work: " + e.message); }
  }
  saveLivery(L, silent) {
    const g = this.store.data.garage;
    g.liveries = g.liveries || [];
    const copy = JSON.parse(JSON.stringify(L));
    copy.id = "L" + Date.now().toString(36);
    copy.title = copy.title || `${copy.name || "Design"} ${g.liveries.length + 1}`;
    g.liveries.push(copy);
    this.store.save();
    if (!silent) this.ui.toast("Livery saved");
  }
  liveryList() {
    const g = this.store.data.garage;
    g.liveries = g.liveries || [];
    const rows = g.liveries.map((L, i) => h("div", { class: "livery-row" },
      h("i", { style: { background: `linear-gradient(135deg, ${L.base} 0 40%, ${L.secondary} 40% 70%, ${L.accent} 70%)` } }),
      h("b", {}, L.title), h("small", {}, `#${L.number} · ${L.pattern} · ${L.finish}`),
      h("div", { class: "row" },
        h("button", { class: "btn small", onclick: () => { this.garage && this.garage.setLivery(L); } }, "Preview"),
        h("button", { class: "btn small", onclick: () => { this.store.data.profile.livery = JSON.parse(JSON.stringify(L)); this.store.save(); this.garage.setLivery(L); this.ui.toast("Now racing in this livery"); } }, "Use"),
        h("button", { class: "btn small", onclick: () => { const t = prompt("New name", L.title); if (t) { L.title = t.slice(0, 24); this.store.save(); this.liveryList(); } } }, "Rename"),
        h("button", { class: "btn small", onclick: () => { const c = JSON.parse(JSON.stringify(L)); c.id = "L" + Date.now().toString(36); c.title = L.title + " copy"; g.liveries.push(c); this.store.save(); this.liveryList(); } }, "Duplicate"),
        h("button", { class: "btn small", onclick: () => { this.ui._showText("Livery share code", this.exportLivery(L)); } }, "Share"),
        h("button", { class: "btn small danger", onclick: () => { if (confirm("Delete this livery?")) { g.liveries.splice(i, 1); this.store.save(); this.liveryList(); } } }, "Delete"))));
    this.ui.screen("garage", this.ui.header("Saved liveries", "Design, duplicate, share"),
      h("div", { class: "livery-list" }, rows.length ? rows : h("p", { class: "note" }, "No saved liveries yet. Design one and press Save."),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => this.ui.push(() => this.livery()) }, "New design"),
          h("button", { class: "btn", onclick: () => { const t = prompt("Paste a livery code"); if (t) this.importLivery(t); } }, "Import code"))));
  }

  // ---------------- setup ----------------
  setupScreen(cfg) {
    const trackId = (cfg && cfg.trackId) || this._lastSetupTrack || "fiorella";
    this._lastSetupTrack = trackId;
    const g = this.store.data.garage;
    g.setups = g.setups || {};
    const base = g.setups[trackId] || trackSetup(getTrack(TRACK_BY_ID[trackId]));
    const S = (this._setup = { ...defaultSetup(), ...base });
    const save = () => { g.setups[trackId] = { ...S }; this.store.save(); this.updateSummary(); };
    const groups = {
      "Aerodynamics": ["frontWing", "rearWing"],
      "Transmission": ["diffOn", "diffOff", "finalDrive"],
      "Suspension": ["arbFront", "arbRear", "rideFront", "rideRear", "camberFront", "camberRear"],
      "Brakes": ["brakeBias", "brakePressure"],
      "Tyres and fuel": ["pressFront", "pressRear", "fuel"],
    };
    const body = h("div", { class: "setup-grid" });
    for (const [title, keys] of Object.entries(groups)) {
      const box = h("div", { class: "setup-group" }, h("h4", {}, title));
      for (const k of keys) {
        const r = SETUP_RANGES[k];
        const out = h("output", {}, String(S[k]));
        const fx = h("small", { class: "fx" }, SETUP_EFFECT[k] ? SETUP_EFFECT[k](S[k], S) : "");
        const inp = h("input", { type: "range", min: r.min, max: r.max, step: r.step, value: S[k], oninput: () => { S[k] = +inp.value; out.textContent = String(S[k]); if (SETUP_EFFECT[k]) fx.textContent = SETUP_EFFECT[k](S[k], S); save(); } });
        box.appendChild(h("label", { class: "setup-row" }, h("span", {}, r.name), h("div", { class: "range" }, inp, out), h("small", {}, r.help), fx));
      }
      body.appendChild(box);
    }
    this.summaryEl = h("div", { class: "setup-summary" });
    const presets = h("div", { class: "row" },
      h("button", { class: "btn small", onclick: () => { Object.assign(S, trackSetup(getTrack(TRACK_BY_ID[trackId]))); save(); this.setupScreen(cfg); } }, "Track default"),
      h("button", { class: "btn small", onclick: () => { Object.assign(S, defaultSetup(), { frontWing: 9, rearWing: 9, diffOn: 85, brakeBias: 59 }); save(); this.setupScreen(cfg); } }, "High downforce"),
      h("button", { class: "btn small", onclick: () => { Object.assign(S, defaultSetup(), { frontWing: 3, rearWing: 2, finalDrive: 9, brakeBias: 56 }); save(); this.setupScreen(cfg); } }, "Low drag"),
      h("button", { class: "btn small", onclick: () => { Object.assign(S, defaultSetup(), { frontWing: 7, rearWing: 8, pressFront: 22, pressRear: 20.5, brakeBias: 60, diffOn: 65 }); save(); this.setupScreen(cfg); } }, "Wet"));
    const strat = cfg ? this.strategyBox(cfg) : null;
    this.ui.screen("garage setup-screen", this.ui.header("Car setup", `${TRACK_BY_ID[trackId].name} — saved for this circuit`),
      h("div", { class: "row" }, this.ui.field("Circuit", this.ui.select(trackId, TRACKS.map((t) => [t.id, t.name]), (v) => { this._lastSetupTrack = v; if (cfg) cfg.trackId = v; this.setupScreen(cfg); })), presets),
      body, this.summaryEl, strat,
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => { save(); if (cfg) { this.ui.back(); } else { this.ui.toast("Setup saved"); this.ui.back(); } } }, cfg ? "Done" : "Save setup")));
    this.updateSummary();
  }
  updateSummary() {
    if (!this.summaryEl) return;
    const S = this._setup, c = CAR_CLASSES.gp;
    const clA = c.clBase * (1 - (S.rideFront - 4) * 0.022 - (S.rideRear - 5) * 0.018) + (c.clFront0 + S.frontWing * c.clFrontPerStep) + (c.clRear0 + S.rearWing * c.clRearPerStep);
    const cdA = c.cdBase + S.frontWing * c.cdFrontPerStep + S.rearWing * c.cdRearPerStep;
    const top = Math.cbrt((c.power * c.drivetrain) / (0.5 * 1.225 * cdA)) * 3.6;
    const balance = (S.frontWing * c.clFrontPerStep + c.clFront0) / clA;
    clear(this.summaryEl).append(
      h("div", {}, h("b", {}, Math.round(top), " km/h"), h("small", {}, "estimated top speed")),
      h("div", {}, h("b", {}, clA.toFixed(2)), h("small", {}, "downforce (ClA)")),
      h("div", {}, h("b", {}, (balance * 100).toFixed(0), "%"), h("small", {}, "front aero share")),
      h("div", {}, h("b", {}, S.fuel, " kg"), h("small", {}, `about ${(S.fuel / 1.6).toFixed(0)} km`)),
      h("div", {}, h("b", {}, S.brakeBias, "%"), h("small", {}, "brake bias")));
  }
  strategyBox(cfg) {
    const comp = cfg.compound || "medium";
    const laps = cfg.laps || 5;
    const box = h("div", { class: "setup-group" }, h("h4", {}, "Strategy"),
      this.ui.field("Starting tyres", this.ui.select(comp, COMPOUND_LIST.map((c) => [c, COMPOUNDS[c].name]), (v) => { cfg.compound = v; })),
      this.ui.field("Fuel load (kg)", this.ui.range(this._setup.fuel, 5, 105, 1, (v) => { this._setup.fuel = v; cfg.fuel = v; this.updateSummary(); }, (v) => `${v} kg · ${(v / 1.6).toFixed(0)} km`)),
      h("p", { class: "note" }, `A race of ${laps} laps needs roughly ${Math.ceil(laps * (getTrack(TRACK_BY_ID[cfg.trackId]).length / 1000) * 1.6)} kg. Less fuel is faster but you must finish.`));
    return box;
  }

  // ---------------- track guide ----------------
  trackGuide(id) {
    const trackId = id || this._lastSetupTrack || "fiorella";
    const def = TRACK_BY_ID[trackId];
    const tr = getTrack(def);
    const rec = this.store.data.records[trackId], tt = this.store.data.records[trackId + ":tt"];
    const corners = tr.corners.map((c) => h("tr", {}, h("td", {}, `T${c.n}`), h("td", {}, c.dir === "R" ? "Right" : "Left"), h("td", {}, `${c.radius.toFixed(0)} m`),
      h("td", {}, c.radius < 40 ? "Slow — heavy braking" : c.radius < 90 ? "Medium" : c.radius < 200 ? "Fast — light lift" : "Flat out")));
    this.ui.screen("garage", this.ui.header("Track guide", def.name + " — " + def.place),
      h("div", { class: "cols" },
        h("div", {},
          h("p", {}, def.blurb),
          h("ul", { class: "facts" },
            h("li", {}, "Length: ", h("b", {}, (tr.length / 1000).toFixed(3), " km")),
            h("li", {}, "Corners: ", h("b", {}, String(tr.corners.length))),
            h("li", {}, "DRS zones: ", h("b", {}, String(tr.drs.length))),
            h("li", {}, "Race distance: ", h("b", {}, def.laps + " laps")),
            h("li", {}, "Character: ", h("b", {}, def.character)),
            h("li", {}, "Your best race lap: ", h("b", {}, rec ? fmtTime(rec.time) : "—")),
            h("li", {}, "Your best time trial: ", h("b", {}, tt ? fmtTime(tt.time) : "—"))),
          this.ui.field("Circuit", this.ui.select(trackId, TRACKS.map((t) => [t.id, t.name]), (v) => this.trackGuide(v)))),
        h("div", {}, h("img", { class: "guide-map", src: trackThumb(def, 420, 280, def.flag), alt: def.name + " layout" }),
          h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", {}, "Corner"), h("th", {}, "Direction"), h("th", {}, "Radius"), h("th", {}, "Notes"))), h("tbody", {}, corners)))));
  }
}

/** draw a lap's telemetry: speed trace, pedals and steering, with the sector marks */
export function drawTelemetry(canvas, track, rec, compare) {
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (!rec || !rec.trace) { g.fillStyle = "#888"; g.font = "16px sans-serif"; g.fillText("Set a lap to see the analysis", 20, 30); return; }
  const n = rec.trace.v.length;
  const x = (i) => (i / (n - 1)) * (W - 50) + 42;
  const panels = [
    { key: "v", h: H * 0.52, top: 10, max: 360, color: "#ffd23a", label: "Speed (km/h)" },
    { key: "thr", h: H * 0.2, top: H * 0.58, max: 1, color: "#2ee86b", label: "Throttle" },
    { key: "brk", h: H * 0.2, top: H * 0.78, max: 1, color: "#ff4b3e", label: "Brake" },
  ];
  g.font = "11px sans-serif";
  for (const p of panels) {
    g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1;
    g.strokeRect(42, p.top, W - 50, p.h);
    g.fillStyle = "#9aa0ab"; g.fillText(p.label, 46, p.top + 12);
    const draw = (arr, color, alpha) => {
      g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = 1.6; g.beginPath();
      for (let i = 0; i < n; i++) {
        const v = arr[i]; if (v == null) continue;
        const y = p.top + p.h - (Math.min(v, p.max) / p.max) * p.h;
        i === 0 ? g.moveTo(x(i), y) : g.lineTo(x(i), y);
      }
      g.stroke(); g.globalAlpha = 1;
    };
    if (compare && compare.trace && compare.trace[p.key]) draw(compare.trace[p.key], "#7a8699", 0.8);
    draw(rec.trace[p.key], p.color, 1);
    if (p.key === "v") { g.fillStyle = "#9aa0ab"; for (const s of [0, 100, 200, 300]) { const y = p.top + p.h - (s / p.max) * p.h; g.fillText(String(s), 8, y + 4); g.strokeStyle = "rgba(255,255,255,0.07)"; g.beginPath(); g.moveTo(42, y); g.lineTo(W - 8, y); g.stroke(); } }
  }
  // sector markers
  g.strokeStyle = "rgba(255,255,255,0.3)"; g.setLineDash([4, 4]);
  for (const s of track.sectors.slice(1)) { const i = Math.floor(s / 10); g.beginPath(); g.moveTo(x(i), 10); g.lineTo(x(i), H - 4); g.stroke(); }
  g.setLineDash([]);
}
