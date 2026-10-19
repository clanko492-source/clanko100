// CLANKO GP — online lobby: create or join a private room with a code, agree the race settings,
// and start a genuine peer-to-peer 1v1 race. Ranked divisions, friends and clubs need a server of
// their own; what is here works with no server beyond the free signalling broker.

import { h, clear } from "./../ui/dom.js";
import { Signal, PeerLink, roomCode, peerIdFor, DEFAULT_BROKERS, iceFor } from "./signal.js";
import { NET } from "./race-net.js";
import { TRACKS, TRACK_BY_ID } from "../core/tracks-data.js";
import { trackThumb } from "../ui/menu.js";
import { fmtTime } from "../core/math.js";

const LOBBY = { HELLO: "hello", SETTINGS: "settings", START: "start", READY: "ready", CHAT: "chat", REMATCH: "rematch" };

export class OnlineUI {
  constructor(app) {
    this.app = app; this.ui = app.ui;
    this.state = null;
  }
  get store() { return this.app.store; }
  me() {
    const p = this.store.data.profile;
    return { name: p ? p.name : "Driver", short: p ? p.short : "DRV", number: p ? p.number : 1, livery: p ? p.livery : null, nat: p ? p.nat : "GBR" };
  }

  open() {
    this.ui.screen("online", this.ui.header("Online", "Race another person, one on one"),
      h("div", { class: "online-cols" },
        h("nav", { class: "menu" },
          h("button", { class: "menu-item", onclick: () => this.host() }, h("b", {}, "Create a room"), h("small", {}, "You get a code to share with your friend")),
          h("button", { class: "menu-item", onclick: () => this.joinPrompt() }, h("b", {}, "Join with a code"), h("small", {}, "Enter the code your friend gives you")),
          h("button", { class: "menu-item", onclick: () => this.ui.push(() => this.serverInfo()) }, h("b", {}, "How online racing works"), h("small", {}, "Connection, matchmaking and what needs a server"))),
        h("div", { class: "stats-card" },
          h("h3", {}, "Status"),
          h("p", { class: "note" }, "Races run directly between the two players' browsers (WebRTC). Only the room handshake goes through a public signalling broker — there is no game server, so there is nothing to pay for and nothing to keep running."),
          h("p", { class: "note" }, "Both players need a working internet connection. Some strict company or school networks block peer-to-peer connections; if the connection fails, try another network or a phone hotspot."))));
  }

  serverInfo() {
    this.ui.screen("online", this.ui.header("How online racing works"),
      h("div", { class: "help" },
        h("h3", {}, "What works now"),
        h("ul", {},
          h("li", {}, "Private 1v1 rooms with a share code, on any network that allows peer-to-peer connections."),
          h("li", {}, "The player who created the room runs the race: lap timing, collisions, flags and results are decided there, so the two cars cannot disagree."),
          h("li", {}, "Live positions, steering, pedals, DRS, damage and lap times are sent 20 times a second and smoothed in between."),
          h("li", {}, "Connection quality and ping are shown during the race; if a player drops out the other is told.")),
        h("h3", {}, "What needs a server"),
        h("p", {}, "Public matchmaking, ranked divisions, seasonal leaderboards, friends lists, clubs and global ghost leaderboards all need a server to store accounts and results. This game ships without one, so those screens are not pretend: they are simply not enabled."),
        h("p", {}, "To add them you would need: a small signalling and matchmaking service (any Node host), a database for accounts and results, and a TURN relay for players behind strict networks. The game already speaks the standard PeerJS signalling protocol, so pointing it at your own broker is a one-line change."),
        h("h3", {}, "Fair racing"),
        h("p", {}, "The host checks the guest's inputs for impossible values and ignores anything out of range. Because the host decides the physics, a modified guest cannot teleport, brake beyond the tyres or invent lap times.")));
  }

  // ---------------- hosting ----------------
  async host() {
    const code = roomCode();
    this.ui.screen("online", this.ui.header("Room created", "Share this code with the other driver"),
      h("div", { class: "lobby" },
        h("div", { class: "room-code" }, code),
        this.statusEl = h("p", { class: "note" }, "Connecting to the signalling broker…"),
        h("div", { class: "row" },
          h("button", { class: "btn", onclick: () => { navigator.clipboard && navigator.clipboard.writeText(code); this.ui.toast("Code copied"); } }, "Copy code"),
          h("button", { class: "btn", onclick: () => this.leave() }, "Cancel")),
        this.lobbyBox = h("div", { class: "lobby-box" })));
    try {
      const sig = new Signal({ url: this.brokerUrl(), id: peerIdFor(code) });
      this.sig = sig;
      await sig.connect();
      this.status("Waiting for the other driver to join with code " + code + "…");
      sig.on("offer", async (src, payload) => {
        if (this.link) return; // one guest at a time
        const link = new PeerLink(sig, src, { initiator: false, iceServers: iceFor(this.brokerUrl()) });
        this.link = link;
        this.wire(link, true, code);
        await link.onOffer(payload);
      });
      sig.on("candidate", (src, p) => this.link && this.link.onCandidate(p));
      sig.on("peerLeft", () => this.status("The other driver left."));
      sig.on("close", () => this.status("Lost the connection to the signalling broker."));
    } catch (e) {
      this.status("Could not create the room: " + e.message, true);
    }
  }

