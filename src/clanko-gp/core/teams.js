// CLANKO GP — original fictional teams and drivers. Any resemblance to real teams is avoided on purpose:
// names, colours and liveries are made up for this game.

export const TEAMS = [
  { id: "aurora", name: "Aurora Racing", short: "AUR", color: "#d01f2f", color2: "#f4f4f4", accent: "#ffd23a", pattern: "stripes", sponsor: "VOLTA", perf: { power: 1.0, aero: 1.0, grip: 1.0 }, base: "Fiorella", reputation: 92 },
  { id: "kestrel", name: "Kestrel Motorsport", short: "KES", color: "#0f2b5b", color2: "#3fb8ff", accent: "#ff8a00", pattern: "split", sponsor: "MERIDIAN", perf: { power: 0.997, aero: 1.004, grip: 1.0 }, base: "Ashford", reputation: 90 },
  { id: "vantor", name: "Vantor GP", short: "VAN", color: "#0b6e4f", color2: "#e9f5ee", accent: "#c7f000", pattern: "chevron", sponsor: "NORDHAVEN", perf: { power: 1.002, aero: 0.992, grip: 0.997 }, base: "Bois-Noir", reputation: 84 },
  { id: "halden", name: "Halden Engineering", short: "HAL", color: "#f2f2f2", color2: "#1c1c1c", accent: "#e01b84", pattern: "sash", sponsor: "CORVANE", perf: { power: 0.993, aero: 0.996, grip: 0.996 }, base: "Lakeside", reputation: 80 },
  { id: "meridian", name: "Meridian Works", short: "MER", color: "#f28c00", color2: "#1a1a1a", accent: "#ffffff", pattern: "fade", sponsor: "APEXLINE", perf: { power: 0.99, aero: 0.99, grip: 0.995 }, base: "Porto Lume", reputation: 76 },
  { id: "novaline", name: "Novaline", short: "NOV", color: "#5b2bd6", color2: "#14e0c4", accent: "#ffffff", pattern: "stripes", sponsor: "ZEPHYR", perf: { power: 0.988, aero: 0.986, grip: 0.993 }, base: "Neon City", reputation: 72 },
  { id: "ironhart", name: "Ironhart Racing", short: "IRO", color: "#2b2d31", color2: "#c8102e", accent: "#f0c419", pattern: "split", sponsor: "IRONHART OIL", perf: { power: 0.992, aero: 0.982, grip: 0.99 }, base: "Sandhaven", reputation: 68 },
  { id: "solenne", name: "Solenne F1 Team", short: "SOL", color: "#7a0026", color2: "#f6d7a7", accent: "#ffffff", pattern: "dots", sponsor: "SOLENNE", perf: { power: 0.984, aero: 0.983, grip: 0.988 }, base: "Lago Verde", reputation: 64 },
  { id: "zephyr", name: "Zephyr Dynamics", short: "ZEP", color: "#00a3a1", color2: "#ffffff", accent: "#ff4f7b", pattern: "chevron", sponsor: "KESTREL TIME", perf: { power: 0.981, aero: 0.978, grip: 0.986 }, base: "Kirin Hills", reputation: 60 },
  { id: "corvane", name: "Corvane Racing", short: "COR", color: "#1d3557", color2: "#fca311", accent: "#e5e5e5", pattern: "fade", sponsor: "CLANKO100.COM", perf: { power: 0.978, aero: 0.975, grip: 0.984 }, base: "Marina Bay", reputation: 56 },
];
export const TEAM_BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

