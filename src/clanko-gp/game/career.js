// CLANKO GP — career: from a junior series to Grand Prix racing, with contracts, team mates,
// rivals, research, staff, sponsors, media and championships. Every result feeds the next season.

import { h, clear } from "../ui/dom.js";
import { TRACKS, TRACK_BY_ID } from "../core/tracks-data.js";
import { TEAMS, TEAM_BY_ID, DRIVERS, POINTS, teamLivery, driverShort } from "../core/teams.js";
import { trackThumb } from "../ui/menu.js";
import { FORMATS } from "./weekend.js";
import { clamp, lerp, rng, fmtTime } from "../core/math.js";

const JUNIOR_TEAMS = [
  { id: "j-apex", name: "Apex Junior", short: "APX", color: "#ff6a00", color2: "#111", accent: "#fff", pattern: "stripes", sponsor: "APEXLINE", perf: { power: 1.0, aero: 1.0, grip: 1.0 }, rating: 92 },
  { id: "j-lumen", name: "Lumen Academy", short: "LUM", color: "#2bb3ff", color2: "#fff", accent: "#ffd23a", pattern: "split", sponsor: "LUMEN", perf: { power: 0.99, aero: 0.99, grip: 0.995 }, rating: 84 },
  { id: "j-forge", name: "Forge Motorsport", short: "FRG", color: "#8a2be2", color2: "#eee", accent: "#2ee86b", pattern: "chevron", sponsor: "FORGE", perf: { power: 0.98, aero: 0.985, grip: 0.99 }, rating: 74 },
  { id: "j-cobalt", name: "Cobalt Racing", short: "CBT", color: "#143a8a", color2: "#f0f0f0", accent: "#ff4b3e", pattern: "fade", sponsor: "COBALT", perf: { power: 0.975, aero: 0.978, grip: 0.985 }, rating: 64 },
];

const STAFF = [
  { id: "engineer", name: "Race engineer", effect: "Better strategy calls and setup advice", cost: 120, gain: { reliability: 0.02, strategy: 0.08 } },
  { id: "aero", name: "Aerodynamicist", effect: "Faster aerodynamic development", cost: 180, gain: { aeroRate: 0.35 } },
  { id: "mechanic", name: "Chief mechanic", effect: "Quicker pit stops, fewer mistakes", cost: 100, gain: { pit: 0.25, reliability: 0.03 } },
  { id: "strategist", name: "Strategist", effect: "Reads the weather and the undercut", cost: 140, gain: { strategy: 0.12 } },
];

const RND = [
  { id: "engine", name: "Engine", effect: "power", cost: 260, gain: 0.006 },
  { id: "aero", name: "Aerodynamics", effect: "aero", cost: 300, gain: 0.007 },
  { id: "suspension", name: "Suspension", effect: "grip", cost: 240, gain: 0.006 },
  { id: "reliability", name: "Reliability", effect: "reliability", cost: 180, gain: 0.03 },
];

const MEDIA = [
  { q: "You were quick today. Is the championship on?", a: [["Stay humble — we take it race by race.", { rep: 1, morale: 2 }], ["Yes — we are here to win it.", { rep: 3, morale: -1 }], ["The car deserves the credit.", { rep: 1, morale: 4 }]] },
  { q: "Your team mate finished ahead. What went wrong?", a: [["Nothing. They did a better job today.", { rep: 2, morale: 3 }], ["The strategy cost me the race.", { rep: 0, morale: -4 }], ["We will look at the data and come back.", { rep: 1, morale: 1 }]] },
  { q: "There was contact out there. Your view?", a: [["It was a racing incident.", { rep: 2, morale: 1 }], ["They drove into me, simple as that.", { rep: -2, morale: 0 }], ["My mistake, I apologise.", { rep: 1, morale: 2 }]] },
  { q: "Rumours say a bigger team is interested in you.", a: [["I am focused on this team.", { rep: 1, morale: 4 }], ["Everyone wants to drive for the best.", { rep: 3, morale: -2 }], ["No comment.", { rep: 0, morale: 0 }]] },
];

function newSeasonState(tier, teamId, drivers) {
  return { tier, teamId, round: 0, calendar: makeCalendar(tier), points: 0, teamPoints: 0, standings: {}, results: [], drivers };
}
function makeCalendar(tier) {
  const n = tier === "junior" ? 6 : 10;
  const ids = TRACKS.map((t) => t.id);
  const out = [];
  for (let i = 0; i < n; i++) out.push(ids[(i * (tier === "junior" ? 2 : 1)) % ids.length]);
  return out;
}