  async joinPrompt() {
    const input = h("input", { type: "text", maxlength: 6, placeholder: "ABCDE", style: { textTransform: "uppercase", fontSize: "28px", letterSpacing: "0.3em", textAlign: "center" } });
    const go = h("button", { class: "btn primary", onclick: () => this.join(input.value.trim().toUpperCase()) }, "Join");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
    this.ui.screen("online", this.ui.header("Join a room", "Type the code you were given"),
      h("div", { class: "lobby" }, input, this.statusEl = h("p", { class: "note" }, ""), h("div", { class: "row" }, go, h("button", { class: "btn", onclick: () => this.leave() }, "Cancel")), this.lobbyBox = h("div", { class: "lobby-box" })));
    setTimeout(() => input.focus(), 50);
  }

  async join(code) {
    if (!code || code.length < 4) { this.status("That code looks too short."); return; }
    this.status("Connecting…");
    try {
      const sig = new Signal({ url: this.brokerUrl(), id: peerIdFor(roomCode(8)) });
      this.sig = sig;
      await sig.connect();
      const link = new PeerLink(sig, peerIdFor(code), { initiator: true, iceServers: iceFor(this.brokerUrl()) });
      this.link = link;
      this.wire(link, false, code);
      sig.on("answer", (src, p) => link.onAnswer(p));
      sig.on("candidate", (src, p) => link.onCandidate(p));
      sig.on("peerLeft", () => this.status("That room is not there any more."));
      await link.start();
      this.status("Waiting for the room to answer…");
      setTimeout(() => { if (!link.ready) this.status("No answer. Check the code, and that the other player's room is still open.", true); }, 15000);
    } catch (e) {
      this.status("Could not join: " + e.message, true);
    }
  }

  brokerUrl() {
    // ?broker=ws://host:port lets a private group point the game at their own signalling server
    const q = new URLSearchParams(location.search).get("broker");
    return q || this.store.data.settings.onlineBroker || DEFAULT_BROKERS[0].url;
  }
  status(text, bad) { if (this.statusEl) { this.statusEl.textContent = text; this.statusEl.style.color = bad ? "#ff8080" : ""; } }

  wire(link, isHost, code) {
    this.isHost = isHost; this.code = code;
    link.on("state", (st) => { if (st === "connected") this.status("Connected."); });
    link.on("open", () => {
      this.status("Connected to the other driver.");
      const hello = () => link.send("control", { t: NET.HELLO, lobby: LOBBY.HELLO, me: this.me(), host: isHost });
      hello();
      // the other side may not have its handlers up yet, so say hello a few more times
      let tries = 0;
      clearInterval(this._helloT);
      this._helloT = setInterval(() => { if (this.remote || ++tries > 8) { clearInterval(this._helloT); return; } hello(); }, 700);
      if (isHost) this.settings = this.settings || { trackId: "fiorella", laps: 3, weather: "dry", rules: "standard", damage: "reduced", hour: null, start: "grid" };
    });
    link.on("data", (ch, msg) => {
      if (!msg || typeof msg !== "object" || msg instanceof ArrayBuffer) return;
      if (msg.t === NET.HELLO) { if (!msg.me) return; const first = !this.remote; this.remote = msg.me; clearInterval(this._helloT); this.renderLobby(); if (isHost) this.pushSettings(); if (first) link.send("control", { t: NET.HELLO, lobby: LOBBY.HELLO, me: this.me(), host: isHost }); }
      else if (msg.t === NET.EVENT && msg.e === LOBBY.SETTINGS) { this.settings = msg.d; this.renderLobby(); }
      else if (msg.t === NET.EVENT && msg.e === LOBBY.READY) { this.remoteReady = msg.d; this.renderLobby(); }
      else if (msg.t === NET.EVENT && msg.e === LOBBY.START) { if (!isHost) this.startRace(msg.d); }
      else if (msg.t === NET.CHAT) { this.chat(this.remote ? this.remote.name : "Them", msg.text); }
    });
    link.on("close", () => { this.status("The other driver disconnected.", true); if (this.app.race && this.app.race.net) this.app.race.hud.message("Opponent disconnected", "warn", 4000); });
  }
  pushSettings() { this.link && this.link.send("control", { t: NET.EVENT, e: LOBBY.SETTINGS, d: this.settings }); }

