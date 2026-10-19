// Straight-line and cornering checks for the car model.
import { Track } from "../core/track.js";
import { TRACKS } from "../core/tracks-data.js";
import { Car, DT } from "../core/physics.js";
import { kmh } from "../core/math.js";

const results = [];
const check = (name, ok, info) => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${info ?? ""}`); };

const drag = new Track({ id: "dragstrip", name: "test", width: 16, runoff: 20, path: [["S", 3000, { fixed: true }], ["R", 180, 120], ["S", 3000], ["R", 180, 120]] });
const env = { track: drag, trackTemp: 35, water: () => 0 };
const car = new Car({ cls: "gp", setup: { fuel: 50, finalDrive: 6 }, assists: { autoGear: true, tc: 2 } });
car.placeOnTrack(drag, -1700, 0);
for (const w of car.wheels) { w.temp = 100; w.core = 95; }
let t = 0, t100 = null, t200 = null, t300 = null, vmax = 0;
const inp = { steer: 0, throttle: 1, brake: 0 };
while (t < 30) {
  // keep it straight with a tiny steering correction
  inp.steer = Math.max(-0.2, Math.min(0.2, -car.q.d * 0.05 - (car.h - drag.heading[car.q.i]) * 2));
  car.step(DT, inp, env); t += DT;
  const v = kmh(car.u); vmax = Math.max(vmax, v);
  if (t100 == null && v >= 100) t100 = t;
  if (t200 == null && v >= 200) t200 = t;
  if (t300 == null && v >= 300) t300 = t;
  if (car.q.s > 1200 && car.q.s < 1300) break;
}
check("0-100 km/h between 2.2 and 3.4 s", t100 > 2.2 && t100 < 3.4, `${t100?.toFixed(2)} s`);
check("0-200 km/h between 4.2 and 6.5 s", t200 > 4.2 && t200 < 6.5, `${t200?.toFixed(2)} s`);
check("reaches 300 km/h", t300 != null, `${t300?.toFixed(2)} s, top so far ${vmax.toFixed(0)} km/h`);

// braking from current speed
const v0 = kmh(car.u); const s0 = car.distance; let tb = 0;
inp.throttle = 0; inp.brake = 1;
car.assists.abs = true;
while (kmh(car.u) > 80 && tb < 10) { inp.steer = Math.max(-0.2, Math.min(0.2, -car.q.d * 0.05 - (car.h - drag.heading[car.q.i]) * 2)); car.step(DT, inp, env); tb += DT; }
const bd = car.distance - s0;
check(`braking ${v0.toFixed(0)}->80 km/h under 150 m`, bd < 150 && bd > 50, `${bd.toFixed(1)} m in ${tb.toFixed(2)} s, peak decel ~${((v0 - 80) / 3.6 / tb / 9.81).toFixed(1)} g avg`);

// top speed on a long run
const car2 = new Car({ cls: "gp", setup: { fuel: 50, frontWing: 3, rearWing: 2, finalDrive: 6 } });
car2.placeOnTrack(drag, -1500, 0, { speed: 60 });
for (const w of car2.wheels) { w.temp = 100; w.core = 95; }
let top = 0; inp.throttle = 1; inp.brake = 0;
for (let k = 0; k < 240 * 40; k++) {
  inp.steer = Math.max(-0.2, Math.min(0.2, -car2.q.d * 0.05 - (car2.h - drag.heading[car2.q.i]) * 2));
  car2.step(DT, inp, env); top = Math.max(top, kmh(car2.u));
  if (car2.q.s > 1300 && car2.q.s < 1400) break;
}
check("top speed (low wing) 320-365 km/h", top > 320 && top < 365, `${top.toFixed(0)} km/h`);

// steady cornering on the 120 m bend: find max speed holding the line
function cornerTest(speed) {
  const c = new Car({ cls: "gp", setup: { fuel: 50 } });
  c.placeOnTrack(drag, 3000 - 1700 + 30, 0, { speed });
  for (const w of c.wheels) { w.temp = 100; w.core = 95; }
  let maxD = 0, ok = true;
  for (let k = 0; k < 240 * 6; k++) {
    const i = c.q.i, aheadI = drag.wrap(i + 8);
    const tx = drag.x[aheadI], tz = drag.z[aheadI];
    const ang = Math.atan2(tz - c.z, tx - c.x);
    let err = ang - c.h; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    const st = err * 3 - c.r * 0.15;
    const thr = Math.max(0, Math.min(1, (speed - c.u) * 0.3 + 0.35));
    c.step(DT, { steer: Math.max(-1, Math.min(1, st)), throttle: thr, brake: 0 }, { track: drag, trackTemp: 35, water: () => 0 });
    maxD = Math.max(maxD, Math.abs(c.q.d));
  }
  return { maxD, lat: c.ayF / 9.81 };
}
let best = 0;
for (let v = 40; v <= 90; v += 2) { const r = cornerTest(v); if (r.maxD < 6) best = v; }
const lat = (best * best) / 120 / 9.81;
check("fastest steady speed on a 120 m bend 50-80 m/s", best >= 50 && best <= 80, `${(best * 3.6).toFixed(0)} km/h (~${lat.toFixed(1)} g)`);

console.log(results.join("\n"));
