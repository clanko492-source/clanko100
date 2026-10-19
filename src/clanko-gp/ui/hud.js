// CLANKO GP — the race HUD: timing tower, lap and sector times with live delta, speed, gear,
// revs and shift lights, DRS/ERS/limiter, tyres, fuel, brake bias, damage, minimap, flags,
// start lights, messages, radio subtitles and prompts. Every part can be switched off.

import { h, setText, setStyle, toggle, clear } from "./dom.js";
import { fmtTime, fmtGap, clamp } from "../core/math.js";
import { COMPOUNDS, ERS_MODES, FUEL_MIXES } from "../core/car-specs.js";

const FLAG_TEXT = { yellow: "YELLOW FLAG", doubleYellow: "DOUBLE YELLOW", sc: "SAFETY CAR", vsc: "VIRTUAL SAFETY CAR", chequered: "CHEQUERED FLAG", red: "RED FLAG" };

export class HUD {
  constructor(parent, session, focus, settings) {
    this.s = session; this.e = focus; this.set = settings || {};
    this.root = h("div", { class: "hud" });
    parent.appendChild(this.root);
    this.build();
    this.msgQueue = [];
    this.msgUntil = 0;
    this.textTimer = 0;
    this.applySettings(settings);
  }
  applySettings(st) {
    this.set = st || this.set;
    const S = this.set;
    this.root.style.setProperty("--hud-scale", S.scale || 1);
    this.root.style.opacity = S.opacity != null ? S.opacity : 1;
    toggle(this.root, "hidden", S.show === false);
    toggle(this.tower, "off", S.tower === false);
    toggle(this.mapWrap, "off", S.map === false);
    toggle(this.carPanel, "off", S.tyres === false);
    toggle(this.inputs, "off", S.inputs === false);
    toggle(this.deltaEl, "off", S.delta === false);
  }
  build() {
    const r = this.root;
    // timing tower
    this.tower = h("div", { class: "hud-tower" }, h("div", { class: "tower-head" }, this.towerTitle = h("span", {}, "LAP"), this.towerLap = h("b", {}, "")), this.towerRows = h("div", { class: "tower-rows" }));
    // flag and session strip
    this.flagEl = h("div", { class: "hud-flag" });
    // times
    this.times = h("div", { class: "hud-times" },
      h("div", { class: "t-row big" }, this.curEl = h("span", { class: "t-cur" }, "--:--.---"), this.deltaEl = h("span", { class: "t-delta" }, "")),
      h("div", { class: "t-sectors" }, this.secEls = [h("i", {}, "S1"), h("i", {}, "S2"), h("i", {}, "S3")]),
      h("div", { class: "t-row" }, h("span", { class: "t-lbl" }, "LAST"), this.lastEl = h("span", {}, "--")),
      h("div", { class: "t-row" }, h("span", { class: "t-lbl" }, "BEST"), this.bestEl = h("span", {}, "--")),
      this.posEl = h("div", { class: "t-pos" }, ""));
    // dash
    this.revBar = h("div", { class: "rev-fill" });
    this.leds = []; const ledWrap = h("div", { class: "leds" }); for (let k = 0; k < 15; k++) { const l = h("i"); this.leds.push(l); ledWrap.appendChild(l); }
    this.inputs = h("div", { class: "inputs" }, this.thrBar = h("i", { class: "thr" }), this.brkBar = h("i", { class: "brk" }));
    this.dash = h("div", { class: "hud-dash" },
      ledWrap,
      h("div", { class: "rev" }, this.revBar),
      h("div", { class: "dash-main" },
        h("div", { class: "speed" }, this.speedEl = h("b", {}, "0"), this.unitEl = h("small", {}, "KM/H")),
        this.gearEl = h("div", { class: "gear" }, "N"),
        h("div", { class: "dash-flags" }, this.drsEl = h("span", { class: "chip drs" }, "DRS"), this.ersEl = h("span", { class: "chip ers" }, "ERS"), this.limEl = h("span", { class: "chip lim" }, "PIT"))),
      h("div", { class: "ers-bar" }, this.ersFill = h("i")),
      this.inputs);
    // car panel: tyres, fuel, bias, damage
    this.tyreEls = [0, 1, 2, 3].map((k) => h("div", { class: "tyre" }, h("b", {}, ""), h("small", {}, "")));
    this.compEl = h("div", { class: "compound" }, "M");
    this.carPanel = h("div", { class: "hud-car" },
      h("div", { class: "tyres" }, this.compEl, h("div", { class: "tyre-grid" }, this.tyreEls)),
      h("div", { class: "car-stats" },
        h("div", {}, h("span", {}, "FUEL"), this.fuelEl = h("b", {}, "")),
        h("div", {}, h("span", {}, "ERS"), this.ersModeEl = h("b", {}, "")),
        h("div", {}, h("span", {}, "BIAS"), this.biasEl = h("b", {}, "")),
        h("div", {}, h("span", {}, "MIX"), this.mixEl = h("b", {}, ""))),
      this.dmgEl = h("div", { class: "damage" }));
    this.dmgParts = { fwL: h("i", { class: "fwl" }), fwR: h("i", { class: "fwr" }), body: h("i", { class: "body" }), rw: h("i", { class: "rw" }), floor: h("i", { class: "floor" }) };
    for (const k of Object.keys(this.dmgParts)) this.dmgEl.appendChild(this.dmgParts[k]);
    // minimap
    this.mapCanvas = h("canvas", { class: "map", width: 220, height: 220 });
    this.mapWrap = h("div", { class: "hud-map" }, this.mapCanvas);
    // centre messages, radio, prompts, lights
    this.msgEl = h("div", { class: "hud-msg" });
    this.subEl = h("div", { class: "hud-sub" });
    this.promptEl = h("div", { class: "hud-prompt" });
    this.lightsEl = h("div", { class: "hud-lights" }, [0, 1, 2, 3, 4].map(() => h("i")));
    this.penEl = h("div", { class: "hud-pen" });
    this.fpsEl = h("div", { class: "hud-fps" });
    this.netEl = h("div", { class: "net-badge" });
    this.mirrorFrame = h("div", { class: "hud-mirror-frame" });
    r.append(this.tower, this.flagEl, this.times, this.dash, this.carPanel, this.mapWrap, this.msgEl, this.subEl, this.promptEl, this.lightsEl, this.penEl, this.fpsEl, this.netEl, this.mirrorFrame);
    this._buildMap();
  }