  renderLobby() {
    if (!this.lobbyBox) return;
    const S = this.settings || {};
    const me = this.me();
    const card = (p, tag) => h("div", { class: "lobby-driver" }, h("b", {}, p ? p.name : "Waiting…"), h("small", {}, p ? `#${p.number} · ${p.short} · ${p.nat || ""}` : ""), h("i", {}, tag));
    const opts = this.isHost ? h("div", { class: "setup-opts" },
      this.ui.field("Circuit", this.ui.select(S.trackId, TRACKS.map((t) => [t.id, t.name]), (v) => { S.trackId = v; this.pushSettings(); this.renderLobby(); })),
      this.ui.field("Laps", this.ui.select(S.laps, [[1, "1"], [2, "2"], [3, "3"], [5, "5"], [8, "8"], [12, "12"]], (v) => { S.laps = +v; this.pushSettings(); })),
      this.ui.field("Weather", this.ui.select(S.weather, [["dry", "Dry"], ["changing", "Changing"], ["wet", "Wet"]], (v) => { S.weather = v; this.pushSettings(); })),
      this.ui.field("Rules", this.ui.select(S.rules, [["arcade", "Arcade"], ["standard", "Standard"], ["sim", "Simulation"]], (v) => { S.rules = v; this.pushSettings(); })),
      this.ui.field("Damage", this.ui.select(S.damage, [["off", "Off"], ["reduced", "Reduced"], ["sim", "Simulation"]], (v) => { S.damage = v; this.pushSettings(); })),
      this.ui.field("Start", this.ui.select(S.start, [["grid", "Standing start"], ["rolling", "Rolling start"]], (v) => { S.start = v; this.pushSettings(); })))
      : h("ul", { class: "facts" },
        h("li", {}, "Circuit", h("b", {}, TRACK_BY_ID[S.trackId] ? TRACK_BY_ID[S.trackId].name : "—")),
        h("li", {}, "Laps", h("b", {}, String(S.laps || "—"))),
        h("li", {}, "Weather", h("b", {}, S.weather || "—")),
        h("li", {}, "Rules", h("b", {}, S.rules || "—")),
        h("li", {}, "Damage", h("b", {}, S.damage || "—")));
    const startBtn = this.isHost ? h("button", { class: "btn primary big", disabled: !this.remote, onclick: () => { this.link.send("control", { t: NET.EVENT, e: LOBBY.START, d: this.settings }); this.startRace(this.settings); } }, this.remote ? "Start the race" : "Waiting for the other driver") : h("p", { class: "note" }, "Waiting for the host to start…");
    clear(this.lobbyBox).append(
      h("div", { class: "lobby-drivers" }, card(this.isHost ? me : this.remote, "HOST"), h("span", { class: "vs" }, "vs"), card(this.isHost ? this.remote : me, "GUEST")),
      S.trackId ? h("img", { class: "guide-map", src: trackThumb(TRACK_BY_ID[S.trackId], 320, 200, TRACK_BY_ID[S.trackId].flag), alt: "" }) : null,
      opts,
      this.chatBox = this.chatBox || h("div", { class: "chat-box" }),
      h("div", { class: "row" },
        h("input", { type: "text", placeholder: "Message…", maxlength: 120, onkeydown: (e) => { if (e.key === "Enter" && e.target.value.trim()) { this.link.send("control", { t: NET.CHAT, text: e.target.value }); this.chat(this.me().name, e.target.value); e.target.value = ""; } } }),
        startBtn, h("button", { class: "btn", onclick: () => this.leave() }, "Leave")));
  }
  chat(who, text) {
    if (!this.chatBox) return;
    // messages from other players are inserted as plain text, never as markup
    this.chatBox.appendChild(h("div", {}, h("b", {}, who + ": "), String(text).slice(0, 200)));
    while (this.chatBox.children.length > 8) this.chatBox.removeChild(this.chatBox.firstChild);
    this.chatBox.scrollTop = this.chatBox.scrollHeight;
  }

  startRace(settings) {
    const S = settings || this.settings;
    const me = this.me(), them = this.remote || { name: "Opponent", short: "OPP", number: 2 };
    const cfg = {
      trackId: S.trackId, type: "race", laps: S.laps, rules: S.rules, damage: S.damage, weather: S.weather,
      aiCount: 0, grid: "order", gridOrder: this.isHost ? [0, 1] : [1, 0], start: S.start || "grid", safetyCar: false, seed: 4242,
      player: { name: me.name, short: me.short, number: me.number, livery: me.livery },
      net: { link: this.link, isHost: this.isHost, remote: them, online: this },
    };
    this.app.startRace(cfg);
  }

  leave() {
    try { this.link && this.link.close(); } catch {}
    try { this.sig && this.sig.close(); } catch {}
    this.link = null; this.sig = null; this.remote = null; this.chatBox = null;
    this.app.ui.back();
  }
}
