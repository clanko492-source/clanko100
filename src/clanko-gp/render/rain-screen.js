// CLANKO GP — rain on the camera: droplets and streaks drawn over the picture in the cockpit and
// helmet views, and a light spatter on the outside cameras. Pure canvas, so it costs almost nothing.

import { clamp, rng } from "../core/math.js";

export class RainScreen {
  constructor(parent) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "rain-screen";
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext("2d");
    this.drops = [];
    this.R = rng(17);
    this.w = 0; this.h = 0;
    this.visible = false;
  }
  resize(w, h) {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(2, Math.round(w * 0.5 * dpr)); this.canvas.height = Math.max(2, Math.round(h * 0.5 * dpr));
    this.w = this.canvas.width; this.h = this.canvas.height;
  }
  /** amount 0..1 of rain hitting the camera, speed in m/s (streaks stretch with speed) */
  update(dt, amount, speed, inside) {
    const on = amount > 0.02;
    if (on !== this.visible) { this.visible = on; this.canvas.style.display = on ? "block" : "none"; }
    if (!on) return;
    const R = this.R;
    const target = Math.round(amount * (inside ? 110 : 45));
    while (this.drops.length < target) {
      this.drops.push({ x: R() * this.w, y: R() * this.h, r: (0.8 + R() * 2.6) * (this.w / 640), life: 0.6 + R() * 2.2, age: 0, v: 0, trail: 0 });
    }
    while (this.drops.length > target) this.drops.pop();
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    const blow = clamp(speed / 70, 0, 1);
    for (const d of this.drops) {
      d.age += dt;
      // the airflow drags drops up and off the visor as speed rises
      d.v += (9 + blow * 160) * dt;
      d.y += (inside ? -d.v * blow * 0.6 + d.v * 0.08 : d.v * 0.05) * dt * 6;
      d.trail = blow * d.r * 7;
      if (d.age > d.life || d.y < -10 || d.y > this.h + 10) { d.x = R() * this.w; d.y = inside ? this.h * (0.3 + R() * 0.8) : R() * this.h; d.age = 0; d.v = 0; }
      const a = clamp(1 - d.age / d.life, 0, 1) * 0.5;
      g.globalAlpha = a;
      g.fillStyle = "rgba(220,235,255,0.75)";
      if (d.trail > 1.5) {
        g.beginPath();
        g.moveTo(d.x - d.r * 0.5, d.y);
        g.lineTo(d.x + d.r * 0.5, d.y);
        g.lineTo(d.x + d.r * 0.3, d.y + d.trail);
        g.lineTo(d.x - d.r * 0.3, d.y + d.trail);
        g.closePath(); g.fill();
      }
      g.beginPath(); g.arc(d.x, d.y, d.r, 0, Math.PI * 2); g.fill();
      g.globalAlpha = a * 0.6;
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath(); g.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.35, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  dispose() { this.canvas.remove(); }
}
