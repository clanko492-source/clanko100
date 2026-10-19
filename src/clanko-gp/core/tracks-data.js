// CLANKO GP — the circuits. All original layouts. Each is a list of straights (S) and corners
// (R = right, L = left, angle in degrees, radius in metres). The layout builder closes every loop
// exactly, smooths the bends and applies the height keys (y = height in metres at the end of a piece).

const S = (len, o) => ["S", len, o || {}];
const R = (deg, r, o) => ["R", deg, r, o || {}];
const L = (deg, r, o) => ["L", deg, r, o || {}];
const MAIN = (len, o) => ["S", len, { fixed: true, ...(o || {}) }];
const FX = (len, o) => ["S", len, { fixed: true, ...(o || {}) }];

export const TRACKS = [
  {
    id: "fiorella", name: "Autodromo Fiorella", place: "Fiorella Park", flag: "#1f8a4c",
    blurb: "Temple of speed. Long straights, heavy braking into tight chicanes and a sweeping final curve.",
    character: "Low downforce, top speed and late braking", theme: "parkland",
    width: 14, scale: 1.35, runoff: 16, runoffStyle: "gravel", time: 14.5, rainChance: 0.15, laps: 53,
    path: [
      MAIN(700), R(85, 20), FX(12), L(80, 22), S(200),
      R(85, 260), S(300), L(45, 25), FX(8), R(45, 25), S(250, { y: 2 }),
      R(90, 70, { y: 3 }), S(120), R(30, 80), S(450, { y: 1 }),
      L(40, 70), R(80, 80), L(40, 130), S(600, { y: 0 }), R(150, 95),
    ],
  },
  {
    id: "ashford", name: "Ashford Park", place: "Ashford Airfield", flag: "#2b6fd6",
    blurb: "A fast former airfield. Flat-out sweepers and a flowing set of esses reward commitment.",
    character: "High-speed corners and changeable weather", theme: "airfield",
    width: 15, runoff: 22, runoffStyle: "asphalt", time: 13, rainChance: 0.35, laps: 52, clouds: 0.55,
    path: [
      MAIN(450), R(60, 160), S(120), L(20, 250), S(150), R(75, 30), L(110, 22), S(60), L(40, 60),
      S(650), L(70, 45), S(60), R(150, 55), S(200), R(25, 300), S(300), R(100, 140, { y: 1 }),
      S(220), L(35, 160), R(55, 85, { y: 3 }), L(60, 70), R(30, 150, { y: 2 }),
      S(800, { y: 0 }), R(95, 120), S(300), L(50, 35), R(155, 45),
    ],
  },
  {
    id: "boisnoir", name: "Bois-Noir Circuit", place: "Bois-Noir Forest", flag: "#c9a227",
    blurb: "A long ride through the forest with a plunge into a compression and a brutal climb out of it.",
    character: "Big elevation changes and flowing high-speed turns", theme: "forest",
    width: 14, runoff: 18, runoffStyle: "gravel", time: 12.5, rainChance: 0.45, laps: 44, clouds: 0.6,
    path: [
      MAIN(480, { y: 0 }), R(165, 20, { y: -2 }), S(350, { y: -30 }), L(30, 80, { y: -32 }), R(60, 100, { y: -20 }), L(25, 150, { y: -10 }),
      S(950, { y: 18 }), R(75, 35, { y: 22 }), FX(50), L(60, 40, { y: 22 }), S(150), R(55, 80, { y: 14 }), S(300, { y: 2 }),
      R(130, 30, { y: -4 }), S(250, { y: -18 }), L(100, 110, { y: -32 }), S(250, { y: -36 }), R(45, 60), L(35, 70, { y: -38 }),
      S(300, { y: -34 }), R(75, 60, { y: -30 }), S(80), R(55, 140, { y: -26 }), S(700, { y: -14 }), L(40, 320, { y: -10 }), S(350, { y: -4 }),
      R(75, 22, { y: -2 }), FX(10), L(85, 22, { y: 0 }),
    ],
  },
  {
    id: "portolume", name: "Porto Lume Street Circuit", place: "Porto Lume Harbour", flag: "#d6293f",
    blurb: "Barriers inches away, a hairpin you can almost touch and a tunnel by the sea. One mistake ends your race.",
    character: "Tight street circuit, maximum downforce, no room for error", theme: "harbour",
    width: 11, scale: 1.5, street: true, runoff: 2, runoffStyle: "street", time: 15, rainChance: 0.15, laps: 78,
    path: [
      MAIN(400, { y: 0 }), R(90, 18), S(300, { y: 28 }), L(15, 300), L(60, 40), R(85, 30, { y: 32 }),
      S(120, { y: 22 }), R(100, 16), S(70), L(175, 11, { y: 12 }), S(60), R(80, 18), S(60), R(75, 22, { y: 3 }),
      R(60, 200, { tunnel: true }), S(200, { tunnel: true }), L(40, 20), R(55, 20), S(120), L(50, 45, { y: 0 }),
      S(60), L(40, 30), R(45, 30), S(60), R(40, 25), L(35, 25), S(80), R(100, 14), S(40), R(45, 20),
    ],
  },
  {
    id: "kirin", name: "Kirin Hills Circuit", place: "Kirin Hills", flag: "#e8e8e8",
    blurb: "A figure of eight that crosses itself on a bridge. Rhythmic esses, a hairpin and a fearsome fast left.",
    character: "Technical esses and a crossover bridge", theme: "hills",
    width: 14, figure8: true, runoff: 16, runoffStyle: "gravel", time: 14, rainChance: 0.3, laps: 53,
    path: [
      MAIN(650, { y: 0 }), R(75, 80), R(70, 40, { y: -6 }), S(100), L(50, 70), R(55, 70, { y: -2 }), L(55, 70), R(50, 75, { y: 2 }),
      L(70, 110, { y: 6 }), S(200, { y: 9 }), R(45, 70), FX(50), R(80, 40, { y: 7 }), S(150, { y: 7 }), R(25, 300, { y: 10 }),
      S(400, { bridge: true, y: 10 }), L(170, 16, { y: 6 }), S(300, { y: 4 }), R(70, 200, { y: 4 }), S(100, { y: 3 }),
      L(120, 70, { y: 2 }), S(100), L(105, 120, { y: 1 }), S(300, { y: 0 }), R(75, 20), L(20, 60), S(600, { y: 0 }), R(45, 250, { y: 0 }),
    ],
  },
  {
    id: "sandhaven", name: "Sandhaven Night Circuit", place: "Sandhaven Desert", flag: "#b0172e",
    blurb: "Racing under floodlights in the desert. Long straights end in heavy stops, so brakes and tyres take a beating.",
    character: "Night race, heavy braking and traction zones", theme: "desert", night: true,
    width: 15, scale: 1.1, runoff: 22, runoffStyle: "asphalt", time: 21, rainChance: 0.03, laps: 57,
    path: [
      MAIN(1000, { y: 0 }), R(110, 20), S(40), L(30, 50), R(40, 120, { y: 2 }), S(600, { y: 4 }), R(95, 35),
      S(150), L(30, 80), R(45, 70), L(35, 60, { y: 6 }), S(200), R(170, 18, { y: 3 }), S(250), L(40, 60), S(100), L(100, 30, { y: 0 }),
      S(500, { y: -2 }), L(70, 70), S(120), R(90, 180, { y: 0 }), S(150), R(100, 40), S(300), R(15, 300),
    ],
  },
  {
    id: "marina", name: "Marina Lights Street Circuit", place: "Marina Bay", flag: "#ff4b6e",
    blurb: "A long, humid night among skyscrapers. Ninety-degree corners one after another test your concentration.",
    character: "Night street circuit, stop-start corners", theme: "city", night: true,
    width: 12, scale: 1.25, street: true, runoff: 4, runoffStyle: "street", time: 20.5, rainChance: 0.3, laps: 62,
    path: [
      MAIN(500), L(85, 28), S(60), R(90, 25), S(250), R(90, 22), S(300), L(90, 24), S(200), R(90, 20), S(450), R(90, 26),
      S(120), L(90, 22), S(150), R(90, 22), S(350), R(80, 30), S(100), L(45, 40), R(45, 40), S(200), R(95, 25), S(150), L(50, 30), R(50, 22),
    ],
  },
  {
    id: "neon", name: "Neon Boulevard Circuit", place: "Neon City", flag: "#a65bff",
    blurb: "Two enormous straights past glowing casinos. Slipstream, brake late, repeat.",
    character: "Night street circuit with huge straights", theme: "neon", night: true,
    width: 15, street: true, runoff: 6, runoffStyle: "street", time: 22, rainChance: 0.05, laps: 50,
    path: [
      MAIN(700), L(90, 30), S(80), R(40, 60), L(60, 40), L(40, 120), S(1600), L(90, 30), S(300), L(75, 40), FX(1600), L(45, 60),
    ],
  },
  {
    id: "lago", name: "Lago Verde Circuit", place: "Lago Verde", flag: "#19a65b",
    blurb: "An anticlockwise bowl with a plunging first corner, a twisty infield and a long uphill drag to the line.",
    character: "Anticlockwise, elevation and overtaking chances", theme: "tropical",
    width: 14, scale: 1.2, runoff: 16, runoffStyle: "asphalt", time: 15.5, rainChance: 0.4, laps: 71, clouds: 0.5,
    path: [
      MAIN(600, { y: 8 }), L(80, 40, { y: 4 }), R(70, 50, { y: 0 }), S(300, { y: -3 }), L(175, 60, { y: -15 }), S(250, { y: -12 }),
      R(60, 90, { y: -8 }), S(100), L(30, 90, { y: -5 }), R(80, 55, { y: 0 }), S(100, { y: 2 }), L(130, 28, { y: 0 }), S(80),
      R(45, 22, { y: -2 }), S(150, { y: -6 }), L(90, 80, { y: -12 }), S(200, { y: -14 }), L(80, 70, { y: -12 }), S(500, { y: 8 }), L(30, 400, { y: 18 }),
    ],
  },
  {
    id: "lakeside", name: "Lakeside Park Circuit", place: "Lakeside Park", flag: "#1d4fd6",
    blurb: "A quick parkland lap around a lake, with fast chicanes and walls closer than they look.",
    character: "Semi-street parkland circuit", theme: "park",
    width: 14, scale: 1.3, runoff: 10, runoffStyle: "gravel", time: 16, rainChance: 0.25, laps: 58,
    path: [
      MAIN(650), R(90, 25), L(30, 50), S(300), R(60, 80), S(250), R(20, 300), S(200), L(40, 60), R(50, 60), S(350, { y: 1 }),
      R(60, 45), S(200), L(30, 150), S(400, { y: 0 }), R(40, 60), L(40, 60), S(250), R(90, 50), S(300), R(45, 40), S(150), L(30, 80), R(75, 35),
    ],
  },
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