export class Career {
  constructor(app) { this.app = app; this.ui = app.ui; }
  get data() { return this.app.store.data.career; }
  set data(v) { this.app.store.data.career = v; this.app.store.save(); }
  get active() { return !!this.data; }

  open() {
    if (!this.data) return this.intro();
    this.home();
  }

  // ---------------- starting out ----------------
  intro() {
    const prof = this.app.store.data.profile;
    if (!prof) { this.ui.toast("Create your driver first."); this.app.garageUI.driver(); return; }
    this.ui.screen("career", this.ui.header("Career", "Start at the bottom and work your way up"),
      h("div", { class: "career-cols" },
        h("div", {},
          h("p", {}, `You are ${prof.name}, number ${prof.number}. Four junior teams are willing to give you a seat. The better the team, the better the car — and the higher their expectations.`),
          h("div", { class: "offer-grid" }, JUNIOR_TEAMS.map((t) => h("button", { class: "offer", onclick: () => this.startCareer(t) },
            h("i", { style: { background: t.color } }),
            h("b", {}, t.name),
            h("small", {}, `Car rating ${t.rating} · Objective: finish in the top ${t.rating > 85 ? 3 : t.rating > 75 ? 5 : 8}`),
            h("small", {}, `Salary ${(t.rating * 0.6).toFixed(0)}k per season`))))),
        h("div", { class: "stats-card" }, h("h3", {}, "How career works"),
          h("p", { class: "note" }, "Each season is a set of race weekends. Score points, beat your team mate and meet your objective to earn a better contract. Reach Grand Prix racing, then build your own team if you want to."),
          h("p", { class: "note" }, "Everything is saved on this device after every session."))));
  }

  startCareer(team) {
    const prof = this.app.store.data.profile;
    const d = {
      created: Date.now(), season: 1, tier: "junior", teamId: team.id, team: { ...team },
      contract: { years: 2, salary: Math.round(team.rating * 0.6), objective: team.rating > 85 ? 3 : team.rating > 75 ? 5 : 8 },
      reputation: 20, morale: 60, money: 0, ownTeam: null,
      facilities: { power: 0, aero: 0, grip: 0, reliability: 0 }, staff: [], rnd: null,
      season_: newSeasonState("junior", team.id, this.fieldFor("junior", team.id)),
      history: [], rival: null, teammate: null, format: "short", inbox: [],
      stats: { races: 0, wins: 0, podiums: 0, poles: 0, titles: 0, points: 0 },
    };
    d.teammate = d.season_.drivers.find((x) => x.team === team.id && !x.player) || null;
    d.rival = d.season_.drivers.find((x) => !x.player && x.team !== team.id) || null;
    this.data = d;
    this.home();
  }

  /** the field for a tier: fictional juniors or the Grand Prix drivers */
  fieldFor(tier, myTeamId) {
    if (tier === "gp") {
      const list = DRIVERS.map((x) => ({ id: x.id, name: `${x.first} ${x.last}`, short: driverShort(x), number: x.number, team: x.team, skill: x.skill, personality: x.personality }));
      return list;
    }
    const R = rng(4242);
    const first = ["Alex", "Nico", "Sam", "Theo", "Luca", "Mika", "Juno", "Remy", "Kai", "Ivo", "Noa", "Ilse", "Pia", "Max"];
    const last = ["Brandt", "Varga", "Nilsen", "Duarte", "Ferrero", "Kovac", "Mendez", "Olsen", "Rhodes", "Sato", "Weber", "Yilmaz"];
    const out = [];
    JUNIOR_TEAMS.forEach((t, ti) => {
      for (let k = 0; k < 2; k++) {
        if (t.id === myTeamId && k === 0) continue;
        out.push({ id: `${t.id}-${k}`, name: `${first[(ti * 2 + k) % first.length]} ${last[(ti * 3 + k) % last.length]}`, short: (last[(ti * 3 + k) % last.length]).slice(0, 3).toUpperCase(), number: 10 + ti * 2 + k, team: t.id, skill: 0.9 + (t.rating / 100) * 0.07 + R() * 0.02, personality: ["aggressive", "defensive", "cautious", "consistent"][Math.floor(R() * 4)] });
      }
    });
    return out;
  }

  teamOf(id) { return TEAM_BY_ID[id] || JUNIOR_TEAMS.find((t) => t.id === id) || (this.data && this.data.ownTeam && this.data.ownTeam.id === id ? this.data.ownTeam : null); }

