// CLANKO GP — car classes, tyre compounds and setup ranges.

export const COMPOUNDS = {
  soft:   { id: "soft",   name: "Soft",         short: "S", color: "#ff3a46", mu: 1.82, opt: [88, 108], wear: 1.55, heat: 1.12, dry: true },
  medium: { id: "medium", name: "Medium",       short: "M", color: "#ffd23a", mu: 1.75, opt: [92, 112], wear: 1.0,  heat: 1.0,  dry: true },
  hard:   { id: "hard",   name: "Hard",         short: "H", color: "#f2f2f2", mu: 1.68, opt: [98, 122], wear: 0.62, heat: 0.88, dry: true },
  inter:  { id: "inter",  name: "Intermediate", short: "I", color: "#38d66b", mu: 1.52, opt: [55, 88],  wear: 1.15, heat: 1.25, dry: false },
  wet:    { id: "wet",    name: "Wet",          short: "W", color: "#2f8cff", mu: 1.40, opt: [42, 72],  wear: 1.05, heat: 1.35, dry: false },
};
export const COMPOUND_LIST = ["soft", "medium", "hard", "inter", "wet"];

// grip multiplier against the amount of standing water (0 dry, 1 very wet)
const WATER = [0, 0.3, 0.6, 1];
const WET_GRIP = {
  soft:   [1, 0.69, 0.53, 0.42],
  medium: [1, 0.69, 0.53, 0.42],
  hard:   [1, 0.68, 0.52, 0.41],
  inter:  [1, 0.92, 0.83, 0.63],
  wet:    [1, 0.94, 0.88, 0.83],
};
export function wetGrip(compound, water) {
  const t = WET_GRIP[compound];
  if (water <= 0) return t[0];
  if (water >= 1) return t[3];
  for (let i = 0; i < 3; i++) if (water <= WATER[i + 1]) {
    const f = (water - WATER[i]) / (WATER[i + 1] - WATER[i]);
    return t[i] + (t[i + 1] - t[i]) * f;
  }
  return t[3];
}
/** best compound for a given amount of water */
export function bestCompoundFor(water) {
  if (water < 0.2) return "medium";
  if (water < 0.66) return "inter";
  return "wet";
}

// Car classes. Power in watts, aero as area coefficients (m^2).
export const CAR_CLASSES = {
  gp: {
    id: "gp", name: "Grand Prix", mass: 798, driver: 0, cgH: 0.27, wheelbase: 3.6, frontWeight: 0.455,
    trackF: 1.6, trackR: 1.55, wheelR: 0.36, inertia: 1150,
    power: 760e3, ersPower: 120e3, ersStore: 4e6, revLimit: 12500, shiftRpm: 11850, idle: 4000,
    gears: [17.0, 14.2, 11.9, 9.95, 8.32, 6.96, 5.82, 4.86], drivetrain: 0.92,
    clBase: 1.5, clFrontPerStep: 0.08, clRearPerStep: 0.1, clFront0: 1.0, clRear0: 1.2, cdBase: 0.72, cdFrontPerStep: 0.022, cdRearPerStep: 0.052,
    drsDrag: 0.17, drsLift: 0.55, maxBrake: 44000, maxSteer: 0.42, fuelMax: 105, fuelRate: 0.03, tyreMu: 1.0,
  },
  junior: {
    id: "junior", name: "Junior Formula", mass: 755, driver: 0, cgH: 0.29, wheelbase: 3.3, frontWeight: 0.45,
    trackF: 1.55, trackR: 1.5, wheelR: 0.34, inertia: 1000,
    power: 455e3, ersPower: 0, ersStore: 0, revLimit: 10500, shiftRpm: 9900, idle: 3500,
    gears: [15.0, 12.1, 10.0, 8.4, 7.1, 6.1], drivetrain: 0.92,
    clBase: 1.0, clFrontPerStep: 0.055, clRearPerStep: 0.07, clFront0: 0.7, clRear0: 0.85, cdBase: 0.66, cdFrontPerStep: 0.018, cdRearPerStep: 0.04,
    drsDrag: 0.12, drsLift: 0.35, maxBrake: 30000, maxSteer: 0.44, fuelMax: 80, fuelRate: 0.022, tyreMu: 0.93,
  },
};

