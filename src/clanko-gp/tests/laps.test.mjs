// Every circuit: one AI car must drive clean, complete laps with plausible times.
import { Track } from "../core/track.js";
import { TRACKS } from "../core/tracks-data.js";
import { Car, DT } from "../core/physics.js";
import { AIDriver } from "../core/ai.js";
import { computeRacingLine, lineCurvature, speedProfile, planParams } from "../core/racingline.js";
import { resolveBarriers } from "../core/collide.js";
import { fmtTime } from "../core/math.js";

const only = process.argv[2];
const out = [];
let fails = 0;
for (const def of TRACKS) {
  if (only && def.id !== only) continue;
  const t0 = Date.now();
  const track = new Track(def);
  const v = track.validate();
  const line = computeRacingLine(track);
  const k = lineCurvature(track, line);
  const car = new Car({ cls: "gp", setup: { fuel: 40 }, assists: { autoGear: true, tc: 1, abs: true } });
  const prof = speedProfile(track, line, k, planParams(car));
  const g = track.grid[0];
  car.placeOnTrack(track, g.s, g.d);
  for (const w of car.wheels) { w.temp = 95; w.core = 90; }
  const e = { car, profile: prof };
  const ai = new AIDriver(e, { skill: 1.0, consistency: 1 });
  const ctx = { track, line, profile: prof, time: 0, racing: true };
  let t = 0, lastS = car.q.s, laps = [], lapStart = null, walls = 0, maxImpact = 0, offT = 0, maxOff = 0, resets = 0;
  const events = [];
  while (t < 400 && laps.length < 3) {
    ctx.time = t;
    const inp = ai.update(DT, ctx);
    car.step(DT, inp, { track, trackTemp: 35, water: () => 0 });
    const imp = resolveBarriers(car, track, events);
    if (imp > 1) { walls++; maxImpact = Math.max(maxImpact, imp); }
    if (ai.wantReset) { resets++; ai.wantReset = false; const s = car.q.s - 20; car.placeOnTrack(track, s, track.layout ? 0 : 0); }
    const s = car.q.s;
    if (lastS > track.length - 60 && s < 60) { if (lapStart != null) laps.push(t - lapStart); lapStart = t; }
    lastS = s;
    const ex = Math.abs(car.q.d) - track.hw[car.q.i];
    if (ex > 0.3) { offT += DT; maxOff = Math.max(maxOff, ex); }
    t += DT;
  }
  const best = Math.min(...laps);
  const avgKmh = track.length / best * 3.6;
  const ok = laps.length >= 2 && resets === 0 && walls === 0 && avgKmh > 140 && avgKmh < 260;
  if (!ok) fails++;
  out.push(`${ok ? "PASS" : "FAIL"} ${def.id.padEnd(10)} ${(track.length / 1000).toFixed(2)} km  laps ${laps.map((x) => fmtTime(x)).join(" ")}  avg ${avgKmh.toFixed(0)} km/h  walls ${walls}${walls ? " (max " + maxImpact.toFixed(1) + " m/s)" : ""}  off-track ${offT.toFixed(1)} s (max ${maxOff.toFixed(1)} m)  resets ${resets}  minR ${v.minRadius.toFixed(0)} m  pit ${track.pit.side ? "R" : "L"} free ${track.pit.free.toFixed(0)}  drs ${track.drs.length}  ${v.problems.join("; ")}  [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
  console.log(out[out.length - 1]);
}
process.exitCode = fails ? 1 : 0;
