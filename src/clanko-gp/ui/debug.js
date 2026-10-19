// CLANKO GP — developer overlay: physics, tyres, AI, network, performance, and lines drawn in the
// world for the racing line, the car's path and the collision outlines.

import * as THREE from "three";
import { h, setText } from "./dom.js";
import { SURF_NAME } from "../core/track.js";
import { carOutline } from "../core/collide.js";

export class DebugOverlay {
  constructor(app) {
    this.app = app;
    this.el = h("div", { class: "debug" });
    this.pre = h("pre");
    this.el.append(h("b", {}, "CLANKO GP debug  (F8 lines, F9 close)"), this.pre);
    app.overlay.appendChild(this.el);
    this.lines = null;
    this.showLines = false;
    this._key = (e) => {
      if (e.code === "F8") { this.showLines = !this.showLines; this.rebuild(); }
      if (e.code === "F9") { app.store.data.settings.debug = false; app.store.save(); app.toggleDebug(false); }
    };
    window.addEventListener("keydown", this._key);
  }
  rebuild() {
    const rc = this.app.race;
    if (!rc) return;
    if (this.lines) { rc.g.scene.remove(this.lines); this.lines.traverse((o) => o.geometry && o.geometry.dispose()); this.lines = null; }
    if (!this.showLines) return;
    const g = new THREE.Group();
    const tr = rc.track, line = rc.session.line;
    const pts = [], edgeL = [], edgeR = [], barL = [], barR = [];
    for (let i = 0; i <= tr.N; i += 2) {
      const k = i % tr.N;
      const p = (d, y) => new THREE.Vector3(tr.x[k] + tr.nx[k] * d, tr.y[k] + y, tr.z[k] + tr.nz[k] * d);
      pts.push(p(line[k], 0.3));
      edgeL.push(p(-tr.hw[k], 0.1)); edgeR.push(p(tr.hw[k], 0.1));
      barL.push(p(-tr.bar[0][k], 0.6)); barR.push(p(tr.bar[1][k], 0.6));
    }
    const mk = (points, color) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, depthTest: false }));
    g.add(mk(pts, 0xffd23a), mk(edgeL, 0x00ff88), mk(edgeR, 0x00ff88), mk(barL, 0xff4040), mk(barR, 0xff4040));
    g.renderOrder = 999;
    rc.g.scene.add(g);
    this.lines = g;
  }
  update(rc) {
    if (!rc || !rc.session) return;
    this._t = (this._t || 0) + 1;
    if (this._t % 10) return;
    const e = rc.player, c = e.car, S = rc.session, g = rc.g;
    const w = c.wheels;
    const f = (v, n = 1) => (v == null ? "-" : v.toFixed(n));
    const lines = [
      `fps ${f(g.stats.fps, 0)}  frame ${f(g.stats.ms, 1)}ms  cpu ${f(g.stats.cpu, 1)}ms  res ${Math.round(g.scale * 100)}%  draws ${g.stats.calls}  tris ${(g.stats.tris / 1000).toFixed(0)}k`,
      `phase ${S.phase}  t ${f(S.time, 1)}  flag ${S.flag}  sectors ${S.sectorFlags.join(",")}  cars ${S.entities.filter((x) => !x.removed).length}/${S.entities.length}`,
      `pos ${f(c.x, 1)} ${f(c.y, 2)} ${f(c.z, 1)}  head ${f(c.h, 2)}  s ${f(c.q.s, 1)} d ${f(c.q.d, 2)}  i ${c.q.i}  surf ${SURF_NAME[c.wheels[0].surf]}`,
      `u ${f(c.u * 3.6, 0)}km/h  v ${f(c.v, 2)}  yaw ${f(c.r, 2)}  ax ${f(c.axF / 9.81, 2)}g  ay ${f(c.ayF / 9.81, 2)}g  gear ${c.gear} rpm ${f(c.rpm, 0)}`,
      `thr ${f(c.throttle, 2)} brk ${f(c.brake, 2)} steer ${f(c.steer, 3)}  fuel ${f(c.fuel, 1)}kg  ers ${f((c.ers / c.cls.ersStore) * 100, 0)}%  drs ${c.drsOpen ? "open" : c.drsAllowed ? "ready" : "-"}`,
      `tyre T ${w.map((x) => f(x.temp, 0)).join("/")}  wear ${w.map((x) => f(x.wear * 100, 0)).join("/")}  slip ${w.map((x) => f(x.slip / 0.088, 2)).join("/")}  mu ${w.map((x) => f(x.mu, 2)).join("/")}`,
      `Fz ${w.map((x) => f(x.Fz, 0)).join("/")}  brakes ${c.brakeTemp.map((x) => f(x, 0)).join("/")}°  damage fw ${f(c.damage.fwL, 2)}/${f(c.damage.fwR, 2)} rw ${f(c.damage.rw, 2)} body ${f(c.damage.body, 2)}`,
      `weather rain ${f(S.weather.rain, 2)} water ${f(S.weather.lineWater(), 2)} track ${f(S.weather.trackTemp, 0)}° air ${f(S.weather.airTemp, 0)}° hour ${f(S.weather.hour, 1)}`,
    ];
    if (rc.net) lines.push(`net ${rc.net.isHost ? "host" : "guest"}  ping ${f(rc.net.ping, 0)}ms  packets ${rc.net.stats.packets}  lost ${rc.net.stats.lost}  ${rc.net.connected ? "connected" : "DISCONNECTED"}`);
    const ai = S.entities.find((x) => x.ai);
    if (ai) lines.push(`ai[${ai.short}] skill ${f(ai.ai.skill, 2)} offset ${f(ai.ai.offset, 2)} stuck ${f(ai.ai.stuckTime, 1)} mistake ${f(ai.ai.mistake, 2)} pit ${ai.pit.requested ? "yes" : "no"}`);
    setText(this.pre, lines.join("\n"));
  }
  dispose() {
    window.removeEventListener("keydown", this._key);
    if (this.lines && this.app.race) { this.app.race.g.scene.remove(this.lines); }
    this.el.remove();
  }
}
