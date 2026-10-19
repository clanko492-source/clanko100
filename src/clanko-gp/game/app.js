// CLANKO GP — the application: renderer, input, saved data, menus and the main loop.

import * as THREE from "three";
import { Graphics, QUALITY, detectQuality } from "../render/graphics.js";
import { Input } from "./input.js";
import { Store } from "./settings.js";
import { RaceController } from "./race.js";
import { UI } from "../ui/menu.js";
import { GarageUI } from "../ui/garage-ui.js";
import { OnlineUI } from "../net/online.js";
import { Weekend } from "./weekend.js";
import { Career } from "./career.js";
import { ReplayUI } from "./replay.js";
import { Achievements } from "./achievements.js";
import { DebugOverlay } from "../ui/debug.js";
import { Garage } from "../render/garage.js";
import { h } from "../ui/dom.js";

export class App {
  constructor(root) {
    this.root = root;
    this.store = new Store();
    const S = this.store.settings;
    this.viewport = h("div", { class: "gp-viewport" });
    this.overlay = h("div", { class: "gp-overlay" });
    this.uiRoot = h("div", { class: "gp-ui" });
    root.append(this.viewport, this.overlay, this.uiRoot);
    const q = S.graphics.quality === "auto" ? detectQuality() : S.graphics.quality;
    this.qualityId = q;
    this.graphics = new Graphics(this.viewport, { ...S.graphics, quality: q });
    this.graphics.onContextLost = () => this.ui && this.ui.toast("Graphics were reset by the browser — restoring…", 4000);
    this.graphics.onContextRestored = () => { this.ui && this.ui.toast("Graphics restored", 2000); if (this.garage) this.garage.restore(); };
    this.input = new Input(S.controls);
    this.input.attach(window);
    this.ui = new UI(this);
    this.garageUI = new GarageUI(this);
    this.onlineUI = new OnlineUI(this);
    this.weekend = new Weekend(this);
    this.career = new Career(this);
    this.replays = new ReplayUI(this);
    this.achievements = new Achievements(this);

    this.race = null;
    this.garage = null;
    this.audio = null;
    this.debug = null;
    this.last = performance.now();
    this.running = true;
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.race && !this.race.paused && this.race.session.phase !== "done") this.pause(); });
    window.addEventListener("pagehide", () => this.store.save());
    requestAnimationFrame((t) => this.loop(t));
  }

  async init() {
    if (this.store.settings.debug) this.toggleDebug(true);
    // optional modules (loaded lazily so the menu appears quickly)
    try { const { AudioEngine } = await import("../audio/engine.js"); this.audio = new AudioEngine(this.store.settings.audio); } catch (e) { console.warn("audio unavailable", e); }
    this.showMenu();
    if (!this.store.ok) this.ui.toast("Saving is not available in this browser (private mode?). Progress will not be kept.", 6000);
  }

  setQuality(id) {
    this.qualityId = id === "auto" ? detectQuality() : id;
    this.store.settings.graphics.quality = id;
    this.store.save();
    this.graphics.setQuality(this.qualityId);
  }

  showMenu() {
    if (this.race) { this.race.dispose(); this.race = null; }
    this._clearScene();
    this.garage = new Garage(this.graphics, this.store);
    this.ui.mainMenu();
    if (this.audio) this.audio.menu(true);
  }

  _clearScene() {
    if (this.garage) { this.garage.dispose(); this.garage = null; }
  }

  async startRace(cfg) {
    if (this.race) { this.race.dispose(); this.race = null; }
    this._clearScene();
    if (this.audio) { this.audio.menu(false); this.audio.resume(); }
    this.ui.loading(0, "Loading");
    const rc = new RaceController(this, cfg);
    try {
      await rc.build((p, text) => this.ui.loading(p, text));
    } catch (err) {
      console.error(err);
      this.ui.error("The session could not be started: " + err.message);
      this.showMenu();
      return;
    }
    this.race = rc;
    this.ui.hideAll();
    this.input.enabled = true;
    this.last = performance.now();
    return rc;
  }

  pause() {
    if (!this.race || this.race.over) return;
    this.race.pause(true);
    this.ui.pauseMenu(this.race);
    if (this.audio) this.audio.pause(true);
  }
  resume() {
    if (!this.race) return;
    this.race.pause(false);
    this.ui.hideAll();
    this.last = performance.now();
    if (this.audio) this.audio.pause(false);
  }
  quitRace() { this.store.save(); this.showMenu(); }

  /** every session's results pass through here: stats, weekend, career, achievements */
  onResults(rc, results) {
    const me = results.find((r) => r.isPlayer);
    const st = this.store.data.stats;
    if (me && rc.session.isRace) {
      st.races++; if (me.position === 1 && me.status === "Finished") st.wins++;
      if (me.position <= 3 && me.status === "Finished") st.podiums++;
    }
    if (me) { st.laps += me.laps || 0; st.km += ((me.laps || 0) * rc.track.length) / 1000; }
    if (rc.cfg.session && rc.cfg.session.id === "qualifying" && me && me.position === 1) st.poles++;
    try { this.weekend.onResults(rc, results); } catch (e) { console.error(e); }
    try { if (this.career.active) this.career.onResults(rc, results); } catch (e) { console.error(e); }
    try { if (this.achievements) this.achievements.check(rc, results); } catch (e) { console.error(e); }
    this.store.save();
  }
  afterResults(rc, results) {
    if (rc.net) { this.ui.hideAll(); this.onlineUI.renderLobby ? this.onlineUI.open() : this.quitRace(); return; }
    if (this.career.active && rc.cfg.career) { this.career.afterResults(rc, results); return; }
    if (this.weekend.state && rc.cfg.weekend) { this.weekend.afterResults(rc, results); return; }
    this.quitRace();
  }

  saveGhost(trackId, ghost, time) {
    // ghosts are stored compactly (positions as 16-bit deltas would be smaller; this keeps it simple)
    const g = this.store.data.ghosts;
    if (!g[trackId] || time < g[trackId].time) {
      const arr = Array.from(ghost.frames, (v) => Math.round(v * 100) / 100);
      g[trackId] = { v: 1, time, frames: arr };
      if (!this.store.save()) { delete g[trackId]; this.store.save(); }
    }
  }

  toggleDebug(on) {
    if (on && !this.debug) this.debug = new DebugOverlay(this);
    else if (!on && this.debug) { this.debug.dispose(); this.debug = null; }
  }

  loop(t) {
    if (!this.running) return;
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = (t - this.last) / 1000; this.last = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.1);
    try {
      if (this.race) this.race.frame(dt);
      else if (this.garage) { this.garage.update(dt); this.graphics.renderer.render(this.garage.scene, this.garage.camera); this.input.poll(dt, 0); if (this.input.take("pause")) this.ui.back(); }
    } catch (err) {
      console.error(err);
      if (!this._errShown) { this._errShown = true; this.ui.error("Something went wrong: " + err.message + ". Your progress is saved — you can return to the menu."); }
    }
  }
}
