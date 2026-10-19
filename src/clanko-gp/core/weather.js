// CLANKO GP — weather and track condition: rain that comes and goes on a forecast, water that
// builds up on the circuit (more in dips), a drying line where cars run, temperatures, rubber,
// and time of day.

import { clamp, lerp, smoothstep, rng, blurCircular } from "./math.js";

/**
 * opts: { track, line, mode: 'dry'|'wet'|'changing'|'random'|'storm', startRain, hour, timeScale, seed, fixed }
 */
export class Weather {
  constructor(opts = {}) {
    const tr = (this.track = opts.track);
    this.line = opts.line;
    this.R = rng(opts.seed || 7);
    this.time = 0;
    this.hour = opts.hour != null ? opts.hour : (tr && tr.def.time) || 14;
    this.timeScale = opts.timeScale != null ? opts.timeScale : 1; // how fast the clock runs (1 = real time)
    this.dynamicTime = opts.dynamicTime !== false;
    this.fixed = !!opts.fixed;
    this.mode = opts.mode || "dry";
    const night = tr && tr.def.night;
    this.airTemp = opts.airTemp != null ? opts.airTemp : night ? 26 : 18 + this.R() * 12;
    this.clouds = opts.clouds != null ? opts.clouds : (tr && tr.def.clouds) || 0.25;
    this.rain = 0;
    this.plan = this._makePlan(opts);
    this.rain = this._planRain(0);
    // water per segment (10 samples = 20 m)
    this.segLen = 10;
    const nSeg = tr ? Math.ceil(tr.N / this.segLen) : 1;
    this.water = new Float32Array(nSeg);
    this.dryLine = new Float32Array(nSeg); // 0..1 how much the racing line has dried
    this.dip = new Float32Array(nSeg);     // puddle factor
    if (tr) {
      const vc = blurCircular(tr.vcurv, 6);
      for (let s = 0; s < nSeg; s++) { const i = Math.min(tr.N - 1, s * this.segLen); this.dip[s] = clamp(vc[i] * 400, 0, 1); }
    }
    const startWet = opts.startWater != null ? opts.startWater : this.rain > 0 ? clamp(this.rain * 1.1, 0, 1) : 0;
    this.water.fill(startWet);
    this.rubber = opts.rubber != null ? opts.rubber : 0.975;
    this.trackTemp = this.airTemp + 10;
    this._accTimer = 0;
  }

  _makePlan(opts) {
    // a list of [time (s), rain target] points; rain eases between them
    const R = this.R, plan = [];
    const L = opts.duration || 3600;
    switch (this.mode) {
      case "wet": plan.push([0, 0.75], [L, 0.65]); break;
      case "storm": plan.push([0, 0.2], [180, 1], [L * 0.6, 0.9], [L, 0.4]); break;
      case "changing": {
        const start = opts.startRain != null ? opts.startRain : 0;
        const tRain = 120 + R() * 360, peak = 0.35 + R() * 0.45, dur = 240 + R() * 600;
        plan.push([0, start], [tRain, start], [tRain + 90, peak], [tRain + 90 + dur, peak * 0.8], [tRain + 180 + dur, 0], [L, 0]);
        break;
      }
      case "random": {
        let t = 0, v = R() < 0.25 ? R() * 0.6 : 0;
        while (t < L) { plan.push([t, v]); t += 200 + R() * 500; v = R() < 0.3 ? 0.2 + R() * 0.7 : 0; }
        break;
      }
      default: plan.push([0, 0], [L, 0]);
    }
    return plan;
  }
  _planRain(t) {
    const p = this.plan;
    if (!p.length) return 0;
    if (t <= p[0][0]) return p[0][1];
    for (let k = 1; k < p.length; k++) if (t <= p[k][0]) {
      const f = (t - p[k - 1][0]) / Math.max(1, p[k][0] - p[k - 1][0]);
      return lerp(p[k - 1][1], p[k][1], smoothstep(0, 1, f));
    }
    return p[p.length - 1][1];
  }

