// CLANKO GP — achievements and challenges. Everything is earned by driving; nothing can be bought.

import { h } from "../ui/dom.js";
import { TRACKS } from "../core/tracks-data.js";
import { fmtTime } from "../core/math.js";

export const ACHIEVEMENTS = [
  { id: "first-race", name: "Lights out", desc: "Finish your first race", reward: "Garage trophy" },
  { id: "first-points", name: "On the board", desc: "Score points in a race" },
  { id: "first-podium", name: "Champagne", desc: "Finish on the podium", reward: "Podium helmet pattern" },
  { id: "first-win", name: "Winner", desc: "Win a race", reward: "Gold livery accent" },
  { id: "pole", name: "Pole position", desc: "Qualify first" },
  { id: "clean", name: "Spotless", desc: "Win without a penalty or a track-limits warning" },
  { id: "wet-win", name: "Rainmaster", desc: "Win a race in the wet" },
  { id: "night-win", name: "Under the lights", desc: "Win a night race" },
  { id: "hat-trick", name: "Hat-trick", desc: "Pole, win and fastest lap in the same weekend" },
  { id: "three-wins", name: "On a roll", desc: "Win three races in a row" },
  { id: "comeback", name: "Comeback", desc: "Win after starting outside the top five" },
  { id: "title", name: "Champion", desc: "Win a championship", reward: "Champion's number plate" },
  { id: "all-tracks", name: "Grand tour", desc: "Race at every circuit" },
  { id: "record", name: "Record breaker", desc: "Beat your own lap record at a circuit" },
  { id: "no-assists", name: "Purist", desc: "Finish a race with every assist off" },
  { id: "pit-perfect", name: "Perfect stop", desc: "Complete a pit stop without speeding" },
  { id: "survivor", name: "Survivor", desc: "Finish a race with a damaged car" },
  { id: "online-win", name: "Head to head", desc: "Win an online race" },
  { id: "long-run", name: "Distance runner", desc: "Complete 500 km in total" },
];

export class Achievements {
  constructor(app) { this.app = app; }
  get data() { const d = this.app.store.data; return (d.achievements = d.achievements || {}); }
  has(id) { return !!this.data[id]; }
  award(id) {
    if (this.has(id)) return false;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return false;
    this.data[id] = { at: Date.now() };
    this.app.store.save();
    this.app.ui.toast(`Achievement: ${a.name} — ${a.desc}`, 4500);
    if (this.app.audio) this.app.audio.beep(1320, 0.12, 0.15);
    return true;
  }

  /** called after every session */
  check(rc, results) {
    const me = results.find((r) => r.isPlayer);
    if (!me) return;
    const S = rc.session, d = this.app.store.data;
    const sess = rc.cfg.session ? rc.cfg.session.id : rc.cfg.type;
    const visited = (d.stats.visited = d.stats.visited || {});
    visited[rc.track.id] = true;
    if (sess === "qualifying" && me.position === 1) this.award("pole");
    if (!S.isRace) { this.app.store.save(); return; }
    if (me.status === "Finished") this.award("first-race");
    if (me.points > 0) this.award("first-points");
    if (me.position <= 3 && me.status === "Finished") this.award("first-podium");
    const won = me.position === 1 && me.status === "Finished";
    if (won) {
      this.award("first-win");
      if (S.weather.lineWater() > 0.15 || S.weather.rain > 0.1) this.award("wet-win");
      if (rc.track.def.night) this.award("night-win");
      if (me.penalty === 0 && rc.player.warnings === 0) this.award("clean");
      if (rc.player.grid > 4) this.award("comeback");
      if (me.fastest && rc.cfg.weekend && rc.cfg.weekend.state && rc.cfg.weekend.state.pole === "player") this.award("hat-trick");
      if (rc.net) this.award("online-win");
      d.stats.streak = (d.stats.streak || 0) + 1;
      if (d.stats.streak >= 3) this.award("three-wins");
    } else d.stats.streak = 0;
    const a = rc.player.car.assists;
    if (me.status === "Finished" && !a.abs && !a.tc && !a.autoGear && !a.stability) this.award("no-assists");
    if (me.status === "Finished" && me.stops > 0 && !rc.player.pit.speeding) this.award("pit-perfect");
    const dmg = rc.player.car.damage;
    if (me.status === "Finished" && (dmg.fwL > 0.3 || dmg.fwR > 0.3 || dmg.rw > 0.3 || dmg.body > 0.4)) this.award("survivor");
    if (Object.keys(visited).length >= TRACKS.length) this.award("all-tracks");
    if ((d.stats.km || 0) > 500) this.award("long-run");
    if (rc._beatRecord) this.award("record");
    if (this.app.career.active && this.app.career.data.stats.titles > 0) this.award("title");
    this.app.store.save();
  }

  open() {
    const got = Object.keys(this.data).length;
    const rows = ACHIEVEMENTS.map((a) => h("div", { class: "ach" + (this.has(a.id) ? " got" : "") },
      h("i", {}, this.has(a.id) ? "★" : "☆"),
      h("div", {}, h("b", {}, a.name), h("small", {}, a.desc), a.reward ? h("small", { class: "rew" }, "Reward: " + a.reward) : null),
      h("span", {}, this.has(a.id) ? new Date(this.data[a.id].at).toLocaleDateString() : "")));
    const ch = this.challenges();
    this.app.ui.screen("ach", this.app.ui.header("Achievements", `${got} of ${ACHIEVEMENTS.length} earned`),
      h("div", { class: "cols" },
        h("div", { class: "ach-list" }, rows),
        h("div", {}, h("h3", {}, "This week's challenges"),
          h("div", { class: "ach-list" }, ch.map((c) => h("div", { class: "ach" }, h("i", {}, "◆"), h("div", {}, h("b", {}, c.name), h("small", {}, c.desc)), h("span", {}, c.go ? h("button", { class: "btn small", onclick: c.go }, "Try it") : "")))),
          h("p", { class: "note" }, "Challenges are optional and change every week. They never affect car performance."))));
  }

  /** three challenges that change with the week, the same for everyone */
  challenges() {
    const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
    const t1 = TRACKS[week % TRACKS.length], t2 = TRACKS[(week * 3 + 2) % TRACKS.length];
    return [
      { name: `Time trial: ${t1.name}`, desc: "Set a clean lap and beat your own best", go: () => this.app.startRace({ trackId: t1.id, type: "timetrial", laps: 99, aiCount: 0, start: "rolling", recordGhost: true, player: {}, weather: "dry" }) },
      { name: `Wet race at ${t2.name}`, desc: "Finish a short race in the rain", go: () => this.app.startRace({ trackId: t2.id, type: "race", laps: 3, aiCount: 9, weather: "wet", player: {} }) },
      { name: "No assists", desc: "Finish any race with ABS, traction control and automatic gears off" },
    ];
  }
}
