// CLANKO GP — replays and the broadcast view. Every session records the cars 15 times a second;
// afterwards you can watch it back with television cameras, slow motion and a timing tower.

import * as THREE from "three";
import { h, clear } from "../ui/dom.js";
import { CAMERAS } from "../render/cameras.js";
import { fmtTime, clamp, lerp, wrapAngle } from "../core/math.js";

const HZ = 15, FLOATS = 9;

export class ReplayRecorder {
  constructor(session) {
    this.session = session;
    this.n = session.entities.length;
    this.frames = [];
    this.meta = session.entities.map((e) => ({ id: e.id, name: e.name, short: e.short, number: e.number, color: e.team ? e.team.color : "#888", livery: e.livery }));
    this.acc = 0;
    this.events = [];
    this.max = HZ * 60 * 25; // about 25 minutes
  }
  step(dt) {
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc = 0;
    const es = this.session.entities;
    const a = new Float32Array(2 + this.n * FLOATS);
    a[0] = this.session.time; a[1] = this.session.entities.filter((e) => !e.removed).length;
    for (let i = 0; i < this.n; i++) {
      const c = es[i].car, o = 2 + i * FLOATS;
      a[o] = c.x; a[o + 1] = c.y; a[o + 2] = c.z; a[o + 3] = c.h; a[o + 4] = c.steer;
      a[o + 5] = c.rpm; a[o + 6] = c.gear + (es[i].removed ? 100 : 0); a[o + 7] = c.wheels[0].rot; a[o + 8] = c.u;
    }
    this.frames.push(a);
    if (this.frames.length > this.max) this.frames.shift();
  }
  note(type, t, data) { this.events.push({ type, t, ...data }); if (this.events.length > 500) this.events.shift(); }
  /** a compact version for saving: 5 Hz, two decimal places */
  compact(seconds = 60) {
    const keep = Math.min(this.frames.length, seconds * HZ);
    const start = this.frames.length - keep;
    const out = [];
    for (let i = start; i < this.frames.length; i += 3) out.push(Array.from(this.frames[i], (v) => Math.round(v * 100) / 100));
    return { v: 1, hz: HZ / 3, meta: this.meta, frames: out };
  }
}

export class ReplayPlayer {
  /** world: an existing World (cars already built); data: { frames, meta, hz } */
  constructor(app, world, data, { track, session, title } = {}) {
    this.app = app; this.world = world; this.data = data; this.track = track; this.session = session;
    this.hz = data.hz || HZ;
    this.t = 0; this.speed = 1; this.playing = true;
    this.focus = 0;
    this.title = title || "Replay";
    this.duration = (data.frames.length - 1) / this.hz;
  }
  frameAt(t) {
    const f = clamp(t * this.hz, 0, this.data.frames.length - 1);
    const i = Math.floor(f), a = this.data.frames[i], b = this.data.frames[Math.min(i + 1, this.data.frames.length - 1)];
    return { a, b, k: f - i };
  }
  apply() {
    const { a, b, k } = this.frameAt(this.t);
    const es = this.session.entities;
    for (let i = 0; i < es.length; i++) {
      const o = 2 + i * FLOATS, c = es[i].car;
      if (!a || o + 8 >= a.length) continue;
      c.x = lerp(a[o], b[o], k); c.y = lerp(a[o + 1], b[o + 1], k); c.z = lerp(a[o + 2], b[o + 2], k);
      c.h = a[o + 3] + wrapAngle(b[o + 3] - a[o + 3]) * k;
      c.steer = lerp(a[o + 4], b[o + 4], k); c.rpm = lerp(a[o + 5], b[o + 5], k);
      const g = a[o + 6]; es[i].removed = g >= 100; c.gear = g % 100;
      for (const w of c.wheels) w.rot = lerp(a[o + 7], b[o + 7], k);
      c.u = lerp(a[o + 8], b[o + 8], k); c.speed = Math.abs(c.u);
      this.track.query(c.x, c.z, c.hint, c.q); c.hint = c.q.i;
      es[i].render = es[i].render || {};
      Object.assign(es[i].render, { px: c.x, py: c.y, pz: c.z, ph: c.h });
    }
  }
  update(dt) {
    if (this.playing) this.t = clamp(this.t + dt * this.speed, 0, this.duration);
    this.apply();
  }
}

/** the broadcast overlay: timing tower, battle graphic and replay controls */
export class ReplayUI {
  constructor(app) { this.app = app; }
  save(rc) {
    const rec = rc.recorder;
    if (!rec) return;
    const data = rec.compact(75);
    const list = this.app.store.data.replays || (this.app.store.data.replays = []);
    list.unshift({ title: `${rc.track.def.name} — ${new Date().toLocaleDateString()}`, date: Date.now(), trackId: rc.track.id, data });
    while (list.length > 6) list.pop();
    if (!this.app.store.save()) { list.shift(); this.app.store.save(); this.app.ui.toast("Not enough space to save the replay."); }
  }
  /** watch the race that just finished, without rebuilding the world */
  watch(rc) {
    const rec = rc.recorder;
    if (!rec || rec.frames.length < 10) { this.app.ui.toast("Nothing recorded yet."); return; }
    this.start(rc, { frames: rec.frames, meta: rec.meta, hz: HZ }, rc.track.def.name);
  }
  play(index) {
    const r = (this.app.store.data.replays || [])[index];
    if (!r) return;
    this.app.ui.toast("Saved replays open in the race you are in; start a race on " + r.trackId + " to watch it.");
  }
  start(rc, data, title) {
    const player = new ReplayPlayer(this.app, rc.world, data, { track: rc.track, session: rc.session, title });
    rc.replay = player;
    rc.paused = true;
    rc.session.paused = true;
    this.app.ui.hideAll();
    const bar = h("div", { class: "replay-bar" });
    const time = h("span", { class: "rt" }, "0:00");
    const scrub = h("input", { type: "range", min: 0, max: 1000, value: 0, oninput: () => { player.t = (+scrub.value / 1000) * player.duration; player.apply(); } });
    const playBtn = h("button", { class: "btn small", onclick: () => { player.playing = !player.playing; playBtn.textContent = player.playing ? "Pause" : "Play"; } }, "Pause");
    const speedBtn = h("button", { class: "btn small", onclick: () => { const sp = [0.25, 0.5, 1, 2, 4]; player.speed = sp[(sp.indexOf(player.speed) + 1) % sp.length]; speedBtn.textContent = player.speed + "×"; } }, "1×");
    const camBtn = h("button", { class: "btn small", onclick: () => { const m = rc.rig.cycle(1, ["tv", "chase", "far", "heli", "cockpit", "tcam"]); camBtn.textContent = CAMERAS.find((c) => c.id === m).name; } }, "TV");
    const focusBtn = h("button", { class: "btn small", onclick: () => { const n = rc.session.entities.length; player.focus = (player.focus + 1) % n; rc.focusId = rc.session.entities[player.focus].id; focusBtn.textContent = rc.session.entities[player.focus].short; } }, rc.session.entities[0].short);
    const close = h("button", { class: "btn small", onclick: () => { rc.replay = null; rc.focusId = null; rc.paused = false; rc.session.paused = false; bar.remove(); this.app.ui.results(rc); } }, "Done");
    bar.append(h("b", {}, "REPLAY"), playBtn, speedBtn, camBtn, focusBtn, scrub, time, close);
    this.app.overlay.appendChild(bar);
    rc.rig.setMode("tv");
    player.onTick = () => { time.textContent = fmtTime(player.t, true); scrub.value = String(Math.round((player.t / player.duration) * 1000)); };
  }
}
