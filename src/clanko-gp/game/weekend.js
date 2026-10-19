// CLANKO GP — a race weekend: practice, qualifying and the race, with qualifying deciding the grid.
// Used on its own (Grand Prix Weekend) and inside career mode.

import { h } from "../ui/dom.js";
import { TRACKS, TRACK_BY_ID } from "../core/tracks-data.js";
import { trackThumb } from "../ui/menu.js";
import { fmtTime } from "../core/math.js";

export const FORMATS = {
  short: { id: "short", name: "Short", practice: 0, qualiMinutes: 6, raceLaps: (def) => Math.max(3, Math.round(def.laps * 0.12)) },
  medium: { id: "medium", name: "Medium", practice: 10, qualiMinutes: 10, raceLaps: (def) => Math.max(5, Math.round(def.laps * 0.25)) },
  full: { id: "full", name: "Full", practice: 20, qualiMinutes: 15, raceLaps: (def) => def.laps },
};

export class Weekend {
  constructor(app) { this.app = app; this.ui = app.ui; this.state = null; }

  /** menu entry: pick a circuit and a format, then run practice → qualifying → race */
  setup() {
    const cfg = { trackId: this._last || "fiorella", format: "short", weather: "dry", rules: this.app.store.settings.gameplay.rules, damage: this.app.store.settings.gameplay.damage, difficulty: this.app.store.settings.gameplay.difficulty, aiCount: 19 };
    const opts = h("div", { class: "setup-opts" },
      this.ui.field("Weekend length", this.ui.select(cfg.format, Object.values(FORMATS).map((f) => [f.id, `${f.name} — ${f.practice ? f.practice + " min practice, " : "no practice, "}${f.qualiMinutes} min qualifying`]), (v) => (cfg.format = v))),
      this.ui.field("Weather", this.ui.select(cfg.weather, [["dry", "Dry"], ["changing", "Changing"], ["wet", "Wet"], ["random", "Random"]], (v) => (cfg.weather = v))),
      this.ui.field("Rules", this.ui.select(cfg.rules, [["arcade", "Arcade"], ["standard", "Standard"], ["sim", "Simulation"]], (v) => (cfg.rules = v))),
      this.ui.field("Damage", this.ui.select(cfg.damage, [["off", "Off"], ["reduced", "Reduced"], ["sim", "Simulation"]], (v) => (cfg.damage = v))),
      this.ui.field("Opponents", this.ui.range(cfg.aiCount, 1, 19, 1, (v) => (cfg.aiCount = v))),
      this.ui.field("AI difficulty", this.ui.range(Math.round(cfg.difficulty * 100), 80, 103, 1, (v) => (cfg.difficulty = v / 100))));
    this.ui.screen("setup", this.ui.header("Grand Prix Weekend", "Practice, qualifying and the race — qualifying sets the grid"),
      h("div", { class: "setup-body" }, this.ui.trackPicker(cfg.trackId, (id) => (cfg.trackId = id)),
        h("div", { class: "setup-side" }, opts, h("div", { class: "row" }, h("button", { class: "btn primary big", onclick: () => { this._last = cfg.trackId; this.start(cfg); } }, "Go to the circuit")))));
  }

  /** begin a weekend (also used by career) */
  start(cfg, onFinish) {
    const f = FORMATS[cfg.format] || FORMATS.short;
    const def = TRACK_BY_ID[cfg.trackId];
    this.state = {
      cfg, format: f, onFinish, done: {}, grid: null, results: null,
      sessions: [...(f.practice ? [{ id: "practice", name: "Practice", minutes: f.practice }] : []), { id: "qualifying", name: "Qualifying", minutes: f.qualiMinutes }, { id: "race", name: "Race", laps: f.raceLaps(def) }],
    };
    this.screen();
  }

