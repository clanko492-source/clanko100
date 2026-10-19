// CLANKO GP — how each kind of circuit looks: ground, trees, hills, buildings, water and lighting.

export const THEMES = {
  parkland: { ground: "grass", hills: 6, trees: { density: 0.55, kinds: ["broad", "broad", "pine"] }, grandstands: 4, buildings: 0, water: false, fogDay: 0.00028, tint: [1, 1, 1] },
  airfield: { ground: "grass", dry: 0.15, hills: 2, trees: { density: 0.18, kinds: ["broad"] }, grandstands: 3, buildings: 0, hangars: true, water: false, fogDay: 0.0003, tint: [1, 1, 1] },
  forest:   { ground: "grass", hills: 55, trees: { density: 1.0, kinds: ["pine", "pine", "broad"] }, grandstands: 3, buildings: 0, water: false, fogDay: 0.00045, tint: [0.92, 1, 0.95] },
  harbour:  { ground: "urban", hills: 30, trees: { density: 0.12, kinds: ["palm", "broad"] }, grandstands: 2, buildings: 1, water: "harbour", boats: true, fogDay: 0.00025, tint: [1, 1, 1] },
  hills:    { ground: "grass", hills: 38, trees: { density: 0.6, kinds: ["broad", "pine"] }, grandstands: 4, buildings: 0, wheel: true, water: false, fogDay: 0.00035, tint: [1, 1, 1] },
  desert:   { ground: "sand", hills: 22, trees: { density: 0.08, kinds: ["palm"] }, grandstands: 3, buildings: 0, water: false, fogDay: 0.00022, tint: [1, 0.96, 0.9] },
  city:     { ground: "urban", hills: 0, trees: { density: 0.1, kinds: ["broad", "palm"] }, grandstands: 3, buildings: 2, water: "harbour", fogDay: 0.0003, tint: [1, 1, 1] },
  neon:     { ground: "urban", hills: 0, trees: { density: 0.05, kinds: ["palm"] }, grandstands: 3, buildings: 3, neon: true, water: false, fogDay: 0.00025, tint: [1, 1, 1] },
  tropical: { ground: "grass", hills: 30, trees: { density: 0.8, kinds: ["palm", "broad", "broad"] }, grandstands: 3, buildings: 0, water: "lake", fogDay: 0.0004, tint: [0.95, 1.05, 0.95] },
  park:     { ground: "grass", hills: 8, trees: { density: 0.7, kinds: ["broad", "broad", "pine"] }, grandstands: 3, buildings: 1, water: "lake", fogDay: 0.0003, tint: [1, 1, 1] },
};

export function themeFor(def) {
  return { ...THEMES.parkland, ...(THEMES[def.theme] || {}) };
}
