// CLANKO GP — settings and saved data (localStorage with versioning and safe fallbacks).

const KEY = "clankogp.v1";
export const SAVE_VERSION = 3;

export const DEFAULT_SETTINGS = {
  graphics: { quality: "auto", autoScale: true, targetFps: 60, fov: 62, cockpitFov: 76, showFps: false, motionBlur: false, mirrors: true, hudMirror: true },
  audio: { master: 0.8, engine: 0.9, effects: 0.8, ambience: 0.6, radio: 1.0, commentary: 0.8, voice: true, subtitles: true, commentaryOn: true },
  controls: { kbSteerRate: 3.2, kbReturnRate: 5.5, kbSpeedSens: 1, padDeadzone: 0.08, padLinearity: 1.6, padSpeedSens: 0.7, padEnabled: true, rumble: true, keys: {}, pad: {}, wheel: { enabled: false, rotation: 360, carLockDeg: 180, steerAxis: 0, throttle: { axis: 2 }, brake: { axis: 3 } } },
  assists: { abs: true, tc: 1, autoGear: true, stability: false, brakingLine: false, autoPit: true, steeringAssist: false },
  hud: { show: true, scale: 1, tower: true, map: true, tyres: true, inputs: true, delta: true, mirror: true, opacity: 1, units: "kmh" },
  gameplay: { rules: "standard", damage: "reduced", difficulty: 0.95, camera: "chase", laps: 5, weather: "dry", ghost: true, tyreWear: 1, fuelUse: 1 },
  accessibility: { colourblind: "off", reduceMotion: false, highContrast: false, largeText: false, shakeAmount: 1, flashes: true },
  debug: false,
  onlineBroker: null,   // null = the public signalling broker; set to your own ws:// or wss:// URL
};

function deepMerge(base, over) {
  if (!over || typeof over !== "object") return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over)) {
    if (base && typeof base[k] === "object" && base[k] && !Array.isArray(base[k])) out[k] = deepMerge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

function read() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; } catch { return false; }
}

/** the whole saved state: settings, profile, garage, career, records */
export class Store {
  constructor() {
    const d = read() || {};
    this.data = {
      version: SAVE_VERSION,
      settings: deepMerge(DEFAULT_SETTINGS, d.settings),
      profile: d.profile || null,          // the player's driver
      garage: d.garage || { liveries: [], setups: {}, cars: [] },
      career: d.career || null,
      records: d.records || {},            // best laps per track
      ghosts: d.ghosts || {},              // compressed ghost laps per track
      replays: d.replays || [],
      achievements: d.achievements || {},
      stats: d.stats || { races: 0, wins: 0, podiums: 0, poles: 0, laps: 0, km: 0 },
      friends: d.friends || [],
    };
    if ((d.version || 0) < SAVE_VERSION) this.migrate(d.version || 0);
    this.ok = write(this.data);
  }
  migrate(from) {
    // older saves: keep what can be kept
    if (from < 3 && this.data.ghosts) for (const k of Object.keys(this.data.ghosts)) if (!this.data.ghosts[k].v) delete this.data.ghosts[k];
    this.data.version = SAVE_VERSION;
  }
  get settings() { return this.data.settings; }
  save() { this.ok = write(this.data); return this.ok; }
  exportAll() { return btoa(unescape(encodeURIComponent(JSON.stringify(this.data)))); }
  importAll(text) {
    const obj = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
    if (!obj || typeof obj !== "object" || !obj.settings) throw new Error("That is not a CLANKO GP save.");
    this.data = { ...this.data, ...obj, settings: deepMerge(DEFAULT_SETTINGS, obj.settings) };
    this.migrate(obj.version || 0);
    return this.save();
  }
  reset() { try { localStorage.removeItem(KEY); } catch {} this.data = new Store().data; }
}