  screen() {
    const st = this.state, cfg = st.cfg, def = TRACK_BY_ID[cfg.trackId];
    const rows = st.sessions.map((s) => {
      const done = st.done[s.id];
      return h("div", { class: "weekend-row" + (done ? " done" : "") },
        h("b", {}, s.name),
        h("small", {}, s.id === "race" ? `${s.laps} laps` : `${s.minutes} minutes`),
        h("span", {}, done ? (s.id === "qualifying" ? `P${done.position} · ${done.best ? fmtTime(done.best) : "no time"}` : s.id === "race" ? `P${done.position}` : done.best ? fmtTime(done.best) : "—") : "not run"),
        done ? h("button", { class: "btn small", onclick: () => this.run(s, true) }, "Run again") : h("button", { class: "btn primary small", onclick: () => this.run(s) }, "Go"));
    });
    const next = st.sessions.find((s) => !st.done[s.id]);
    this.ui.screen("setup", this.ui.header(def.name, `${def.place} · ${st.format.name} weekend`),
      h("div", { class: "setup-body" },
        h("div", {}, h("img", { class: "guide-map", src: trackThumb(def, 460, 300, def.flag), alt: "" }),
          h("p", { class: "note" }, def.blurb)),
        h("div", { class: "setup-side" },
          h("div", { class: "weekend-list" }, rows),
          h("div", { class: "row" },
            h("button", { class: "btn", onclick: () => this.app.garageUI.setupScreen(cfg) }, "Car setup"),
            next ? h("button", { class: "btn primary", onclick: () => this.run(next) }, "Next session: " + next.name) : h("button", { class: "btn primary", onclick: () => this.finish() }, "Finish the weekend"),
            h("button", { class: "btn ghost", onclick: () => (st.onFinish ? st.onFinish(null) : this.ui.mainMenu()) }, "Leave")))));
  }

  run(s, again) {
    const st = this.state, cfg = st.cfg;
    const base = this.ui._raceConfig({
      trackId: cfg.trackId, type: s.id, laps: s.laps || 30, timeLimit: s.minutes ? s.minutes * 60 : 0,
      rules: cfg.rules, damage: cfg.damage, weather: cfg.weather, difficulty: cfg.difficulty, aiCount: cfg.aiCount,
      teamId: cfg.teamId || null, seed: (cfg.seed || 7) + st.sessions.indexOf(s),
      grid: s.id === "race" && st.gridByIndex ? "order" : "random", gridOrder: s.id === "race" ? st.gridByIndex : null,
      start: s.id === "race" ? "grid" : "pit", perf: cfg.perf,
    });
    if (cfg.fixedDrivers) base.fixedDrivers = cfg.fixedDrivers;
    base.weekend = this;
    base.session = s;
    this.app.startRace(base);
  }

  /** called by the app when a session finishes */
  onResults(rc, results) {
    const st = this.state;
    if (!st) return;
    const s = rc.cfg.session;
    if (!s) return;
    const me = results.find((r) => r.isPlayer) || {};
    st.done[s.id] = { position: me.position, best: me.bestLap, results };
    if (s.id === "qualifying") {
      // the grid follows the qualifying order; a driver without a time starts at the back
      const order = results.slice().sort((a, b) => (a.bestLap == null ? 1e9 : a.bestLap) - (b.bestLap == null ? 1e9 : b.bestLap));
      const slotOf = new Map(order.map((r, k) => [r.id, k]));
      st.gridByIndex = rc.session.entities.map((e) => (slotOf.has(e.id) ? slotOf.get(e.id) : slotOf.size));
      st.gridIds = order.map((r) => r.id);
      st.pole = order[0] && order[0].id;
    }
    if (s.id === "race") st.results = results;
  }
  /** after the results screen: back to the weekend */
  afterResults(rc) {
    const st = this.state;
    if (!st) { this.ui.mainMenu(); return; }
    if (st.results && rc.cfg.session && rc.cfg.session.id === "race") this.finish();
    else this.screen();
  }
  finish() {
    const st = this.state;
    this.state = null;
    if (st && st.onFinish) st.onFinish(st.results);
    else this.ui.mainMenu();
  }
}
