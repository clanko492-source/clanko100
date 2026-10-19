// Full AI race: 20 cars, grid start, lights, timing, pit stops, flags. Checks the session runs and finishes sensibly.
import { Track } from "../core/track.js";
import { TRACK_BY_ID } from "../core/tracks-data.js";
import { Session } from "../core/session.js";
import { TEAMS, DRIVERS, TEAM_BY_ID, driverShort } from "../core/teams.js";
import { DT } from "../core/physics.js";
import { fmtTime } from "../core/math.js";

const id = process.argv[2] || "fiorella", laps = +(process.argv[3] || 4), weather = process.argv[4] || "dry", rules = process.argv[5] || "standard";
const track = new Track(TRACK_BY_ID[id]);
const s = new Session({ track, type: "race", laps, rules, damage: "sim", weatherMode: weather, seed: 5, tyreWear: 3 });
DRIVERS.forEach((d, k) => {
  const team = { ...TEAM_BY_ID[d.team], slot: TEAMS.findIndex((t) => t.id === d.team) };
  s.addCar({ id: d.id, name: d.first + " " + d.last, short: driverShort(d), number: d.number, team, perf: team.perf, ai: { skill: d.skill, personality: d.personality, wetSkill: d.wet }, grid: k, compound: weather === "wet" ? "inter" : "medium" });
});
s.start();
const t0 = Date.now();
const counts = {};
let lastPrint = 0;
while (s.phase !== "done" && s.time < laps * 140 + 200) {
  s.step(DT);
  for (const ev of s.drainEvents()) {
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    if (["lightsOut", "chequered", "safetyCar", "vsc", "retire", "penalty", "pitStop", "sessionEnd", "safetyCarIn"].includes(ev.type))
      console.log(`${ev.t.toFixed(1).padStart(7)}s ${ev.type} ${ev.e ? ev.e.short : ""} ${ev.reason || ev.plan?.tyres || ""} ${ev.deployed != null ? ev.deployed : ""}`);
  }
  if (s.time - lastPrint > 60) { lastPrint = s.time; const o = s.order || []; console.log(`  t=${s.time.toFixed(0)} lead ${o[0]?.short} lap ${o[0]?.lap} | ` + o.slice(0, 6).map((e) => `${e.short}+${e.gap.toFixed(1)}`).join(" ")); }
}
const ms = Date.now() - t0;
const res = s.results();
console.log(`\n${id} ${laps} laps ${weather}: sim ${s.time.toFixed(0)} s in ${ms} ms (${(s.time * 1000 / ms).toFixed(1)}x realtime)`);
for (const r of res) console.log(`${String(r.position).padStart(2)} ${r.short} ${r.team.padEnd(20)} laps ${r.laps} ${r.time != null ? fmtTime(r.time) : r.status.padEnd(9)} best ${r.bestLap ? fmtTime(r.bestLap) : "-"} pen ${r.penalty} stops ${r.stops} ${r.dnf || ""} pts ${r.points}`);
console.log(counts);
