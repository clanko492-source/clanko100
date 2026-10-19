// CLANKO GP — the 3D world for a session: circuit, cars, effects, start lights, marshal lights,
// safety car, mirrors. Keeps the visuals in step with the session.

import * as THREE from "three";
import { TrackView } from "./track-view.js";
import { CarView } from "./car-model.js";
import { Effects } from "./effects.js";
import { Mirrors } from "./cameras.js";
import { clamp, lerp } from "../core/math.js";

const FLAG_COLOURS = { yellow: 0xffd400, doubleYellow: 0xffd400, sc: 0xffd400, vsc: 0xffd400, green: 0x10e050, blue: 0x2a6bff, red: 0xff2020 };

export class World {
  constructor(graphics, session, opts = {}) {
    this.g = graphics; this.session = session; this.track = session.track;
    this.opts = opts;
    const p = graphics.preset;
    this.trackView = new TrackView(this.track, { quality: { tex: p.tex, terrainCell: p.terrainCell, trees: p.trees, detail: p.detail, aniso: Math.min(p.aniso, graphics.maxAniso) }, line: session.line, teams: opts.teams, night: this.track.def.night });
    graphics.scene.add(this.trackView.group);
    this.effects = new Effects(graphics.scene, this.track, { particles: p.particles, groundY: (x, z) => this.trackView.groundY(x, z) });
    this.cars = new Map();
    this.mirrors = new Mirrors(graphics, p.mirrorSize);
    this.mirrors.every = p.mirrorEvery;
    this._waterTimer = 0;
    this.flashT = 0;
    this.scCar = null;
  }

  addCar(e, { player = false } = {}) {
    const p = this.g.preset;
    const v = new CarView({ livery: e.livery, quality: p.car, compound: e.car.compound, player, name: e.id });
    v.entity = e;
    this.g.scene.add(v.root);
    this.cars.set(e.id, v);
    e.render = { x: e.car.x, y: e.car.y, z: e.car.z, h: e.car.h, px: e.car.x, py: e.car.y, pz: e.car.z, ph: e.car.h };
    if (player && this.g.settings.mirrors !== false) v.setMirrorTextures(this.mirrors.left.texture, this.mirrors.right.texture);
    return v;
  }
  removeCar(id) { const v = this.cars.get(id); if (v) { this.g.scene.remove(v.root); v.dispose(); this.cars.delete(id); } }

  /** remember where every car was before a batch of physics steps (for smooth rendering) */
  beforeSteps() {
    for (const e of this.session.entities) {
      const r = e.render; if (!r) continue;
      r.px = e.car.x; r.py = e.car.y; r.pz = e.car.z; r.ph = e.car.h;
    }
  }