  // ---------------- the career home screen ----------------
  home() {
    const d = this.data, S = d.season_;
    const team = this.teamOf(d.teamId);
    const nextId = S.calendar[S.round];
    const def = nextId ? TRACK_BY_ID[nextId] : null;
    const standings = this.standings();
    const myPos = standings.findIndex((r) => r.player) + 1;
    this.ui.screen("career", this.ui.header(`Season ${d.season} · ${d.tier === "junior" ? "Junior Series" : "Grand Prix"}`, `${team ? team.name : ""} · ${def ? "Round " + (S.round + 1) + " of " + S.calendar.length : "Season complete"}`),
      h("div", { class: "career-cols" },
        h("div", {},
          def ? h("div", { class: "next-event" },
            h("img", { src: trackThumb(def, 320, 200, def.flag), alt: "" }),
            h("div", {},
              h("h3", {}, def.name), h("p", { class: "note" }, def.blurb),
              h("div", { class: "row" },
                this.ui.field("Weekend length", this.ui.select(d.format, Object.values(FORMATS).map((f) => [f.id, f.name]), (v) => { d.format = v; this.app.store.save(); })),
                h("button", { class: "btn primary big", onclick: () => this.startRound() }, "Go racing"),
                h("button", { class: "btn", onclick: () => this.app.garageUI.setupScreen({ trackId: nextId }) }, "Car setup")))) : h("div", { class: "row" }, h("button", { class: "btn primary big", onclick: () => this.endSeason() }, "End the season")),
          h("h3", {}, "Championship"),
          this.standingsTable(standings)),
        h("div", { class: "career-side" },
          h("div", { class: "stats-card" }, h("h3", {}, "You"),
            h("ul", { class: "facts" },
              h("li", {}, "Championship", h("b", {}, myPos ? "P" + myPos : "—")),
              h("li", {}, "Points", h("b", {}, String(S.points))),
              h("li", {}, "Reputation", h("b", {}, Math.round(d.reputation) + "/100")),
              h("li", {}, "Team morale", h("b", {}, Math.round(d.morale) + "/100")),
              h("li", {}, "Contract", h("b", {}, `${d.contract.years} season${d.contract.years === 1 ? "" : "s"} · top ${d.contract.objective}`)),
              h("li", {}, "Budget", h("b", {}, (d.money || 0).toFixed(0) + "k")),
              d.teammate ? h("li", {}, "Team mate", h("b", {}, d.teammate.name)) : null,
              d.rival ? h("li", {}, "Rival", h("b", {}, d.rival.name)) : null)),
          h("div", { class: "stats-card" }, h("h3", {}, "Team"),
            h("ul", { class: "facts" },
              h("li", {}, "Power", h("b", {}, this.barFor(d.facilities.power))),
              h("li", {}, "Aerodynamics", h("b", {}, this.barFor(d.facilities.aero))),
              h("li", {}, "Mechanical grip", h("b", {}, this.barFor(d.facilities.grip))),
              h("li", {}, "Reliability", h("b", {}, this.barFor(d.facilities.reliability)))),
            h("div", { class: "row" },
              h("button", { class: "btn small", onclick: () => this.ui.push(() => this.rndScreen()) }, "Research"),
              h("button", { class: "btn small", onclick: () => this.ui.push(() => this.staffScreen()) }, "Staff"),
              d.tier === "gp" && !d.ownTeam && d.reputation > 70 ? h("button", { class: "btn small", onclick: () => this.ui.push(() => this.ownTeamScreen()) }, "Start my own team") : null)),
          h("div", { class: "stats-card" }, h("h3", {}, "History"),
            d.history.length ? h("ul", { class: "facts" }, d.history.slice(-6).map((x) => h("li", {}, x.label, h("b", {}, x.value)))) : h("p", { class: "note" }, "Your story starts here."),
            h("div", { class: "row" }, h("button", { class: "btn small danger", onclick: () => { if (confirm("Delete this career and start again?")) { this.data = null; this.intro(); } } }, "Delete career"))))));
  }
  barFor(v) { const n = Math.round(clamp(v, 0, 1) * 10); return "█".repeat(n) + "░".repeat(10 - n); }