export const SETUP_RANGES = {
  frontWing:  { min: 1, max: 11, step: 1, def: 6,  name: "Front wing",            help: "More wing gives the front more grip in corners but adds drag." },
  rearWing:   { min: 1, max: 11, step: 1, def: 6,  name: "Rear wing",             help: "More wing gives the rear stability and grip but costs top speed." },
  diffOn:     { min: 50, max: 100, step: 5, def: 75, name: "On-throttle differential", help: "Higher locks the rear wheels together: more traction, more understeer on exit." },
  diffOff:    { min: 50, max: 100, step: 5, def: 60, name: "Off-throttle differential", help: "Higher keeps the car stable when you lift, lower helps it turn in." },
  arbFront:   { min: 1, max: 11, step: 1, def: 6,  name: "Front anti-roll bar",   help: "Stiffer front adds understeer and sharper response." },
  arbRear:    { min: 1, max: 11, step: 1, def: 5,  name: "Rear anti-roll bar",    help: "Stiffer rear adds oversteer." },
  rideFront:  { min: 1, max: 11, step: 1, def: 4,  name: "Front ride height",     help: "Lower makes more downforce from the floor, but kerbs upset the car." },
  rideRear:   { min: 1, max: 11, step: 1, def: 5,  name: "Rear ride height",      help: "Lower makes more downforce from the floor, but kerbs upset the car." },
  brakeBias:  { min: 50, max: 70, step: 1, def: 57, name: "Brake bias (front %)", help: "More front bias is stable but locks the fronts. Less makes the rear lively." },
  brakePressure: { min: 80, max: 100, step: 1, def: 100, name: "Brake pressure %", help: "Lower pressure makes lock-ups less likely." },
  pressFront: { min: 21, max: 25, step: 0.2, def: 23, name: "Front tyre pressure (psi)", help: "Lower pressure adds grip but heats and wears the tyre." },
  pressRear:  { min: 19.5, max: 23.5, step: 0.2, def: 21.5, name: "Rear tyre pressure (psi)", help: "Lower pressure adds grip but heats and wears the tyre." },
  camberFront:{ min: -3.5, max: -2.5, step: 0.1, def: -3.0, name: "Front camber (°)", help: "More negative camber adds cornering grip but wears the inside of the tyre." },
  camberRear: { min: -2.0, max: -1.0, step: 0.1, def: -1.5, name: "Rear camber (°)", help: "More negative camber adds cornering grip but wears the inside of the tyre." },
  finalDrive: { min: 1, max: 11, step: 1, def: 6,  name: "Gearing",               help: "Shorter gears accelerate harder, longer gears reach a higher top speed." },
  fuel:       { min: 5, max: 105, step: 1, def: 100, name: "Fuel load (kg)",      help: "Less fuel makes the car lighter, but you must finish the race." },
};
export function defaultSetup() {
  const s = {};
  for (const [k, v] of Object.entries(SETUP_RANGES)) s[k] = v.def;
  return s;
}
/** a sensible setup for a circuit's character */
export function trackSetup(track) {
  const s = defaultSetup();
  const id = track.def ? track.def.id : track.id;
  const low = { fiorella: 2, neon: 3, sandhaven: 5, boisnoir: 4 }, high = { portolume: 11, marina: 10, lakeside: 8, lago: 7, kirin: 7 };
  const w = low[id] || high[id] || 6;
  s.frontWing = Math.min(11, w + 1); s.rearWing = w;
  if (low[id]) s.finalDrive = 8;
  if (high[id] >= 10) { s.finalDrive = 4; s.rideFront = 6; s.rideRear = 7; }
  return s;
}

export const ERS_MODES = [
  { id: "none", name: "None", deploy: 0, harvest: 1.2 },
  { id: "medium", name: "Medium", deploy: 0.55, harvest: 1.0 },
  { id: "hotlap", name: "Hotlap", deploy: 1.0, harvest: 0.8 },
  { id: "overtake", name: "Overtake", deploy: 1.0, harvest: 0.5 },
];
export const FUEL_MIXES = [
  { id: "lean", name: "Lean", power: 0.965, use: 0.84 },
  { id: "standard", name: "Standard", power: 1.0, use: 1.0 },
  { id: "rich", name: "Rich", power: 1.018, use: 1.12 },
];