  _buildMap() {
    const tr = this.s.track, c = this.mapCanvas, g = c.getContext("2d");
    const b = tr.bounds, W = c.width, H = c.height, pad = 14;
    const sc = Math.min((W - pad * 2) / (b.maxx - b.minx), (H - pad * 2) / (b.maxz - b.minz));
    this.mapTx = (x) => pad + (x - b.minx) * sc + ((W - pad * 2) - (b.maxx - b.minx) * sc) / 2;
    this.mapTz = (z) => pad + (z - b.minz) * sc + ((H - pad * 2) - (b.maxz - b.minz) * sc) / 2;
    const off = document.createElement("canvas"); off.width = W; off.height = H;
    const o = off.getContext("2d");
    o.lineJoin = "round"; o.lineCap = "round";
    o.beginPath();
    for (let i = 0; i <= tr.N; i += 3) { const k = i % tr.N; const x = this.mapTx(tr.x[k]), y = this.mapTz(tr.z[k]); if (i === 0) o.moveTo(x, y); else o.lineTo(x, y); }
    o.closePath();
    o.strokeStyle = "rgba(0,0,0,0.65)"; o.lineWidth = 9; o.stroke();
    o.strokeStyle = "rgba(235,235,235,0.9)"; o.lineWidth = 4; o.stroke();
    // sectors in colour
    const sectCol = ["#ff4b5c", "#3fb8ff", "#ffd23a"];
    for (let k = 0; k < 3; k++) {
      const s0 = tr.sectors[k], s1 = k < 2 ? tr.sectors[k + 1] : tr.length;
      o.beginPath();
      for (let s = s0; s <= s1; s += 6) { const i = tr.idx(s); const x = this.mapTx(tr.x[i]), y = this.mapTz(tr.z[i]); if (s === s0) o.moveTo(x, y); else o.lineTo(x, y); }
      o.strokeStyle = sectCol[k]; o.globalAlpha = 0.35; o.lineWidth = 2; o.stroke(); o.globalAlpha = 1;
    }
    // start line
    const sx = this.mapTx(tr.x[0]), sy = this.mapTz(tr.z[0]);
    o.fillStyle = "#fff"; o.fillRect(sx - 3, sy - 3, 6, 6);
    this.mapBg = off;
  }

