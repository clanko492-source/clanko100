// CLANKO GP — all game sound is synthesised live with the Web Audio API (no recordings):
// engines with turbo and hybrid whine, positional sound for nearby cars with Doppler, tyre squeal,
// wind, kerbs, gear shifts, impacts, rain, crowd and pit crew.

import { clamp, lerp } from "../core/math.js";

function noiseBuffer(ctx, seconds = 2, pink = false) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (pink) { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18; }
    else d[i] = w;
  }
  return buf;
}
function shaper(ctx, amount) {
  const ws = ctx.createWaveShaper(), n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  ws.curve = curve; ws.oversample = "2x";
  return ws;
}

/** one car's engine: a few oscillators at the firing frequency, shaped and filtered */
class EngineVoice {
  constructor(ctx, out, { detail = 2, panner = false } = {}) {
    this.ctx = ctx;
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.Q.value = 2.2;
    this.dist = shaper(ctx, 6);
    this.mix = ctx.createGain(); this.mix.gain.value = 0.35;
    this.oscs = [];
    const parts = detail >= 2 ? [[1, "sawtooth", 0.55], [2, "sawtooth", 0.28], [0.5, "square", 0.22], [3, "triangle", 0.12], [1.5, "sawtooth", 0.08]] : [[1, "sawtooth", 0.6], [0.5, "square", 0.25], [2, "triangle", 0.15]];
    for (const [mul, type, g] of parts) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 100 * mul;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og); og.connect(this.mix); o.start();
      this.oscs.push({ o, mul, og });
    }
    // intake / exhaust noise
    this.noise = ctx.createBufferSource(); this.noise.buffer = noiseBuffer(ctx, 2); this.noise.loop = true;
    this.noiseF = ctx.createBiquadFilter(); this.noiseF.type = "bandpass"; this.noiseF.Q.value = 1.4;
    this.noiseG = ctx.createGain(); this.noiseG.gain.value = 0.0;
    this.noise.connect(this.noiseF); this.noiseF.connect(this.noiseG); this.noiseG.connect(this.mix); this.noise.start();
    this.mix.connect(this.dist); this.dist.connect(this.filter); this.filter.connect(this.gain);
    if (detail >= 2) {
      // turbo whistle and hybrid whine
      this.turbo = ctx.createOscillator(); this.turbo.type = "sine"; this.turboG = ctx.createGain(); this.turboG.gain.value = 0;
      this.turbo.connect(this.turboG); this.turboG.connect(this.gain); this.turbo.start();
      this.mgu = ctx.createOscillator(); this.mgu.type = "sine"; this.mguG = ctx.createGain(); this.mguG.gain.value = 0;
      this.mgu.connect(this.mguG); this.mguG.connect(this.gain); this.mgu.start();
    }
    if (panner) {
      this.pan = ctx.createPanner(); this.pan.panningModel = "equalpower"; this.pan.distanceModel = "inverse"; this.pan.refDistance = 8; this.pan.rolloffFactor = 1.4; this.pan.maxDistance = 1200;
      this.gain.connect(this.pan); this.pan.connect(out);
    } else this.gain.connect(out);
    this.cutT = 0;
  }
  set(rpm, throttle, load, vol, t, doppler = 1, speed = 0) {
    const f = Math.max(30, (rpm / 60) * 3) * doppler; // V6: three firing pulses per turn
    const k = 0.03;
    for (const o of this.oscs) o.o.frequency.setTargetAtTime(f * o.mul, t, k);
    this.noiseF.frequency.setTargetAtTime(f * 2.2, t, k);
    this.noiseG.gain.setTargetAtTime(0.08 + throttle * 0.25, t, 0.05);
    this.filter.frequency.setTargetAtTime(500 + throttle * 3800 + rpm * 0.12, t, 0.04);
    const cut = this.cutT > t ? 0.25 : 1;
    this.gain.gain.setTargetAtTime(vol * (0.22 + throttle * 0.6 + load * 0.15) * cut, t, 0.03);
    if (this.turbo) {
      this.turbo.frequency.setTargetAtTime(2500 + rpm * 0.35 * doppler, t, 0.08);
      this.turboG.gain.setTargetAtTime(vol * throttle * 0.018 * clamp(rpm / 11000, 0, 1), t, 0.1);
      this.mgu.frequency.setTargetAtTime(400 + speed * 35, t, 0.05);
      this.mguG.gain.setTargetAtTime(vol * 0.012 * clamp(speed / 80, 0, 1), t, 0.1);
    }
  }
  shift(t) { this.cutT = t + 0.045; }
  setPos(x, y, z) { if (this.pan) { const t = this.ctx.currentTime; this.pan.positionX.setTargetAtTime(x, t, 0.02); this.pan.positionY.setTargetAtTime(y, t, 0.02); this.pan.positionZ.setTargetAtTime(z, t, 0.02); } }
  stop() { for (const o of this.oscs) o.o.stop(); this.noise.stop(); if (this.turbo) { this.turbo.stop(); this.mgu.stop(); } this.gain.disconnect(); }
}

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.voices = new Map();
    this.enabled = typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);
  }
  _init() {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.comp.connect(this.master);
    this.engineBus = c.createGain(); this.engineBus.connect(this.comp);
    this.fxBus = c.createGain(); this.fxBus.connect(this.comp);
    this.ambBus = c.createGain(); this.ambBus.connect(this.comp);
    this.noise = noiseBuffer(c, 3);
    this.pink = noiseBuffer(c, 4, true);
    // continuous layers: wind, tyres, kerb, rain, crowd
    const loop = (buf, type, freq, q, bus) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(bus); s.start();
      return { s, f, g };
    };
    this.wind = loop(this.pink, "lowpass", 900, 0.5, this.fxBus);
    this.squeal = loop(this.noise, "bandpass", 1100, 6, this.fxBus);
    this.rumble = loop(this.noise, "lowpass", 140, 2, this.fxBus);
    this.rainL = loop(this.noise, "highpass", 3500, 0.4, this.ambBus);
    this.crowd = loop(this.pink, "bandpass", 700, 0.6, this.ambBus);
    this.gravel = loop(this.noise, "bandpass", 420, 0.8, this.fxBus);
    this.apply(this.settings);
  }
  apply(s) {
    this.settings = s || this.settings;
    if (!this.ctx) return;
    const S = this.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(S.master ?? 0.8, t, 0.05);
    this.engineBus.gain.setTargetAtTime(S.engine ?? 0.9, t, 0.05);
    this.fxBus.gain.setTargetAtTime(S.effects ?? 0.8, t, 0.05);
    this.ambBus.gain.setTargetAtTime(S.ambience ?? 0.6, t, 0.05);
  }
  resume() { this._init(); if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }
  pause(on) { if (!this.ctx) return; if (on) this.ctx.suspend(); else this.ctx.resume(); }
  menu(on) { if (!this.ctx) return; if (on) { for (const v of this.voices.values()) v.stop(); this.voices.clear(); this._silence(); } }
  _silence() { const t = this.ctx.currentTime; for (const l of [this.wind, this.squeal, this.rumble, this.rainL, this.crowd, this.gravel]) l.g.gain.setTargetAtTime(0, t, 0.1); }

  attachRace(rc) { this.resume(); this.rc = rc; this._lastGear = null; }
  detachRace() { if (!this.ctx) return; for (const v of this.voices.values()) v.stop(); this.voices.clear(); this._silence(); this.rc = null; }

  /** one-shot sounds */
  _burst({ type = "lowpass", freq = 800, q = 1, dur = 0.2, vol = 0.5, buf, bus, rate = 1 }) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = buf || this.noise; s.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || this.fxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _thump(freq, dur, vol) {
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.fxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  beep(freq = 880, dur = 0.12, vol = 0.2) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = "square"; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.fxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  ui(kind = "click") { this.resume(); if (!this.ctx) return; if (kind === "click") this.beep(1200, 0.04, 0.05); else this.beep(660, 0.08, 0.06); }

  event(ev, rc) {
    if (!this.ctx) return;
    const me = rc.player;
    const near = (e) => { if (!e) return 0; const cam = rc.g.camera.position; const d = Math.hypot(e.car.x - cam.x, e.car.z - cam.z); return clamp(1 - d / 150, 0, 1); };
    switch (ev.type) {
      case "light": this.beep(520, 0.18, 0.12); break;
      case "lightsOut": this.beep(1040, 0.25, 0.08); break;
      case "hitWall": case "hitCar": {
        const v = clamp(ev.speed / 20, 0, 1) * (ev.e === me ? 1 : near(ev.e));
        if (v > 0.05) { this._burst({ freq: 500 + ev.speed * 40, q: 0.7, dur: 0.15 + v * 0.4, vol: 0.2 + v * 0.8 }); this._thump(90, 0.25 + v * 0.3, v * 0.9); }
        break;
      }
      case "partBroken": this._burst({ type: "highpass", freq: 2000, dur: 0.35, vol: 0.6 * (ev.e === me ? 1 : near(ev.e)) }); break;
      case "pitStop": if (ev.e === me) for (let k = 0; k < 6; k++) setTimeout(() => this._burst({ type: "bandpass", freq: 2600, q: 4, dur: 0.18, vol: 0.25 }), 150 + k * 140); break;
      case "drsOpen": if (ev.e === me) this._burst({ type: "highpass", freq: 3000, dur: 0.08, vol: 0.12 }); break;
      case "limiter": if (ev.e === me) this.beep(ev.on ? 1500 : 900, 0.08, 0.08); break;
    }
  }

  update(dt, rc) {
    if (!this.ctx || !rc) return;
    const c = this.ctx, t = c.currentTime, S = rc.session;
    const cam = rc.g.camera;
    // listener follows the camera
    const L = c.listener;
    const fwd = cam.getWorldDirection(this._f || (this._f = new cam.position.constructor()));
    if (L.positionX) { L.positionX.setTargetAtTime(cam.position.x, t, 0.02); L.positionY.setTargetAtTime(cam.position.y, t, 0.02); L.positionZ.setTargetAtTime(cam.position.z, t, 0.02); L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    const focus = rc.focusId ? S.byId(rc.focusId) : rc.player;
    const inside = rc.rig.isInside;
    // voices: the focus car (full detail) and the nearest few others
    const others = S.entities.filter((e) => e !== focus && !e.removed && !e.car.retired).map((e) => ({ e, d: Math.hypot(e.car.x - cam.position.x, e.car.z - cam.position.z) })).sort((a, b) => a.d - b.d).slice(0, 5).filter((o) => o.d < 400);
    const wanted = new Set([focus.id, ...others.map((o) => o.e.id)]);
    for (const [id, v] of this.voices) if (!wanted.has(id)) { v.stop(); this.voices.delete(id); }
    for (const id of wanted) {
      const e = S.byId(id); if (!e) continue;
      let v = this.voices.get(id);
      if (!v) { v = new EngineVoice(c, this.engineBus, { detail: id === focus.id ? 2 : 1, panner: id !== focus.id }); this.voices.set(id, v); v._gear = e.car.gear; }
      const car = e.car;
      if (car.gear !== v._gear) { v.shift(t); v._gear = car.gear; if (id === focus.id && car.gear > 0) this._burst({ type: "bandpass", freq: 300, q: 2, dur: 0.06, vol: 0.18 }); }
      let doppler = 1, vol = 1;
      if (id !== focus.id) {
        v.setPos(car.x, car.y + 0.5, car.z);
        // Doppler from the closing speed along the line of sight
        const dx = car.x - cam.position.x, dz = car.z - cam.position.z, d = Math.hypot(dx, dz) || 1;
        const rv = ((car.vx - (rc._camVx || 0)) * dx + (car.vz - (rc._camVz || 0)) * dz) / d;
        doppler = clamp(343 / (343 + rv), 0.7, 1.4);
        vol = 0.9;
      } else vol = inside ? 0.85 : 1;
      v.set(car.rpm, car.throttle, car.ersDeploying ? 1 : 0, vol, t, doppler, car.speed);
    }
    // camera velocity for Doppler
    if (this._lastCam) { rc._camVx = (cam.position.x - this._lastCam.x) / Math.max(dt, 1e-3); rc._camVz = (cam.position.z - this._lastCam.z) / Math.max(dt, 1e-3); }
    this._lastCam = { x: cam.position.x, z: cam.position.z };
    // focus car layers
    const car = focus.car;
    const sp = car.speed;
    this.wind.g.gain.setTargetAtTime(clamp((sp / 90) ** 2, 0, 1) * (inside ? 0.35 : 0.2), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(400 + sp * 12, t, 0.1);
    let slip = 0, lock = 0, offr = 0;
    for (const w of car.wheels) { if (w.detached) continue; slip = Math.max(slip, Math.abs(w.slip) / 0.088); lock = Math.max(lock, w.locked ? 1 : 0); if (w.surf >= 2 && w.surf <= 5) offr++; }
    const sq = sp > 6 && offr === 0 ? clamp((slip - 0.9) * 0.9, 0, 1) + lock * 0.8 : 0;
    this.squeal.g.gain.setTargetAtTime(clamp(sq, 0, 1) * 0.28 * (S.weather.lineWater() > 0.3 ? 0.2 : 1), t, 0.04);
    this.squeal.f.frequency.setTargetAtTime(900 + slip * 250 + lock * 300, t, 0.05);
    this.rumble.g.gain.setTargetAtTime(car.kerbWheels > 0 && sp > 5 ? 0.5 * clamp(sp / 40, 0.3, 1) : 0, t, 0.02);
    this.gravel.g.gain.setTargetAtTime(offr > 0 && sp > 2 ? 0.25 * clamp(sp / 30, 0.2, 1) * offr / 4 : 0, t, 0.05);
    this.rainL.g.gain.setTargetAtTime(S.weather.rain * (inside ? 0.25 : 0.4), t, 0.3);
    // crowd louder near the main straight
    const nearStart = clamp(1 - Math.abs(rc.track.sDelta(car.q.s, 0)) / 600, 0, 1);
    this.crowd.g.gain.setTargetAtTime(0.03 + nearStart * 0.12 + (S.phase === "lights" ? 0.1 : 0), t, 0.5);
  }
}
