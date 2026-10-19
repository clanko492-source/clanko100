// CLANKO GP — online 1v1 racing over WebRTC. The host runs the real session; the guest sends its
// controls and renders the host's authoritative state, predicting its own car so steering stays
// instant. Results, timing and collisions are decided by the host.

import { DT } from "../core/physics.js";
import { clamp, lerp, wrapAngle } from "../core/math.js";

export const NET = { INPUT: 1, STATE: 2, EVENT: 3, HELLO: 4, READY: 5, PING: 6, PONG: 7, CHAT: 8, RESULT: 9, RESTART: 10 };
const STATE_HZ = 20, INPUT_HZ = 30;

/** pack a snapshot: [tick, phase, lights, flag, perCar...] as a Float32Array */
function packState(session, tick) {
  const es = session.entities;
  const n = es.length;
  const a = new Float32Array(6 + n * 16);
  a[0] = tick; a[1] = session.time; a[2] = PHASES.indexOf(session.phase); a[3] = session.lights;
  a[4] = FLAGS.indexOf(session.flag); a[5] = n;
  for (let i = 0; i < n; i++) {
    const e = es[i], c = e.car, o = 6 + i * 16;
    a[o] = c.x; a[o + 1] = c.y; a[o + 2] = c.z; a[o + 3] = c.h;
    a[o + 4] = c.vx; a[o + 5] = c.vz; a[o + 6] = c.r; a[o + 7] = c.steer;
    a[o + 8] = c.rpm; a[o + 9] = c.gear + (c.reverse ? 100 : 0);
    a[o + 10] = c.throttle + c.brake * 2; // packed pedals
    a[o + 11] = (c.drsOpen ? 1 : 0) + (c.limiter ? 2 : 0) + (e.removed ? 4 : 0) + (e.retired ? 8 : 0) + (e.pitPilot ? 16 : 0);
    a[o + 12] = e.lap + e.position / 100;
    a[o + 13] = e.lastLap || 0;
    a[o + 14] = c.wheels[0].rot; a[o + 15] = c.wheels[2].rot;
  }
  return a;
}
const PHASES = ["pre", "formation", "lights", "racing", "finishing", "done"];
const FLAGS = ["green", "yellow", "doubleYellow", "sc", "vsc", "red", "chequered"];

export class NetRace {
  /**
   * link: PeerLink, isHost: boolean, session, myId/remoteId: entity ids
   */
  constructor({ link, isHost, session, myId, remoteId, onEvent, onResult, onRestart, onChat }) {
    this.link = link; this.isHost = isHost; this.session = session;
    this.myId = myId; this.remoteId = remoteId;
    this.onEvent = onEvent; this.onResult = onResult; this.onRestart = onRestart; this.onChat = onChat;
    this.tick = 0;
    this.lastState = null; this.prevState = null;
    this.stateAcc = 0; this.inputAcc = 0;
    this.ping = 0; this.pingAcc = 0; this.lastPong = performance.now();
    this.remoteInput = { steer: 0, throttle: 0, brake: 0, analog: true };
    this.inputSeq = 0;
    this.warn = 0;
    this.stats = { packets: 0, bytes: 0, dropped: 0, lost: 0 };
    this.connected = true;
    // the host packs its cars in its own order; the guest maps them onto its own entities by role,
    // because each side lists its own car first.
    this.indexMap = null;
    link.on("data", (ch, msg) => this._onData(ch, msg));
    if (isHost) link.send("control", { t: NET.HELLO, ids: session.entities.map((e) => e.id) });
    link.on("close", () => { this.connected = false; });
  }

  _onData(ch, msg) {
    this.stats.packets++;
    if (msg instanceof ArrayBuffer) {
      this.stats.bytes += msg.byteLength;
      const a = new Float32Array(msg);
      if (a[0] === NET.INPUT * 1e6) return; // never happens; inputs go as JSON
      this._applyState(a);
      return;
    }
    this.stats.bytes += (msg.__len || 0);
    switch (msg.t) {
      case NET.HELLO:
        // ids as the host sees them: its own car is "player" there, which is "remote" here
        if (!this.isHost && Array.isArray(msg.ids)) this.indexMap = msg.ids.map((id) => (id === "player" ? this.remoteId : id === "remote" ? this.myId : id));
        break;
      case NET.INPUT: if (this.isHost) this._takeInput(msg); break;
      case NET.EVENT: this.onEvent && this.onEvent(msg.e, msg.d); break;
      case NET.RESULT: this.onResult && this.onResult(msg.r); break;
      case NET.RESTART: this.onRestart && this.onRestart(msg.cfg); break;
      case NET.CHAT: this.onChat && this.onChat(msg.text); break;
      case NET.PING: this.link.send("control", { t: NET.PONG, s: msg.s }); break;
      case NET.PONG: this.ping = performance.now() - msg.s; this.lastPong = performance.now(); break;
    }
  }

