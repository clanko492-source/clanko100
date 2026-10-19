// quick design tool: node tools/try-layout.mjs <file.json> -> prints solved lengths and writes an SVG preview
import fs from "node:fs";
import { buildLayout } from "../core/layout.js";
const defs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = process.argv[3] || "/tmp/claude-0/-home-claude/298a9c30-57c9-5b26-afd4-79e162d4137e/scratchpad/layout.html";
let html = "<html><body style='margin:0;background:#111;display:flex;flex-wrap:wrap'>";
for (const def of defs) { def.preview = true;
  try {
    const L = buildLayout(def);
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let i = 0; i < L.N; i++) { minx = Math.min(minx, L.x[i]); maxx = Math.max(maxx, L.x[i]); minz = Math.min(minz, L.z[i]); maxz = Math.max(maxz, L.z[i]); }
    const pad = 60, W = maxx - minx + pad * 2, H = maxz - minz + pad * 2;
    let d = "";
    for (let i = 0; i < L.N; i++) d += (i ? "L" : "M") + (L.x[i] - minx + pad).toFixed(1) + " " + (L.z[i] - minz + pad).toFixed(1);
    d += "Z";
    const ymin = Math.min(...L.y), ymax = Math.max(...L.y);
    const lens = L.cmds.filter(c => c[0] === "S").map(c => c[1].toFixed(0)).join(" ");
    const neg = L.cmds.some(c => c[0] === "S" && c[1] < 12); console.log(neg ? "NEGATIVE " : "", def.id, "length", L.length.toFixed(0), "adjusted straights", lens, "height", ymin.toFixed(0), "..", ymax.toFixed(0), "N", L.N);
    // start marker + direction
    const sx = L.x[0] - minx + pad, sz = L.z[0] - minz + pad;
    html += `<div style="color:#ddd;font:14px sans-serif;padding:8px">${def.id} ${L.length.toFixed(0)} m<br><svg width="560" height="${(560 * H / W).toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}"><path d="${d}" fill="none" stroke="#666" stroke-width="${(L.w[0]).toFixed(1)}" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#2fb8ff" stroke-width="3"/><circle cx="${sx}" cy="${sz}" r="14" fill="#ff4fd8"/><circle cx="${(L.x[10] - minx + pad)}" cy="${(L.z[10] - minz + pad)}" r="8" fill="#ffd84a"/>`;
    for (const [k, v] of Object.entries(L.tags)) { const i = Math.round(v / L.ds) % L.N; html += `<text x="${L.x[i] - minx + pad + 15}" y="${L.z[i] - minz + pad}" fill="#fff" font-size="40">${k}</text>`; }
    html += `</svg></div>`;
  } catch (e) { console.log(def.id, "ERROR", e.message); }
}
fs.writeFileSync(out, html + "</body></html>");