export const DRIVERS = [
  { id: "rossel", first: "Marco", last: "Rossel", nat: "ITA", number: 11, team: "aurora", skill: 0.995, wet: 0.98, personality: "aggressive", helmet: ["#ffd23a", "#d01f2f"] },
  { id: "ferrand", first: "Lucie", last: "Ferrand", nat: "FRA", number: 27, team: "aurora", skill: 0.99, wet: 0.99, personality: "consistent", helmet: ["#ffffff", "#2b6fd6"] },
  { id: "hale", first: "Owen", last: "Hale", nat: "GBR", number: 4, team: "kestrel", skill: 0.993, wet: 0.995, personality: "consistent", helmet: ["#3fb8ff", "#ff8a00"] },
  { id: "tanaka", first: "Ren", last: "Tanaka", nat: "JPN", number: 22, team: "kestrel", skill: 0.988, wet: 0.97, personality: "defensive", helmet: ["#ffffff", "#c8102e"] },
  { id: "silva", first: "Caio", last: "Silva", nat: "BRA", number: 12, team: "vantor", skill: 0.99, wet: 1.0, personality: "aggressive", helmet: ["#ffe600", "#0b8a3e"] },
  { id: "lindqvist", first: "Emil", last: "Lindqvist", nat: "SWE", number: 31, team: "vantor", skill: 0.982, wet: 0.975, personality: "cautious", helmet: ["#0050a0", "#ffd400"] },
  { id: "okafor", first: "Daniel", last: "Okafor", nat: "NGA", number: 9, team: "halden", skill: 0.986, wet: 0.98, personality: "defensive", helmet: ["#0b7a3e", "#ffffff"] },
  { id: "brandt", first: "Jonas", last: "Brandt", nat: "GER", number: 18, team: "halden", skill: 0.979, wet: 0.985, personality: "consistent", helmet: ["#1c1c1c", "#e01b84"] },
  { id: "moreno", first: "Sofia", last: "Moreno", nat: "ESP", number: 55, team: "meridian", skill: 0.984, wet: 0.97, personality: "aggressive", helmet: ["#f28c00", "#1a1a1a"] },
  { id: "kowalski", first: "Piotr", last: "Kowalski", nat: "POL", number: 77, team: "meridian", skill: 0.976, wet: 0.975, personality: "cautious", helmet: ["#ffffff", "#dc143c"] },
  { id: "achterberg", first: "Daan", last: "Achterberg", nat: "NED", number: 3, team: "novaline", skill: 0.98, wet: 0.99, personality: "aggressive", helmet: ["#ff6a00", "#5b2bd6"] },
  { id: "chen", first: "Mei", last: "Chen", nat: "CHN", number: 24, team: "novaline", skill: 0.975, wet: 0.965, personality: "consistent", helmet: ["#de2910", "#ffde00"] },
  { id: "mcallister", first: "Rory", last: "McAllister", nat: "AUS", number: 14, team: "ironhart", skill: 0.978, wet: 0.97, personality: "defensive", helmet: ["#f0c419", "#2b2d31"] },
  { id: "dubois", first: "Hugo", last: "Dubois", nat: "BEL", number: 6, team: "ironhart", skill: 0.972, wet: 0.985, personality: "consistent", helmet: ["#c8102e", "#f0c419"] },
  { id: "ruiz", first: "Mateo", last: "Ruiz", nat: "MEX", number: 37, team: "solenne", skill: 0.974, wet: 0.96, personality: "aggressive", helmet: ["#006847", "#ffffff"] },
  { id: "varga", first: "Anna", last: "Varga", nat: "HUN", number: 8, team: "solenne", skill: 0.97, wet: 0.975, personality: "cautious", helmet: ["#7a0026", "#f6d7a7"] },
  { id: "nakamura", first: "Kenji", last: "Nakamura", nat: "JPN", number: 16, team: "zephyr", skill: 0.971, wet: 0.98, personality: "consistent", helmet: ["#00a3a1", "#ff4f7b"] },
  { id: "ohare", first: "Liam", last: "O'Hare", nat: "IRL", number: 28, team: "zephyr", skill: 0.966, wet: 0.97, personality: "defensive", helmet: ["#169b62", "#ff883e"] },
  { id: "santos", first: "Rafaela", last: "Santos", nat: "POR", number: 19, team: "corvane", skill: 0.968, wet: 0.965, personality: "aggressive", helmet: ["#fca311", "#1d3557"] },
  { id: "keller", first: "Noah", last: "Keller", nat: "SUI", number: 5, team: "corvane", skill: 0.962, wet: 0.96, personality: "consistent", helmet: ["#ffffff", "#d52b1e"] },
];
export const DRIVER_BY_ID = Object.fromEntries(DRIVERS.map((d) => [d.id, d]));

export function driverShort(d) { return (d.last || d.name || "DRV").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(); }

/** car livery for a team and driver */
export function teamLivery(team, driver) {
  return {
    base: team.color || "#d01f2f", secondary: team.color2 || "#f4f4f4", accent: team.accent || "#ffd23a", wing: team.wing || "#151515", pattern: team.pattern || "stripes",
    number: driver ? driver.number : 1, name: (team.short || team.name.split(" ")[0]).toUpperCase(), sponsor: team.sponsor || "CLANKO100", finish: team.finish || "gloss",
    helmet: driver && driver.helmet ? { base: driver.helmet[0], stripe: driver.helmet[1] } : { base: "#ffd23a", stripe: team.color },
  };
}

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const NATIONS = ["GBR", "ITA", "FRA", "GER", "ESP", "NED", "BEL", "POR", "SUI", "AUT", "SWE", "FIN", "DEN", "NOR", "POL", "HUN", "CZE", "IRL", "USA", "CAN", "MEX", "BRA", "ARG", "COL", "AUS", "NZL", "JPN", "CHN", "KOR", "IND", "THA", "UAE", "RSA", "NGA", "MAR"];