  _takeInput(msg) {
    // basic validation: values in range, not stale
    const i = msg.i || {};
    const ok = (v, lo, hi) => (typeof v === "number" && isFinite(v) ? clamp(v, lo, hi) : 0);
    this.remoteInput.steer = ok(i.s, -1, 1);
    this.remoteInput.throttle = ok(i.t, 0, 1);
    this.remoteInput.brake = ok(i.b, 0, 1);
    this.remoteInput.drsHeld = !!i.d;
    this.remoteInput.overtake = !!i.o;
    this.remoteInput.analog = true;
    if (msg.cmd) this._remoteCommand(msg.cmd, msg.arg);
    const e = this.session.byId(this.remoteId);
    if (e) this.session.setInput(this.remoteId, this.remoteInput);
    this.lastInputAt = performance.now();
  }
  _remoteCommand(cmd, arg) {
    const allowed = ["pit", "cancelPit", "reset", "ersMode", "mix", "bias", "limiter", "drs"];
    if (!allowed.includes(cmd)) return;
    this.session.command(this.remoteId, cmd, arg);
  }

  /** guest: push my controls to the host */
  sendInput(inp, cmd, arg) {
    if (this.isHost || !this.connected) return;
    const now = performance.now();
    if (!cmd && this._lastInputSent && now - this._lastInputSent < 1000 / INPUT_HZ) return;
    this._lastInputSent = now;
    this.link.send("control", { t: NET.INPUT, n: ++this.inputSeq, i: { s: +inp.steer.toFixed(3), t: +inp.throttle.toFixed(3), b: +inp.brake.toFixed(3), d: !!inp.drsHeld, o: !!inp.overtake }, cmd, arg });
  }
  sendCommand(cmd, arg) {
    if (this.isHost) { this.session.command(this.myId, cmd, arg); return; }
    this.link.send("control", { t: NET.INPUT, n: ++this.inputSeq, i: { s: 0, t: 0, b: 0 }, cmd, arg });
  }
  sendEvent(e, d) { this.link.send("control", { t: NET.EVENT, e, d }); }
  sendChat(text) { this.link.send("control", { t: NET.CHAT, text: String(text).slice(0, 200) }); }

  /** host: broadcast the authoritative state */
  update(dt) {
    // real time, not simulation time: a slow frame rate must not look like a dead connection
    const now = performance.now();
    if (now - (this._lastPing || 0) > 1000) { this._lastPing = now; this.link.send("control", { t: NET.PING, s: now }); }
    if (now - this.lastPong > 12000) { if (this.connected) this.onEvent && this.onEvent("disconnect"); this.connected = false; }
    else if (!this.connected && this.link.ready) this.connected = true;
    if (this.isHost) {
      // if the guest's input has not arrived for a while, let their car coast
      if (this.lastInputAt && now - this.lastInputAt > 900) {
        const e = this.session.byId(this.remoteId);
        if (e) this.session.setInput(this.remoteId, { steer: 0, throttle: 0, brake: 0.25, analog: true });
      }
      if (now - (this._lastState || 0) >= 1000 / STATE_HZ) {
        this._lastState = now;
        const a = packState(this.session, ++this.tick);
        this.link.send("state", a.buffer);
      }
    }
  }