  drawMap() {
    const c = this.mapCanvas, g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.mapBg, 0, 0);
    for (const e of this.s.entities) {
      if (e.removed) continue;
      const x = this.mapTx(e.car.x), y = this.mapTz(e.car.z);
      const me = e === this.e;
      g.beginPath(); g.arc(x, y, me ? 6 : 4.2, 0, Math.PI * 2);
      g.fillStyle = e.team ? e.team.color : "#ccc"; g.fill();
      g.lineWidth = me ? 2.5 : 1.2; g.strokeStyle = me ? "#ffd23a" : "rgba(0,0,0,0.8)"; g.stroke();
    }
  }

  message(text, kind = "info", ms = 2200) {
    this.msgQueue.push({ text, kind, ms });
  }
  subtitle(text, who = "ENGINEER", ms = 4000) {
    clear(this.subEl).append(h("b", {}, who), " ", text);
    this.subEl.classList.add("on");
    clearTimeout(this._subT); this._subT = setTimeout(() => this.subEl.classList.remove("on"), ms);
  }
  prompt(text) { setText(this.promptEl, text || ""); toggle(this.promptEl, "on", !!text); }

  /** per frame */
  update(dt, extra = {}) {
    const e = this.e, c = e.car, S = this.s, set = this.set;
    // dash: every frame
    const mph = set.units === "mph";
    const spd = Math.abs(c.u) * (mph ? 2.23694 : 3.6);
    setText(this.speedEl, String(Math.round(spd)));
    setText(this.unitEl, mph ? "MPH" : "KM/H");
    setText(this.gearEl, c.reverse ? "R" : c.speed < 0.5 && c.throttle < 0.1 && c.gear === 1 ? "N" : String(c.gear));
    const rpmF = clamp((c.rpm - 4000) / (c.cls.revLimit - 4000), 0, 1);
    setStyle(this.revBar, "transform", `scaleX(${rpmF.toFixed(3)})`);
    const shift = clamp((c.rpm - c.cls.shiftRpm * 0.82) / (c.cls.shiftRpm * 0.2), 0, 1);
    const lit = Math.round(shift * 15);
    const flash = c.rpm > c.cls.shiftRpm * 1.015 && (performance.now() / 70) % 2 < 1;
    this.leds.forEach((l, k) => toggle(l, "on", flash ? true : k < lit));
    toggle(this.root, "shift-flash", flash);
    setStyle(this.thrBar, "transform", `scaleY(${c.throttle.toFixed(2)})`);
    setStyle(this.brkBar, "transform", `scaleY(${c.brake.toFixed(2)})`);
    toggle(this.drsEl, "avail", c.drsAllowed && !c.drsOpen); toggle(this.drsEl, "open", c.drsOpen);
    toggle(this.ersEl, "on", c.ersDeploying); toggle(this.limEl, "on", c.limiter);
    const ers = c.cls.ersStore ? c.ers / c.cls.ersStore : 0;
    setStyle(this.ersFill, "transform", `scaleX(${ers.toFixed(3)})`);
    // current lap and live delta
    const lapT = e.lapStart != null && S.phase !== "lights" ? S.time - e.lapStart : null;
    setText(this.curEl, lapT != null ? fmtTime(lapT) : "--:--.---");
    toggle(this.curEl, "invalid", !e.lapValid);
    if (e.deltaLive != null && set.delta !== false) {
      setText(this.deltaEl, (e.deltaLive >= 0 ? "+" : "−") + Math.abs(e.deltaLive).toFixed(2));
      toggle(this.deltaEl, "pos", e.deltaLive > 0); toggle(this.deltaEl, "neg", e.deltaLive <= 0);
    } else setText(this.deltaEl, "");
    // start lights overlay
    toggle(this.lightsEl, "on", S.phase === "lights" && S.lights > 0);
    if (S.phase === "lights") [...this.lightsEl.children].forEach((l, k) => toggle(l, "on", k < S.lights));
    // messages
    const now = performance.now();
    if (now > this.msgUntil && this.msgQueue.length) {
      const m = this.msgQueue.shift();
      clear(this.msgEl).append(m.text); this.msgEl.className = "hud-msg on " + m.kind;
      this.msgUntil = now + m.ms;
    } else if (now > this.msgUntil) toggle(this.msgEl, "on", false);
    // slower text: 12 Hz
    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 1 / 12;
    this._text(extra);
  }

  _text(extra) {
    const e = this.e, c = e.car, S = this.s;
    // header: laps or time
    if (S.isRace) { setText(this.towerTitle, "LAP"); setText(this.towerLap, `${Math.min(S.laps, Math.max(1, (S.order && S.order[0] ? S.order[0].lap : 0) + 1))}/${S.laps}`); }
    else {
      setText(this.towerTitle, S.type === "timetrial" ? "TIME TRIAL" : S.type === "qualifying" ? "QUALIFYING" : "PRACTICE");
      const left = S.timeLimit ? Math.max(0, S.timeLimit - (S.time - (S.greenAt || 0))) : null;
      setText(this.towerLap, left != null && S.type !== "timetrial" ? fmtTime(left, true).replace(/\.\d+$/, "") : "");
    }
    // tower rows
    const order = S.order || S.entities;
    const rows = this.towerRows;
    const show = Math.min(order.length, this.set.towerRows || 20);
    while (rows.children.length < show) rows.appendChild(h("div", { class: "row" }, h("span", { class: "p" }), h("i", { class: "tc" }), h("span", { class: "n" }), h("span", { class: "g" }), h("span", { class: "ty" })));
    while (rows.children.length > show) rows.removeChild(rows.lastChild);
    for (let k = 0; k < show; k++) {
      const o = order[k], row = rows.children[k];
      const [p, tc, n, g, ty] = row.children;
      setText(p, String(k + 1));
      setStyle(tc, "background", o.team ? o.team.color : "#888");
      setText(n, o.short + (o.remote ? " ●" : ""));
      let gap;
      if (o.retired) gap = o.removed ? "OUT" : "DNF";
      else if (o.pitPilot) gap = "PIT";
      else if (S.isRace) gap = k === 0 ? (o.finished ? "FINISH" : "Leader") : o.lapsDown > 0 ? `+${o.lapsDown} LAP${o.lapsDown > 1 ? "S" : ""}` : "+" + (this.set.towerMode === "leader" ? o.gap : o.interval).toFixed(1);
      else gap = o.bestLap == null ? "—" : k === 0 ? fmtTime(o.bestLap) : "+" + o.gap.toFixed(3);
      setText(g, gap);
      setText(ty, COMPOUNDS[o.car.compound] ? COMPOUNDS[o.car.compound].short : "");
      setStyle(ty, "color", COMPOUNDS[o.car.compound] ? COMPOUNDS[o.car.compound].color : "#fff");
      toggle(row, "me", o === e);
      toggle(row, "fastest", S.fastestLap && S.fastestLap.e === o);
    }
    // flag strip
    const f = S.flag !== "green" ? S.flag : S.sectorFlags[e.sector] !== "green" ? S.sectorFlags[e.sector] : e.blueFlag ? "blue" : null;
    setText(this.flagEl, f === "blue" ? "BLUE FLAG — let the faster car through" : f ? FLAG_TEXT[f] || "" : "");
    this.flagEl.className = "hud-flag " + (f ? "on f-" + f : "");
    // times
    setText(this.lastEl, e.lastLap != null ? fmtTime(e.lastLap) : "--");
    setText(this.bestEl, e.bestLap != null ? fmtTime(e.bestLap) : "--");
    for (let k = 0; k < 3; k++) {
      const el = this.secEls[k];
      const t = e.sector > k ? e.curSectors[k] : e.sector === 0 && e.lastSectors[k] != null && S.time - (e.lapStart || 0) < 4 ? e.lastSectors[k] : null;
      setText(el, t != null ? t.toFixed(3) : "S" + (k + 1));
      let cls = "";
      if (t != null) {
        const best = e.bestSectors[k];
        let overall = Infinity; for (const o of S.entities) if (o.bestSectors[k] != null) overall = Math.min(overall, o.bestSectors[k]);
        cls = t <= overall + 1e-6 ? "purple" : best != null && t <= best + 1e-6 ? "green" : "yellow";
      }
      el.className = cls;
    }
    setText(this.posEl, S.isRace || S.type === "qualifying" || S.type === "practice" ? `P${e.position}` + (S.entities.length > 1 ? `/${S.entities.length}` : "") : "");
    // car panel
    const comp = COMPOUNDS[c.compound];
    setText(this.compEl, comp.short); setStyle(this.compEl, "borderColor", comp.color); setStyle(this.compEl, "color", comp.color);
    c.wheels.forEach((w, k) => {
      const el = this.tyreEls[k];
      const [lo, hi] = comp.opt;
      const t = w.temp;
      const col = w.detached ? "#333" : w.puncture ? "#ff2a2a" : t < lo - 15 ? "#2f7bff" : t < lo ? "#3fb8ff" : t <= hi ? "#2ee86b" : t < hi + 15 ? "#ffb02e" : "#ff4b2e";
      setStyle(el, "background", col);
      setText(el.children[0], w.detached ? "—" : Math.round(t) + "°");
      setText(el.children[1], w.detached ? "" : Math.round((1 - w.wear) * 100) + "%");
    });
    setText(this.fuelEl, c.fuel.toFixed(1) + " kg");
    setText(this.ersModeEl, (ERS_MODES[c.ersMode] || ERS_MODES[1]).name.toUpperCase());
    setText(this.biasEl, c.setup.brakeBias + "%");
    setText(this.mixEl, (FUEL_MIXES[c.fuelMix] || FUEL_MIXES[1]).name.toUpperCase());
    const d = c.damage;
    const dcol = (v) => (v >= 1 ? "#ff2a2a" : v > 0.5 ? "#ff8a2a" : v > 0.15 ? "#ffd23a" : "rgba(255,255,255,0.25)");
    setStyle(this.dmgParts.fwL, "background", dcol(d.fwL)); setStyle(this.dmgParts.fwR, "background", dcol(d.fwR));
    setStyle(this.dmgParts.rw, "background", dcol(d.rw)); setStyle(this.dmgParts.floor, "background", dcol(d.floor)); setStyle(this.dmgParts.body, "background", dcol(Math.max(d.body, d.engine, d.gearbox)));
    // penalties
    const pen = e.penalty - e.penaltyServed;
    setText(this.penEl, pen > 0 ? `+${pen}s PENALTY` : e.warnings > 0 && S.isRace ? `TRACK LIMITS ${e.warnings}/3` : "");
    toggle(this.penEl, "on", pen > 0 || (e.warnings > 0 && S.isRace));
    // prompts
    if (e.stuck > 3 && !e.pitPilot) this.prompt("Press R to return to the track");
    else if (S.phase === "lights" && S.rules.manualClutch) this.prompt("Hold SPACE (clutch) and the throttle — let go of SPACE when the lights go out");
    else if (e.pitPilot && e.pitPilot.state === "service") this.prompt("Pit stop — the crew are working");
    else if (e.pit.requested && !e.pitPilot) this.prompt("Box this lap: " + (e.pit.plan ? COMPOUNDS[e.pit.plan.tyres].name : ""));
    else this.prompt("");
    // map, fps
    if (this.set.map !== false) this.drawMap();
    if (extra.fps != null) { setText(this.fpsEl, `${Math.round(extra.fps)} fps · ${extra.res}% res · ${extra.calls} draws`); toggle(this.fpsEl, "on", !!extra.showFps); }
    if (extra.net) {
      const n = extra.net;
      setText(this.netEl, n.connected ? `ONLINE · ${Math.round(n.ping)} ms${n.lost ? " · " + n.lost + " lost" : ""}` : "CONNECTION LOST");
      toggle(this.netEl, "on", true); toggle(this.netEl, "bad", !n.connected || n.ping > 250);
    } else toggle(this.netEl, "on", false);
  }

  mirrorRect() {
    if (this.set.mirror === false || this.set.show === false) return null;
    const W = this.root.clientWidth || window.innerWidth;
    const w = Math.round(Math.min(360, W * 0.28)), hgt = Math.round(w / 4.2);
    const rect = { x: Math.round((W - w) / 2), y: 12, w, h: hgt };
    setStyle(this.mirrorFrame, "left", rect.x - 4 + "px"); setStyle(this.mirrorFrame, "top", rect.y - 4 + "px");
    setStyle(this.mirrorFrame, "width", rect.w + 8 + "px"); setStyle(this.mirrorFrame, "height", rect.h + 8 + "px");
    return rect;
  }
  showMirrorFrame(on) { toggle(this.mirrorFrame, "on", on); }

  dispose() { this.root.remove(); }
}