  /** place the cars at the interpolated position (alpha 0..1 between the last two physics states) */
  sync(dt, alpha, focus) {
    const tr = this.track, W = this.session.weather;
    for (const e of this.session.entities) {
      const v = this.cars.get(e.id); if (!v) continue;
      v.root.visible = !e.removed && !e.hidden;
      if (!v.root.visible) continue;
      const c = e.car, r = e.render;
      // interpolate position and heading
      let dh = c.h - r.ph; if (dh > Math.PI) dh -= Math.PI * 2; if (dh < -Math.PI) dh += Math.PI * 2;
      const state = Object.create(c);
      state.x = lerp(r.px, c.x, alpha); state.y = lerp(r.py, c.y, alpha); state.z = lerp(r.pz, c.z, alpha); state.h = r.ph + dh * alpha;
      const i = c.q.i;
      const wet = W.waterAt(i, c.q.d);
      v.update(state, dt, { trackPitch: Math.atan(tr.pitch[i]), trackBank: -tr.bank[i] * 0.0, wet: W.rain > 0.05 ? W.rain : wet * 0.5, player: e === focus, delta: e.deltaLive });
      if (e.car.compound !== v.compound) v.setCompound(e.car.compound);
      v.lod.update(this.g.camera);
    }
    // the safety car leads the field
    const S = this.session;
    if (S.sc && S.sc.deployed && S.order && S.order.length) {
      if (!this.scCar) {
        this.scCar = new CarView({ livery: { base: "#f2f2f2", secondary: "#1a1a1a", accent: "#ffd400", pattern: "stripes", number: 0, name: "SAFETY", sponsor: "SAFETY CAR" }, quality: Math.min(1, this.g.preset.car), name: "sc" });
        this.scCar.root.scale.set(1.05, 1.25, 1.1);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.9), new THREE.MeshBasicMaterial({ color: 0xffa000, toneMapped: false }));
        bar.position.set(-0.2, 1.12, 0); this.scCar.root.add(bar); this.scBar = bar;
        this.g.scene.add(this.scCar.root);
        this.scS = S.order[0].car.q.s + 120;
      }
      const lead = S.order.find((e) => !e.removed && !e.pitPilot) || S.order[0];
      const target = lead.car.q.s + 45;
      let ds = tr.sDelta(this.scS, target);
      this.scS += clamp(ds, -40 * dt, 80 * dt) + Math.max(0, lead.car.u) * dt;
      const p = tr.toWorld(this.scS, S.line[tr.idx(this.scS)] * 0.6);
      const fake = { x: p.x, y: p.y, z: p.z, h: p.heading, bodyPitch: 0, bodyRoll: 0, steer: 0, drsOpen: false, limiter: false, rpm: 6000, gear: 4, u: lead.car.u, cls: lead.car.cls, wheels: [0, 1, 2, 3].map((k) => ({ rot: (this.scRot = (this.scRot || 0) + lead.car.u * dt / 0.36 / 4), Fz: 3000, detached: false })), brakeTemp: [300, 300, 300, 300], damage: null };
      this.scCar.update(fake, dt, {});
      this.scCar.root.visible = true;
      this.scBar.material.color.setHex((performance.now() / 300) % 2 < 1 ? 0xffa000 : 0x331a00);
    } else if (this.scCar) { this.scCar.root.visible = false; if (!S.sc) { this.g.scene.remove(this.scCar.root); this.scCar.dispose(); this.scCar = null; } }
  }

  /** start lights and marshal panels follow the session */
  updateSignals(dt) {
    const S = this.session, sc = this.trackView.scenery;
    if (sc.startLights) {
      if (S.phase === "lights") sc.startLights.set(S.lights);
      else if (this._lightsOutT == null && S.phase === "racing" && S.isRace) { this._lightsOutT = S.time; sc.startLights.set(0); }
      else sc.startLights.set(0);
    }
    this.flashT += dt;
    if (sc.marshals && this.flashT > 0.25) {
      this.flashT = 0;
      const blink = (performance.now() / 400) % 2 < 1;
      sc.marshals.set((p) => {
        if (S.flag === "sc" || S.flag === "vsc") return blink ? FLAG_COLOURS.sc : 0x111111;
        const f = S.sectorFlags[p.sector];
        if (f && f !== "green") return blink ? FLAG_COLOURS.yellow : 0x111111;
        if (S._greenFlash && S.time - S._greenFlash < 8) return FLAG_COLOURS.green;
        return 0x111111;
      });
    }
  }

  /** wet surfaces follow the weather (a few times a second) */
  updateWeather(dt) {
    this._waterTimer -= dt;
    const W = this.session.weather;
    this.effects.setRain(W.rain);
    if (this._waterTimer > 0) return;
    this._waterTimer = 1.0;
    const avg = W.averageWater();
    if (avg < 0.005 && this._lastWet === 0) return;
    this._lastWet = avg < 0.005 ? 0 : avg;
    this.trackView.setWater(avg < 0.005 ? null : (i, d) => W.waterAt(i, d));
  }

  /** visual reactions to session events */
  handleEvent(ev) {
    const fx = this.effects;
    if (ev.type === "hitWall" || ev.type === "hitCar") {
      const c = ev.e.car;
      if (ev.speed > 2.5) fx.sparks(ev.x, (ev.y || c.y) - 0.2, ev.z, c.vx * 0.3, c.vz * 0.3, Math.min(40, 6 + ev.speed * 2), clamp(ev.speed / 10, 0.4, 2));
      if (ev.speed > 6) for (let k = 0; k < 6; k++) fx.dust(ev.x, (ev.y || c.y) - 0.3, ev.z, c.vx * 0.2, c.vz * 0.2, 1, [0.55, 0.55, 0.55]);
    } else if (ev.type === "partBroken") {
      const c = ev.e.car;
      const kind = ev.part.startsWith("wheel") ? "wheel" : ev.part === "rw" ? "rw" : "fw";
      fx.debrisPiece(kind, ev.x, ev.y || c.y, ev.z, c.vx, c.vz, kind === "fw" || kind === "rw" ? 0x151515 : null);
    }
  }

  update(dt, camera, focusCar) {
    const list = [];
    for (const e of this.session.entities) if (!e.removed && this.cars.has(e.id)) list.push({ car: e.car });
    this.effects.update(dt, list, camera, this.session.weather.lineWater());
    this.trackView.update(dt, performance.now() / 1000);
  }

  dispose() {
    for (const v of this.cars.values()) { this.g.scene.remove(v.root); v.dispose(); }
    this.cars.clear();
    if (this.scCar) { this.g.scene.remove(this.scCar.root); this.scCar.dispose(); }
    this.effects.dispose();
    this.g.scene.remove(this.trackView.group);
    this.trackView.dispose();
    this.mirrors.dispose();
  }
}
