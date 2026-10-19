// CLANKO GP — team radio and commentary. Messages are queued by priority, shown as subtitles and
// (optionally) spoken with the browser's own text-to-speech voices. No recorded real voices are used.

import { fmtTime, fmtGap, clamp } from "../core/math.js";
import { COMPOUNDS } from "../core/car-specs.js";

export const PRIORITY = { CRITICAL: 3, HIGH: 2, NORMAL: 1, LOW: 0 };

const ENGINEER_STYLES = {
  calm: { name: "Sam", rate: 1.0, pitch: 0.95, pick: 0 },
  energetic: { name: "Alex", rate: 1.12, pitch: 1.08, pick: 1 },
  dry: { name: "Jordan", rate: 0.96, pitch: 0.9, pick: 2 },
};

export class Radio {
  constructor({ hud, settings, engineer = "calm", onSpeak } = {}) {
    this.hud = hud; this.settings = settings || {};
    this.style = ENGINEER_STYLES[engineer] || ENGINEER_STYLES.calm;
    this.queue = [];
    this.busyUntil = 0;
    this.cool = new Map();
    this.onSpeak = onSpeak;
    this.synth = typeof window !== "undefined" && window.speechSynthesis ? window.speechSynthesis : null;
    this.voices = [];
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices().filter((v) => /^en/i.test(v.lang)); };
      load(); this.synth.onvoiceschanged = load;
    }
    this.log = [];
  }
  /** say something. key: cooldown group; cool: seconds before the same group may speak again */
  say(text, { priority = PRIORITY.NORMAL, key = null, cool = 0, who = "ENGINEER", channel = "radio" } = {}) {
    const now = performance.now() / 1000;
    if (key && this.cool.has(key) && now < this.cool.get(key)) return false;
    if (key && cool) this.cool.set(key, now + cool);
    // low priority chatter is dropped when the queue is busy
    if (priority === PRIORITY.LOW && this.queue.length > 1) return false;
    this.queue.push({ text, priority, who, channel, t: now });
    this.queue.sort((a, b) => b.priority - a.priority || a.t - b.t);
    if (this.queue.length > 6) this.queue.length = 6;
    return true;
  }
  update() {
    const now = performance.now() / 1000;
    if (now < this.busyUntil || !this.queue.length) {
      // a critical message may cut in
      if (this.queue.length && this.queue[0].priority === PRIORITY.CRITICAL && this.current && this.current.priority < PRIORITY.CRITICAL) { this.synth && this.synth.cancel(); this.busyUntil = 0; }
      else return;
    }
    const m = this.queue.shift();
    // stale non-critical messages are skipped
    if (m.priority < PRIORITY.HIGH && now - m.t > 6) return;
    this.current = m;
    const dur = clamp(1.2 + m.text.length * 0.06, 2, 8);
    this.busyUntil = now + dur;
    this.log.push({ who: m.who, text: m.text, t: now });
    if (this.log.length > 50) this.log.shift();
    if (this.settings.subtitles !== false && this.hud) this.hud.subtitle(m.text, m.who, dur * 1000 + 600);
    const vol = (this.settings.master ?? 0.8) * (m.channel === "commentary" ? this.settings.commentary ?? 0.8 : this.settings.radio ?? 1);
    const muted = m.channel === "commentary" ? this.settings.commentaryOn === false : false;
    if (this.synth && this.settings.voice !== false && vol > 0.02 && !muted) {
      try {
        const u = new SpeechSynthesisUtterance(m.text);
        const v = this.voices.length ? this.voices[(this.style.pick + (m.channel === "commentary" ? 1 : 0)) % this.voices.length] : null;
        if (v) u.voice = v;
        u.rate = m.channel === "commentary" ? 1.08 : this.style.rate; u.pitch = m.channel === "commentary" ? 1.0 : this.style.pitch; u.volume = clamp(vol, 0, 1);
        this.synth.speak(u);
      } catch {}
    }
    this.onSpeak && this.onSpeak(m);
  }
  stop() { this.queue = []; if (this.synth) try { this.synth.cancel(); } catch {} }

  // ---------- what the engineer says about session events ----------
  react(ev, me, session) {
    const S = session, P = PRIORITY;
    const mine = ev.e === me;
    switch (ev.type) {
      case "lightsOut": if (S.isRace) this.say("Lights out. Go, go, go!", { priority: P.HIGH, key: "start" }); break;
      case "safetyCar": this.say(ev.deployed ? "Safety car, safety car. Slow down, no overtaking." : "Safety car is in this lap. Get ready for the restart.", { priority: P.CRITICAL, key: "sc" + ev.deployed, cool: 5 }); break;
      case "safetyCarIn": this.say("Safety car in this lap. Keep the tyres warm.", { priority: P.HIGH, key: "scin", cool: 10 }); break;
      case "vsc": this.say(ev.deployed ? "Virtual safety car. Stay above the delta." : "VSC ending. Green, green, green!", { priority: P.CRITICAL, key: "vsc" + ev.deployed, cool: 5 }); break;
      case "penalty": if (mine) this.say(`We have a ${ev.seconds} second penalty: ${ev.reason.toLowerCase()}.`, { priority: P.HIGH, key: "pen", cool: 3 }); break;
      case "trackLimits": if (mine) this.say(ev.count >= 3 ? `Track limits warning number ${ev.count}. Next one is a penalty.` : "Careful with track limits.", { priority: P.NORMAL, key: "tl", cool: 6 }); break;
      case "lapInvalid": if (mine) this.say(ev.reason === "Reset" ? "Lap deleted after the reset." : "That lap is deleted, track limits.", { priority: P.LOW, key: "inv", cool: 8 }); break;
      case "partBroken": if (mine) this.say(ev.part.startsWith("wheel") ? "We've lost a wheel. Stop the car safely." : ev.part === "rw" ? "Rear wing is gone. Box, box." : "Front wing damage. Box this lap for a new nose.", { priority: P.CRITICAL, key: "dmg", cool: 4 }); break;
      case "retire": if (mine) this.say("That's it, retire the car. Sorry mate.", { priority: P.CRITICAL }); else this.say(`${ev.e.name} is out of the race.`, { priority: P.LOW, key: "ret", cool: 10, who: "COMMENTARY", channel: "commentary" }); break;
      case "pitService": if (mine) this.say(`Good stop. ${COMPOUNDS[ev.to].name} tyres on.${ev.served ? " Penalty served." : ""}`, { priority: P.NORMAL }); break;
      case "pitRequest": if (mine) this.say(`Copy. Box this lap for ${COMPOUNDS[ev.plan.tyres].name}s.`, { priority: P.HIGH, key: "box", cool: 2 }); break;
      case "drsEnabled": if (mine) this.say("DRS enabled.", { priority: P.LOW, key: "drs", cool: 25 }); break;
      case "blueFlag": if (mine) this.say("Blue flags, let the leaders through.", { priority: P.HIGH, key: "blue", cool: 15 }); break;
      case "jumpStart": if (mine) this.say("Jump start. We'll get a penalty for that.", { priority: P.HIGH }); break;
      case "chequered": if (S.isRace) this.say(ev.e === me ? "Chequered flag! You've won it! Brilliant drive!" : "Chequered flag. Bring it home.", { priority: P.HIGH, key: "cheq" }); break;
      case "finish": if (mine && S.isRace) { const p = ev.position; this.say(p === 1 ? "P1! What a race!" : p <= 3 ? `P${p}, that's a podium! Great job.` : p <= 10 ? `P${p}. Points today, well done.` : `P${p}. We'll come back stronger.`, { priority: P.HIGH, key: "fin" }); } break;
      case "lap":
        if (mine) {
          if (!S.isRace) { if (ev.valid && ev.pb) this.say(`${fmtTime(ev.time)}. ${ev.fastest ? "Fastest of anyone!" : "Personal best."}`, { priority: P.LOW, key: "lapt", cool: 10 }); }
          else {
            const lapsLeft = S.laps - ev.lap;
            const ahead = S.order ? S.order[me.position - 2] : null;
            if (lapsLeft === 1) this.say("Final lap. Bring it home.", { priority: P.NORMAL, key: "final" });
            else if (ahead && me.interval < 1.2) this.say(`Gap to ${ahead.name.split(" ").pop()} is ${me.interval.toFixed(1)}. You have DRS chances.`, { priority: P.LOW, key: "gap", cool: 40 });
            else if (lapsLeft > 1 && Math.random() < 0.3) this.say(`P${me.position}, ${lapsLeft} laps to go.`, { priority: P.LOW, key: "laps", cool: 60 });
          }
        } else if (ev.fastest && S.entities.length > 1) this.say(`Fastest lap for ${ev.e.name}, ${fmtTime(ev.time)}.`, { priority: P.LOW, key: "fl", cool: 30, who: "COMMENTARY", channel: "commentary" });
        break;
      case "overtake":
        if (mine) this.say(`Great move! P${ev.position}.`, { priority: P.LOW, key: "ovt", cool: 12 });
        else if (ev.other === me) this.say(`${ev.e.name.split(" ").pop()} is past. Stay with them.`, { priority: P.LOW, key: "lost", cool: 15 });
        else if (ev.position <= 3) this.say(`${ev.e.name} takes P${ev.position}!`, { priority: P.LOW, key: "ovtc", cool: 20, who: "COMMENTARY", channel: "commentary" });
        break;
      case "hitWall": if (mine && ev.speed > 12) this.say("Are you OK? Check the car for damage.", { priority: P.HIGH, key: "crash", cool: 8 }); break;
      case "rainStart": this.say("Rain is starting. Watch for the intermediates call.", { priority: P.HIGH, key: "rain", cool: 60 }); break;
    }
  }
  /** questions the player can ask from the radio menu */
  answer(q, me, session) {
    const S = session, c = me.car;
    switch (q) {
      case "tyres": {
        let wear = 0, temp = 0; for (const w of c.wheels) { wear = Math.max(wear, w.wear); temp += w.temp / 4; }
        const comp = COMPOUNDS[c.compound];
        const state = wear > 0.7 ? "they're finished, box soon" : wear > 0.45 ? "they're starting to go off" : "they look fine";
        const tState = temp < comp.opt[0] ? "a bit cold" : temp > comp.opt[1] ? "running hot" : "in the window";
        this.say(`${comp.name}s, ${Math.round((1 - wear) * 100)} percent left, ${state}. Temperatures are ${tState}.`, { priority: PRIORITY.NORMAL }); break;
      }
      case "gap": {
        const ahead = S.order ? S.order[me.position - 2] : null, behind = S.order ? S.order[me.position] : null;
        const a = ahead ? `${me.interval.toFixed(1)} to ${ahead.name.split(" ").pop()} ahead` : "You're leading";
        const b = behind ? `, ${behind.interval.toFixed(1)} to ${behind.name.split(" ").pop()} behind` : "";
        this.say(`P${me.position}. ${a}${b}.`, { priority: PRIORITY.NORMAL }); break;
      }
      case "weather": {
        const f = S.weather.forecast();
        const now = S.weather.rain, later = f[2].rain;
        const txt = now > 0.05 ? (later < now * 0.5 ? "Rain should ease in about ten minutes." : "Rain looks like it will stay.") : later > 0.1 ? `Rain expected in around ${f.findIndex((x) => x.rain > 0.1) * 5} minutes.` : "No rain expected.";
        this.say(`${txt} Track is ${Math.round(S.weather.trackTemp)} degrees.`, { priority: PRIORITY.NORMAL }); break;
      }
      case "fuel": {
        const perLap = me.lap > 0 ? (me._fuelStart - c.fuel) / me.lap : null;
        const left = S.isRace ? S.laps - me.lap : null;
        if (perLap && left) { const need = perLap * left; this.say(need > c.fuel ? `We're ${(need - c.fuel).toFixed(1)} kilos short. Use lean mix.` : `Fuel is fine, ${(c.fuel - need).toFixed(1)} kilos spare.`, { priority: PRIORITY.NORMAL }); }
        else this.say(`${c.fuel.toFixed(1)} kilos of fuel on board.`, { priority: PRIORITY.NORMAL });
        break;
      }
    }
  }
}
