// CLANKO GP — signalling client. Speaks the PeerJS cloud protocol, so a GitHub Pages build can use
// the free public broker (0.peerjs.com) with no server of our own. The same protocol is used by the
// local test broker in tools/mock-signal.mjs, so the whole handshake can be tested offline.

export const DEFAULT_BROKERS = [
  { url: "wss://0.peerjs.com:443/peerjs", key: "peerjs", name: "PeerJS cloud" },
];

const VERSION = "1.5.4";

/** generate a short, readable room code (no easily confused characters) */
export function roomCode(len = 5) {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
export const peerIdFor = (code) => "clankogp-" + code.toUpperCase();

/**
 * A connection to the signalling broker. Events: open(id), offer, answer, candidate, peerLeft,
 * error(kind, message), close.
 */
export class Signal {
  constructor({ url, key = "peerjs", id, token } = {}) {
    this.url = url || DEFAULT_BROKERS[0].url;
    this.key = key;
    this.id = id;
    this.token = token || Math.random().toString(36).slice(2, 12);
    this.handlers = {};
    this.open = false;
    this.closed = false;
    this.queue = [];
  }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
  emit(ev, ...a) { for (const f of this.handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } }

  connect(timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const u = `${this.url}?key=${encodeURIComponent(this.key)}&id=${encodeURIComponent(this.id)}&token=${encodeURIComponent(this.token)}&version=${VERSION}`;
      let ws;
      try { ws = new WebSocket(u); } catch (e) { reject(new Error("The browser refused to open the connection: " + e.message)); return; }
      this.ws = ws;
      const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error("The signalling server did not answer in time.")); } }, timeoutMs);
      ws.onopen = () => {
        this.hb = setInterval(() => { try { ws.readyState === 1 && ws.send(JSON.stringify({ type: "HEARTBEAT" })); } catch {} }, 5000);
      };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        switch (m.type) {
          case "OPEN":
            this.open = true;
            if (!settled) { settled = true; clearTimeout(timer); resolve(this.id); }
            this.emit("open", this.id);
            for (const q of this.queue.splice(0)) this.send(q.dst, q.type, q.payload);
            break;
          case "OFFER": this.emit("offer", m.src, m.payload); break;
          case "ANSWER": this.emit("answer", m.src, m.payload); break;
          case "CANDIDATE": this.emit("candidate", m.src, m.payload); break;
          case "LEAVE": case "EXPIRE": this.emit("peerLeft", m.src); break;
          case "ID-TAKEN":
            if (!settled) { settled = true; clearTimeout(timer); reject(Object.assign(new Error("That room code is already in use."), { code: "ID-TAKEN" })); }
            break;
          case "ERROR":
            this.emit("error", "server", m.payload && m.payload.msg);
            if (!settled) { settled = true; clearTimeout(timer); reject(new Error(String((m.payload && m.payload.msg) || "Signalling error"))); }
            break;
        }
      };
      ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error("Could not reach the signalling server. Check your connection, or try a private room on the same network.")); } };
      ws.onclose = () => { this.open = false; clearInterval(this.hb); if (!this.closed) this.emit("close"); if (!settled) { settled = true; clearTimeout(timer); reject(new Error("The signalling connection closed.")); } };
    });
  }
  send(dst, type, payload) {
    if (!this.ws || this.ws.readyState !== 1) { this.queue.push({ dst, type, payload }); return; }
    this.ws.send(JSON.stringify({ type, dst, payload }));
  }
  close() { this.closed = true; clearInterval(this.hb); try { this.ws && this.ws.close(); } catch {} }
}

export const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];
/** a broker on localhost means we are testing on one machine: host candidates connect on their own */
export function iceFor(url) { return /(^|\/\/)(localhost|127\.0\.0\.1)/.test(String(url)) ? [] : ICE_SERVERS; }

/**
 * One peer-to-peer link: two data channels (reliable control, unreliable state).
 * Events: open, data(channel, msg), close, error, state(connectionState)
 */
export class PeerLink {
  constructor(signal, remoteId, { initiator = false, iceServers = ICE_SERVERS } = {}) {
    this.signal = signal; this.remoteId = remoteId; this.initiator = initiator;
    this.handlers = {};
    this.pending = [];
    this.ready = false;
    this.pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 2 });
    this.pc.onicecandidate = (e) => { if (e.candidate) signal.send(remoteId, "CANDIDATE", { candidate: e.candidate, connectionId: this.connId || "gp" }); };
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      this.emit("state", st);
      if (st === "failed" || st === "closed") this.emit("close", st);
    };
    this.pc.ondatachannel = (e) => this._bind(e.channel);
    this.channels = {};
    this.connId = "gp_" + Math.random().toString(36).slice(2, 10);
    if (initiator) {
      this._bind(this.pc.createDataChannel("control", { ordered: true }));
      this._bind(this.pc.createDataChannel("state", { ordered: false, maxRetransmits: 0 }));
    }
  }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
  emit(ev, ...a) { for (const f of this.handlers[ev] || []) { try { f(...a); } catch (e) { console.error(e); } } }
  _checkReady() {
    const c = this.channels.control, st = this.channels.state;
    if (c && c.readyState === "open" && (!st || st.readyState === "open") && !this.ready) { this.ready = true; this.emit("open"); }
  }
  _bind(ch) {
    this.channels[ch.label] = ch;
    ch.binaryType = "arraybuffer";
    ch.onopen = () => this._checkReady();
    // a channel handed to us by ondatachannel can already be open, so the event would never fire
    if (ch.readyState === "open") queueMicrotask(() => this._checkReady());
    ch.onclose = () => this.emit("close", "channel");
    ch.onmessage = (e) => {
      let m = e.data;
      if (typeof m === "string") { try { m = JSON.parse(m); } catch { return; } }
      this.emit("data", ch.label, m);
    };
  }
  async start() {
    if (!this.initiator) return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signal.send(this.remoteId, "OFFER", { sdp: this.pc.localDescription, type: "data", connectionId: this.connId, label: "gp", reliable: true, serialization: "json", browser: "chrome" });
  }
  async onOffer(payload) {
    this.connId = payload.connectionId || this.connId;
    await this.pc.setRemoteDescription(payload.sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signal.send(this.remoteId, "ANSWER", { sdp: this.pc.localDescription, type: "data", connectionId: this.connId, browser: "chrome" });
    for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
  }
  async onAnswer(payload) {
    await this.pc.setRemoteDescription(payload.sdp);
    for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
  }
  async onCandidate(payload) {
    const c = payload.candidate;
    if (!c) return;
    if (!this.pc.remoteDescription) this.pending.push(c);
    else await this.pc.addIceCandidate(c).catch(() => {});
  }
  send(channel, msg) {
    const ch = this.channels[channel];
    if (!ch || ch.readyState !== "open") return false;
    try { ch.send(typeof msg === "string" || msg instanceof ArrayBuffer || ArrayBuffer.isView(msg) ? msg : JSON.stringify(msg)); return true; }
    catch { return false; }
  }
  close() { try { for (const c of Object.values(this.channels)) c.close(); this.pc.close(); } catch {} }
}