  standings() {
    const d = this.data, S = d.season_;
    const rows = [{ id: "player", name: this.app.store.data.profile.name, team: d.teamId, points: S.points, player: true }];
    for (const dr of S.drivers) rows.push({ id: dr.id, name: dr.name, team: dr.team, points: (S.standings[dr.id] || 0) });
    rows.sort((a, b) => b.points - a.points);
    return rows;
  }
  standingsTable(rows) {
    return h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", {}, "Pos"), h("th", {}, "Driver"), h("th", {}, "Team"), h("th", {}, "Points"))),
      h("tbody", {}, rows.map((r, k) => {
        const t = this.teamOf(r.team);
        return h("tr", { class: r.player ? "me" : "" }, h("td", {}, String(k + 1)), h("td", {}, h("i", { class: "tc", style: { background: t ? t.color : "#888" } }), " ", r.name), h("td", {}, t ? t.name : ""), h("td", {}, String(r.points)));
      })));
  }

  // ---------------- research and staff ----------------
  rndScreen() {
    const d = this.data;
    const rows = RND.map((r) => {
      const level = d.facilities[r.effect] || 0;
      const inProgress = d.rnd && d.rnd.id === r.id;
      return h("div", { class: "rnd-row" },
        h("b", {}, r.name), h("small", {}, `Level ${this.barFor(level)}`),
        h("small", {}, `${r.cost}k · ready after ${d.tier === "junior" ? 2 : 3} rounds`),
        inProgress ? h("span", { class: "chip on" }, `in progress (${d.rnd.rounds} rounds left)`)
          : h("button", { class: "btn small", disabled: d.money < r.cost || !!d.rnd, onclick: () => { d.money -= r.cost; d.rnd = { id: r.id, rounds: d.tier === "junior" ? 2 : 3, gain: r.gain * (1 + (this.staffGain("aeroRate") || 0)) }; this.app.store.save(); this.rndScreen(); } }, "Start"));
    });
    this.ui.screen("career", this.ui.header("Research and development", `Budget ${(d.money || 0).toFixed(0)}k`),
      h("div", { class: "rnd-list" }, rows),
      h("p", { class: "note" }, "Research improves the car for every race from the moment it is finished. You can run one project at a time. Prize money and sponsor bonuses pay for it."));
  }
  staffGain(key) {
    const d = this.data;
    let t = 0;
    for (const id of d.staff || []) { const s = STAFF.find((x) => x.id === id); if (s && s.gain[key]) t += s.gain[key]; }
    return t;
  }
  staffScreen() {
    const d = this.data;
    const rows = STAFF.map((s) => {
      const hired = (d.staff || []).includes(s.id);
      return h("div", { class: "rnd-row" }, h("b", {}, s.name), h("small", {}, s.effect), h("small", {}, `${s.cost}k`),
        hired ? h("span", { class: "chip on" }, "hired")
          : h("button", { class: "btn small", disabled: d.money < s.cost, onclick: () => { d.money -= s.cost; d.staff = [...(d.staff || []), s.id]; this.app.store.save(); this.staffScreen(); } }, "Hire"));
    });
    this.ui.screen("career", this.ui.header("Staff", `Budget ${(d.money || 0).toFixed(0)}k`), h("div", { class: "rnd-list" }, rows),
      h("p", { class: "note" }, "Staff improve pit stops, strategy and development speed for the rest of your career."));
  }
  ownTeamScreen() {
    const d = this.data;
    const prof = this.app.store.data.profile;
    const name = h("input", { type: "text", value: prof.teamName || "Clanko Racing", maxlength: 24 });
    this.ui.screen("career", this.ui.header("Start your own team", "Your reputation is enough to attract backers"),
      h("div", { class: "setup-opts" },
        this.ui.field("Team name", name),
        h("p", { class: "note" }, "You become an owner-driver: prize money and sponsors go to your team, and every research project is yours. The car starts a little behind the established teams."),
        h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => {
          const L = prof.livery || {};
          d.ownTeam = { id: "own", name: name.value.slice(0, 24) || "Clanko Racing", short: (prof.teamShort || "CLK"), color: L.base || "#ffd23a", color2: L.secondary || "#111", accent: L.accent || "#ff4b3e", pattern: L.pattern || "chevron", sponsor: L.sponsor || "CLANKO100.COM", perf: { power: 0.975, aero: 0.975, grip: 0.98 } };
          d.teamId = "own"; d.contract = { years: 99, salary: 0, objective: 10 }; d.money += 400;
          d.history.push({ label: `Founded ${d.ownTeam.name}`, value: `Season ${d.season}` });
          this.app.store.save(); this.home();
        } }, "Found the team"))));
  }

  // ---------------- running a round ----------------
  startRound() {
    const d = this.data, S = d.season_;
    const trackId = S.calendar[S.round];
    const perf = this.carPerf();
    const cfg = {
      trackId, format: d.format, weather: this.weatherFor(trackId), rules: this.app.store.settings.gameplay.rules,
      damage: this.app.store.settings.gameplay.damage, difficulty: this.difficulty(), aiCount: Math.min(19, S.drivers.length),
      teamId: d.tier === "gp" && TEAM_BY_ID[d.teamId] ? d.teamId : null, perf, career: true,
      fixedDrivers: d.tier === "gp" ? S.drivers.map((x) => x.id) : null,
      seed: 1000 + d.season * 31 + S.round,
    };
    this.app.weekend.start(cfg, (results) => { this.roundDone(results); });
  }
  carPerf() {
    const d = this.data;
    const team = this.teamOf(d.teamId) || { perf: { power: 1, aero: 1, grip: 1 } };
    const f = d.facilities;
    return { power: team.perf.power * (1 + f.power * 0.06), aero: team.perf.aero * (1 + f.aero * 0.06), grip: team.perf.grip * (1 + f.grip * 0.04), reliability: 1 + f.reliability * 0.5 };
  }
  difficulty() { return clamp(this.app.store.settings.gameplay.difficulty, 0.8, 1.03); }
  weatherFor(trackId) {
    const def = TRACK_BY_ID[trackId];
    const R = rng(this.data.season * 100 + this.data.season_.round);
    return R() < (def.rainChance || 0.2) ? (R() < 0.4 ? "wet" : "changing") : "dry";
  }

  /** results of a race inside the career weekend */
  onResults(rc, results) {
    const d = this.data;
    if (!rc.cfg.career || !rc.cfg.session) return;
    if (rc.cfg.session.id === "qualifying") {
      const me = results.find((r) => r.isPlayer);
      if (me && me.position === 1) { d.stats.poles++; d.reputation = clamp(d.reputation + 1.5, 0, 100); }
      return;
    }
    if (rc.cfg.session.id !== "race") return;
    const S = d.season_;
    const me = results.find((r) => r.isPlayer);
    // points for everyone
    results.forEach((r, k) => {
      const pts = r.status !== "DNF" && !r.dq && k < POINTS.length ? POINTS[k] : 0;
      if (r.isPlayer) { S.points += pts; d.stats.points += pts; }
      else S.standings[r.id] = (S.standings[r.id] || 0) + pts;
    });
    if (me) {
      d.stats.races++;
      if (me.position === 1 && me.status === "Finished") { d.stats.wins++; d.reputation = clamp(d.reputation + 8, 0, 100); d.morale = clamp(d.morale + 10, 0, 100); }
      else if (me.position <= 3 && me.status === "Finished") { d.stats.podiums++; d.reputation = clamp(d.reputation + 4, 0, 100); d.morale = clamp(d.morale + 5, 0, 100); }
      else if (me.position <= d.contract.objective) { d.reputation = clamp(d.reputation + 1.5, 0, 100); d.morale = clamp(d.morale + 2, 0, 100); }
      else { d.reputation = clamp(d.reputation - 1, 0, 100); d.morale = clamp(d.morale - 4, 0, 100); }
      // prize money and sponsor bonus
      const prize = Math.max(0, (results.length - me.position + 1)) * (d.tier === "junior" ? 6 : 18) + (me.position === 1 ? 120 : 0);
      d.money = (d.money || 0) + prize + (d.ownTeam ? 90 : 25);
      S.results.push({ round: S.round + 1, trackId: rc.track.id, position: me.position, points: results.indexOf(me) < POINTS.length ? POINTS[results.indexOf(me)] : 0, status: me.status });
    }
    S.round++;
    if (d.rnd) { d.rnd.rounds--; if (d.rnd.rounds <= 0) { const r = RND.find((x) => x.id === d.rnd.id); d.facilities[r.effect] = clamp((d.facilities[r.effect] || 0) + d.rnd.gain * 10, 0, 1); d.inbox.push(`Research complete: ${r.name} improved.`); d.rnd = null; } }
    this.app.store.save();
  }

  afterResults(rc, results) {
    if (rc.cfg.session && rc.cfg.session.id === "race") this.media(results);
    else this.app.weekend.afterResults(rc, results);
  }

  media(results) {
    const d = this.data;
    const me = results.find((r) => r.isPlayer) || {};
    const q = MEDIA[Math.floor(Math.random() * MEDIA.length)];
    this.ui.screen("career", this.ui.header("After the race", "The media want a word"),
      h("div", { class: "career-cols" },
        h("div", {},
          h("p", { class: "res-me" }, me.status === "DNF" ? "You did not finish." : `You finished P${me.position}.`),
          h("h3", {}, q.q),
          h("div", { class: "menu" }, q.a.map(([text, eff]) => h("button", { class: "menu-item", onclick: () => {
            d.reputation = clamp(d.reputation + eff.rep, 0, 100);
            d.morale = clamp(d.morale + eff.morale, 0, 100);
            this.app.store.save();
            this.app.weekend.finish();
            this.home();
          } }, h("b", {}, text))))),
        h("div", { class: "stats-card" }, h("h3", {}, "Season so far"), this.standingsTable(this.standings().slice(0, 8)))));
  }

  roundDone() { this.home(); }

  // ---------------- end of season ----------------
  endSeason() {
    const d = this.data, S = d.season_;
    const standings = this.standings();
    const myPos = standings.findIndex((r) => r.player) + 1;
    const champion = myPos === 1;
    if (champion) { d.stats.titles++; d.reputation = clamp(d.reputation + 15, 0, 100); }
    d.history.push({ label: `Season ${d.season} · ${d.tier === "junior" ? "Junior" : "Grand Prix"}`, value: `P${myPos} · ${S.points} points${champion ? " · CHAMPION" : ""}` });
    // promotion and offers
    const promote = d.tier === "junior" && (champion || myPos <= 2 || d.reputation > 55);
    const offers = this.offersFor(promote ? "gp" : d.tier, myPos, champion);
    this.ui.screen("career", this.ui.header(champion ? "Champion!" : "Season over", `P${myPos} with ${S.points} points`),
      h("div", { class: "career-cols" },
        h("div", {},
          champion ? h("p", { class: "res-me podium" }, `You are the ${d.tier === "junior" ? "Junior Series" : "Grand Prix"} champion of season ${d.season}.`) : null,
          promote ? h("p", {}, "Grand Prix teams have noticed you. Choose where to race next season.") : h("p", {}, "Contract offers for next season:"),
          h("div", { class: "offer-grid" }, offers.map((o) => h("button", { class: "offer", onclick: () => this.signAndContinue(o, promote ? "gp" : d.tier) },
            h("i", { style: { background: o.team.color } }), h("b", {}, o.team.name),
            h("small", {}, `${o.years} season${o.years === 1 ? "" : "s"} · ${o.salary}k · objective: top ${o.objective}`),
            h("small", {}, o.note || ""))))),
        h("div", { class: "stats-card" }, h("h3", {}, "Final standings"), this.standingsTable(standings))));
  }
  offersFor(tier, myPos, champion) {
    const d = this.data;
    const pool = tier === "gp" ? TEAMS.slice() : JUNIOR_TEAMS.slice();
    const rep = d.reputation + (champion ? 20 : 0);
    const out = [];
    for (const t of pool) {
      const strength = tier === "gp" ? t.reputation : t.rating;
      const want = strength - 20 < rep;
      if (!want) continue;
      out.push({ team: t, years: strength > 85 ? 1 : 2, salary: Math.round(strength * (tier === "gp" ? 18 : 0.6)), objective: strength > 85 ? 3 : strength > 70 ? 6 : 10, note: strength > 85 ? "A front-running team — they expect results." : "" });
      if (out.length >= 4) break;
    }
    if (d.ownTeam) out.unshift({ team: d.ownTeam, years: 99, salary: 0, objective: 10, note: "Your own team." });
    if (!out.length) out.push({ team: this.teamOf(d.teamId), years: 1, salary: d.contract.salary, objective: d.contract.objective, note: "Your current team is willing to keep you." });
    return out;
  }
  signAndContinue(offer, tier) {
    const d = this.data;
    d.season++; d.tier = tier;
    d.teamId = offer.team.id;
    if (!TEAM_BY_ID[offer.team.id] && !JUNIOR_TEAMS.find((t) => t.id === offer.team.id) && offer.team.id !== "own") d.ownTeam = offer.team;
    d.contract = { years: offer.years, salary: offer.salary, objective: offer.objective };
    d.money = (d.money || 0) + offer.salary * 0.4;
    d.season_ = newSeasonState(tier, d.teamId, this.fieldFor(tier, d.teamId));
    d.teammate = d.season_.drivers.find((x) => x.team === d.teamId) || null;
    d.rival = d.season_.drivers.find((x) => x.team !== d.teamId) || null;
    this.app.store.save();
    this.home();
  }
}