  /** guest: apply an authoritative snapshot */
  _applyState(a) {
    if (this.isHost) return;
    const tick = a[0];
    if (this.lastState && tick <= this.lastState[0]) { this.stats.dropped++; return; }
    if (this.lastState && tick > this.lastState[0] + 1) this.stats.lost += tick - this.lastState[0] - 1;
    this.prevState = this.lastState; this.lastState = a;
    this.stateT = 0;
    const S = this.session;
    const phase = PHASES[a[2] | 0] || "racing";
    if (S.phase !== phase) {
      S.phase = phase;
      if (phase === "racing" && !S.greenAt) { S.greenAt = S.time; S.ctx.racing = true; for (const e of S.entities) { e.held = false; if (e.lapStart == null) { e.lapStart = S.time; e.sectorStart = S.time; } } }
    }
    S.lights = a[3] | 0;
    S.flag = FLAGS[a[4] | 0] || "green";
    const n = a[5] | 0;
    const map = this.indexMap || [this.remoteId, this.myId];
    for (let i = 0; i < n; i++) {
      const e = S.byId(map[i]); if (!e) continue;
      const c = e.car, o = 6 + i * 16;
      const mine = e.id === this.myId;
      const flags = a[o + 11] | 0;
      e.removed = !!(flags & 4); e.retired = !!(flags & 8);
      const lapPos = a[o + 12];
      e.lap = Math.floor(lapPos); e.position = Math.round((lapPos - e.lap) * 100);
      if (a[o + 13]) e.lastLap = a[o + 13];
      if (mine) {
        // reconcile my own car: snap when far out, otherwise nudge
        const dx = a[o] - c.x, dz = a[o + 2] - c.z;
        const err = Math.hypot(dx, dz);
        if (err > 6) { c.x = a[o]; c.y = a[o + 1]; c.z = a[o + 2]; c.h = a[o + 3]; c.vx = a[o + 4]; c.vz = a[o + 5]; c.r = a[o + 6]; }
        else if (err > 0.08) {
          const k = clamp(err / 3, 0.08, 0.5);
          c.x += dx * k; c.z += dz * k; c.y = lerp(c.y, a[o + 1], 0.3);
          c.h += wrapAngle(a[o + 3] - c.h) * k * 0.8;
          c.vx = lerp(c.vx, a[o + 4], 0.25); c.vz = lerp(c.vz, a[o + 5], 0.25);
        }
        c.drsOpen = !!(flags & 1); c.limiter = !!(flags & 2);
      } else {
        // the opponent: keep the last two snapshots and interpolate between them in sync()
        e.net = e.net || {};
        e.net.prev = e.net.cur || { x: a[o], y: a[o + 1], z: a[o + 2], h: a[o + 3], w0: a[o + 14], w2: a[o + 15] };
        e.net.cur = { x: a[o], y: a[o + 1], z: a[o + 2], h: a[o + 3], w0: a[o + 14], w2: a[o + 15] };
        e.net.t = 0;
        c.vx = a[o + 4]; c.vz = a[o + 5]; c.r = a[o + 6]; c.steer = a[o + 7];
        c.rpm = a[o + 8];
        const g = a[o + 9]; c.reverse = g >= 100; c.gear = g % 100;
        const ped = a[o + 10]; c.brake = Math.floor(ped / 2) ? 1 : ped > 1 ? ped - 2 : 0; c.throttle = ped % 2;
        c.drsOpen = !!(flags & 1); c.limiter = !!(flags & 2);
      }
    }
  }

  /** guest: move the opponent between snapshots (call every frame) */
  interpolate(dt) {
    if (this.isHost) return;
    const S = this.session;
    for (const e of S.entities) {
      if (e.id === this.myId || !e.net || !e.net.cur) continue;
      e.net.t = Math.min(1, e.net.t + dt * STATE_HZ);
      const p = e.net.prev, c2 = e.net.cur, k = e.net.t, c = e.car;
      c.x = lerp(p.x, c2.x, k); c.y = lerp(p.y, c2.y, k); c.z = lerp(p.z, c2.z, k);
      c.h = p.h + wrapAngle(c2.h - p.h) * k;
      c.wheels[0].rot = c.wheels[1].rot = lerp(p.w0, c2.w0, k);
      c.wheels[2].rot = c.wheels[3].rot = lerp(p.w2, c2.w2, k);
      // keep the track position in step so timing and the map work
      S.track.query(c.x, c.z, c.hint, c.q); c.hint = c.q.i;
      c.u = Math.hypot(c.vx, c.vz); c.speed = c.u;
    }
  }

  /** host: send the final classification */
  sendResult(results) { this.link.send("control", { t: NET.RESULT, r: results }); }
  sendRestart(cfg) { this.link.send("control", { t: NET.RESTART, cfg }); }
  dispose() { this.connected = false; }
}