  /** the forecast shown to players: rain chance and expected intensity at +5, +10, +15, +30 minutes */
  forecast() {
    return [0, 300, 600, 900, 1800].map((dt) => {
      const r = this._planRain(this.time + dt);
      const uncertainty = Math.min(0.35, dt / 3600);
      return { inMin: Math.round(dt / 60), rain: r, chance: clamp(Math.round((r > 0.05 ? 0.75 + r * 0.25 : 0.05) * 100 * (1 - uncertainty) + uncertainty * 30), 0, 100) };
    });
  }

  /** cars passing over a segment help dry the line */
  carPass(i, speed) {
    const s = Math.floor(i / this.segLen);
    if (s < 0 || s >= this.dryLine.length) return;
    if (this.rain < 0.35 && this.water[s] < 0.85) this.dryLine[s] = Math.min(1, this.dryLine[s] + 0.00004 * speed);
  }

  step(dt) {
    this.time += dt;
    if (this.dynamicTime) this.hour = (this.hour + (dt * this.timeScale) / 3600) % 24;
    if (!this.fixed) this.rain = this._planRain(this.time);
    const rain = this.rain;
    this.clouds = Math.max(this.clouds * (1 - dt * 0.002), clamp(rain * 1.2 + 0.15, 0, 1) * (rain > 0.02 ? 1 : 0));
    // temperatures
    const sun = Math.max(0, Math.sin(((this.hour - 6) / 14) * Math.PI)) * (1 - this.clouds * 0.8);
    const tTarget = this.airTemp + 4 + sun * 18 - rain * 10;
    this.trackTemp += (tTarget - this.trackTemp) * Math.min(1, dt / 240);
    // rubber builds up in the dry and washes away in the rain
    this.rubber = clamp(this.rubber + (rain > 0.1 ? -0.00002 * rain : 0.0000012) * dt * 60, 0.95, 1.02);
    // water update at 4 Hz
    this._accTimer += dt;
    if (this._accTimer < 0.25) return;
    const h = this._accTimer; this._accTimer = 0;
    const dryRate = (0.0016 + 0.0004 * (this.trackTemp - 20) / 10 + sun * 0.0012);
    for (let s = 0; s < this.water.length; s++) {
      let w = this.water[s];
      const target = clamp(rain * (1.05 + this.dip[s] * 0.6), 0, 1);
      if (w < target) w += (target - w) * Math.min(1, h * (0.01 + rain * 0.03));
      else w -= Math.max(0, dryRate * h * (1 + this.dryLine[s] * 0.5));
      this.water[s] = clamp(w, 0, 1);
      if (rain > 0.4) this.dryLine[s] = Math.max(0, this.dryLine[s] - h * 0.01 * rain);
      if (this.water[s] < 0.02) this.dryLine[s] = Math.max(0, this.dryLine[s] - h * 0.002);
    }
  }

  /** standing water 0..1 at sample i, lateral offset d */
  waterAt(i, d) {
    const s = Math.floor(i / this.segLen);
    const w = this.water[Math.min(this.water.length - 1, s)];
    if (w <= 0.001) return 0;
    let lineF = 1;
    if (this.line) {
      const off = d - this.line[i];
      lineF = 1 - this.dryLine[s] * 0.85 * Math.exp(-(off * off) / 3.2);
    }
    const tr = this.track;
    // the edges hold more water than the crown of the road
    const edge = tr ? smoothstep(tr.hw[i] - 2.5, tr.hw[i] + 1, Math.abs(d)) * 0.25 : 0;
    return clamp(w * lineF + edge * w, 0, 1);
  }
  /** average water over the lap (for AI pace and tyre choice) */
  averageWater() { let t = 0; for (const w of this.water) t += w; return t / this.water.length; }
  /** water around the racing line (what a racing car actually sees) */
  lineWater() { let t = 0; for (let s = 0; s < this.water.length; s++) t += this.water[s] * (1 - this.dryLine[s] * 0.85); return t / this.water.length; }

  snapshot() { return { time: this.time, hour: this.hour, rain: this.rain, clouds: this.clouds, trackTemp: this.trackTemp, airTemp: this.airTemp, water: Array.from(this.water, (v) => Math.round(v * 100) / 100) }; }
}
