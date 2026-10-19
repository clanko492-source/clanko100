// CLANKO GP — procedural open-wheel race car. Original design: lofted nose, tub and engine cover,
// sidepods, floor and diffuser, multi-element wings, halo, mirrors, suspension, 18-inch wheels,
// steering wheel with a live display, driver with moving arms. Three levels of detail.
// Forward is +x, right is +z, up is +y. The origin sits on the ground under the centre of mass.

import * as THREE from "three";
import { loft, section, wing, merge, tint, place } from "./geom.js";
import * as TX from "./textures.js";
import { COMPOUNDS } from "../core/car-specs.js";

const A = 1.962, B = 1.638;             // axle positions (front +x, rear -x) from the physics
const TF = 0.8, TR = 0.775, WR = 0.36;   // half tracks, wheel radius

// ---------- livery ----------
export const PATTERNS = ["stripes", "chevron", "split", "fade", "sash", "dots", "none"];
export function defaultLivery() {
  return { base: "#d01f2f", secondary: "#f4f4f4", accent: "#ffd23a", wing: "#151515", pattern: "stripes", number: 7, name: "CLANKO", sponsor: "VOLTA", finish: "gloss", helmet: { base: "#ffd23a", stripe: "#d01f2f" } };
}

/** paint the body texture. u runs along the car (0 = rear, 1 = nose), v round the section (0 bottom, .25 right, .5 top, .75 left) */
export function paintLivery(L, size = 1024) {
  const W = size, H = size / 2;
  const c = document.createElement("canvas"); c.width = W; c.height = H * 2;
  const g = c.getContext("2d");
  // body: canvas top half; sidepods: bottom half (see remapBodyU / sidepodGeometry)
  const yv = (v) => (1 - v) * H;
  const band = (v0, v1, color, u0 = 0, u1 = 1) => { g.fillStyle = color; g.fillRect(u0 * W, yv(v1), (u1 - u0) * W, yv(v0) - yv(v1)); };
  g.fillStyle = L.base; g.fillRect(0, 0, W, H);
  // underside darker
  band(0, 0.08, "#111"); band(0.92, 1, "#111");
  const P = L.pattern;
  if (P === "stripes") { band(0.46, 0.54, L.secondary); band(0.475, 0.525, L.accent); band(0.12, 0.2, L.secondary); band(0.8, 0.88, L.secondary); }
  else if (P === "split") { band(0.08, 0.3, L.secondary); band(0.7, 0.92, L.secondary); band(0.3, 0.33, L.accent); band(0.67, 0.7, L.accent); }
  else if (P === "fade") {
    for (let k = 0; k < 60; k++) { const u = k / 60; g.globalAlpha = Math.pow(u, 1.6); band(0, 1, L.secondary, u * 0.55, u * 0.55 + 1 / 60 + 0.002); }
    g.globalAlpha = 1; band(0.47, 0.53, L.accent);
  } else if (P === "chevron") {
    g.fillStyle = L.secondary;
    for (const [v0, v1] of [[0.18, 0.42], [0.58, 0.82]]) {
      g.beginPath(); g.moveTo(0.2 * W, yv(v0)); g.lineTo(0.55 * W, yv((v0 + v1) / 2)); g.lineTo(0.2 * W, yv(v1)); g.lineTo(0.32 * W, yv((v0 + v1) / 2)); g.closePath(); g.fill();
    }
    band(0.46, 0.54, L.accent, 0.55, 1);
  } else if (P === "sash") {
    g.fillStyle = L.secondary; g.save(); g.translate(W * 0.45, H / 2); g.rotate(-0.5); g.fillRect(-W * 0.06, -H, W * 0.12, H * 2); g.restore();
    g.fillStyle = L.accent; g.save(); g.translate(W * 0.53, H / 2); g.rotate(-0.5); g.fillRect(-W * 0.012, -H, W * 0.024, H * 2); g.restore();
  } else if (P === "dots") {
    g.fillStyle = L.secondary;
    for (let x = 0; x < 30; x++) for (let y = 0; y < 14; y++) { const r = 3 + 5 * (x / 30); g.beginPath(); g.arc((x / 30) * W, (y / 14) * H + (x % 2) * 9, r, 0, Math.PI * 2); g.fill(); }
  }
  // nose tip
  band(0, 1, L.accent, 0.965, 1);
  // numbers: nose top and both sides of the engine cover
  const num = String(L.number);
  const drawText = (txt, u, v, hPx, color, rot, font = "italic 900") => {
    g.save(); g.translate(u * W, yv(v)); g.rotate(rot); g.fillStyle = color; g.font = `${font} ${hPx}px Arial, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = hPx * 0.08; g.strokeStyle = "rgba(0,0,0,0.5)"; g.strokeText(txt, 0, 0); g.fillText(txt, 0, 0); g.restore();
  };
  drawText(num, 0.83, 0.5, H * 0.11, L.secondary === L.base ? "#fff" : L.secondary, -Math.PI / 2);
  drawText(num, 0.3, 0.33, H * 0.12, "#fff", 0);
  drawText(num, 0.3, 0.67, H * 0.12, "#fff", Math.PI);
  // sponsor and team name along the sidepods / engine cover
  drawText(L.name || "", 0.2, 0.42, H * 0.045, "#fff", 0, "800");
  drawText(L.name || "", 0.2, 0.58, H * 0.045, "#fff", Math.PI, "800");
  // panel lines
  g.strokeStyle = "rgba(0,0,0,0.22)"; g.lineWidth = 2;
  for (const u of [0.38, 0.62, 0.72]) { g.beginPath(); g.moveTo(u * W, 0); g.lineTo(u * W, H); g.stroke(); }
  // sidepods (bottom half): base colour, secondary lower band, sponsor on the outer faces
  g.save(); g.translate(0, H);
  g.fillStyle = L.base; g.fillRect(0, 0, W, H);
  band(0, 0.1, "#111"); band(0.9, 1, "#111");
  if (P !== "none") { band(0.1, 0.2, L.secondary); band(0.8, 0.9, L.secondary); band(0.2, 0.215, L.accent); band(0.785, 0.8, L.accent); }
  drawText(L.sponsor || "", 0.42, 0.3, H * 0.09, L.accent === L.base ? "#fff" : L.accent, 0, "900");
  drawText(L.sponsor || "", 0.42, 0.7, H * 0.09, L.accent === L.base ? "#fff" : L.accent, Math.PI, "900");
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function endplateTexture(L) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = L.base; g.fillRect(0, 0, 512, 256);
  g.fillStyle = L.secondary; g.fillRect(0, 170, 512, 86);
  g.fillStyle = L.accent; g.fillRect(0, 160, 512, 12);
  g.fillStyle = "#fff"; g.font = "italic 900 92px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(L.name || "", 256, 90, 480);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const sidewallCache = new Map();
function sidewallTexture(compound) {
  if (sidewallCache.has(compound)) return sidewallCache.get(compound);
  const c = document.createElement("canvas"); c.width = 1024; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#151515"; g.fillRect(0, 0, 1024, 128);
  const col = COMPOUNDS[compound] ? COMPOUNDS[compound].color : "#ffd23a";
  // v: 0..0.3 outer sidewall, 0.3..0.7 tread, 0.7..1 inner sidewall (canvas y flipped)
  const yv = (v) => (1 - v) * 128;
  g.fillStyle = col; g.fillRect(0, yv(0.2), 1024, yv(0.15) - yv(0.2));
  g.fillStyle = "#e8e8e8"; g.font = "900 15px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  for (const u of [0.12, 0.62]) g.fillText("CLANKO", u * 1024, yv(0.09));
  for (const u of [0.37, 0.87]) g.fillText(COMPOUNDS[compound] ? COMPOUNDS[compound].name.toUpperCase() : "", u * 1024, yv(0.09));
  g.fillStyle = "#101010"; g.fillRect(0, yv(0.7), 1024, yv(0.3) - yv(0.7));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  sidewallCache.set(compound, t);
  return t;
}

// ---------- shared materials ----------
let shared = null;
function sharedMaterials(quality) {
  if (shared) return shared;
  const C = TX.carbon(128);
  shared = {
    carbon: new THREE.MeshStandardMaterial({ map: C.map, normalMap: C.normalMap, roughness: 0.32, metalness: 0.25, envMapIntensity: 1.1 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.55, metalness: 0.2 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.2 }),
    rimCover: new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.35, metalness: 0.6 }),
    halo: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.35, metalness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9fa4ab, roughness: 0.3, metalness: 0.9 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.4 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.8 }),
    mirrorGlass: new THREE.MeshStandardMaterial({ color: 0x8a95a5, roughness: 0.05, metalness: 1, envMapIntensity: 1.5 }),
    rainLight: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1010, emissiveIntensity: 0, roughness: 0.3 }),
    inlet: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }),
    display: null,
  };
  return shared;
}

function paintMaterial(map, finish, quality) {
  const rough = finish === "matte" ? 0.62 : 0.28;
  const metal = finish === "metallic" ? 0.55 : 0.12;
  if (quality >= 2) return new THREE.MeshPhysicalMaterial({ map, roughness: rough, metalness: metal, clearcoat: finish === "matte" ? 0 : 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
  return new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal, envMapIntensity: 1.1 });
}

// ---------- body geometry ----------
const BODY_STATIONS = [
  // x, centre y, width, height, roundness
  [3.02, 0.29, 0.14, 0.09, 2.2],
  [2.8, 0.31, 0.22, 0.14, 2.3],
  [2.45, 0.36, 0.30, 0.21, 2.4],
  [2.05, 0.42, 0.38, 0.30, 2.5],
  [1.62, 0.46, 0.48, 0.42, 2.7],
  [1.2, 0.45, 0.60, 0.58, 3.0],
  [0.8, 0.44, 0.72, 0.64, 3.2],
  [0.45, 0.43, 0.80, 0.60, 3.2],
  [0.05, 0.42, 0.84, 0.56, 3.2],
  [-0.38, 0.47, 0.84, 0.66, 3.0],
  [-0.8, 0.5, 0.72, 0.68, 2.8],
  [-1.25, 0.48, 0.56, 0.6, 2.6],
  [-1.7, 0.43, 0.38, 0.48, 2.4],
  [-2.1, 0.38, 0.24, 0.34, 2.3],
  [-2.38, 0.36, 0.13, 0.2, 2.2],
];
function bodyGeometry(n) {
  const secs = BODY_STATIONS.map(([x, cy, w, h, p]) => {
    let pts = section(cy, w, h, n, p, 0.25);
    // cockpit: lower the top between the front of the opening and the headrest
    if (x < 0.62 && x > -0.42) {
      const top = 0.66;
      pts = pts.map(([y, z]) => [Math.min(y, top + (Math.abs(z) > 0.28 ? 0.1 : 0)), z]);
    }
    return { x, pts };
  });
  return loft(secs);
}
function sidepodGeometry(n, side) {
  const st = [
    [0.58, 0.46, 0.34, 0.34, 0.66], [0.35, 0.45, 0.42, 0.42, 0.66], [-0.2, 0.43, 0.42, 0.42, 0.63],
    [-0.75, 0.39, 0.32, 0.36, 0.57], [-1.25, 0.34, 0.18, 0.26, 0.5], [-1.55, 0.3, 0.08, 0.14, 0.45],
  ];
  const secs = st.map(([x, cy, w, h, zc]) => ({ x, pts: section(cy, w, h, n, 3.2, 0.2).map(([y, z]) => [y, z + side * zc]) }));
  return remapBodyU(loft(secs), true);
}
function remapBodyU(g, pods = false) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { uv.setX(i, (p.getX(i) + 2.38) / 5.4); uv.setY(i, pods ? uv.getY(i) * 0.5 : 0.5 + uv.getY(i) * 0.5); }
  return g;
}
function airboxGeometry(n) {
  const st = [[-0.3, 0.95, 0.2, 0.14], [-0.5, 0.93, 0.24, 0.2], [-0.85, 0.87, 0.22, 0.2], [-1.25, 0.78, 0.16, 0.14], [-1.6, 0.66, 0.08, 0.08]];
  return remapBodyU(loft(st.map(([x, cy, w, h]) => ({ x, pts: section(cy, w, h, n, 2.4) }))));
}
function floorGeometry() {
  const s = new THREE.Shape();
  const pts = [[1.45, 0.42], [1.05, 0.82], [0.7, 0.88], [-1.12, 0.88], [-1.4, 0.62], [-1.62, 0.55], [-1.62, -0.55], [-1.4, -0.62], [-1.12, -0.88], [0.7, -0.88], [1.05, -0.82], [1.45, -0.42]];
  s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
  g.rotateX(Math.PI / 2); g.translate(0, 0.065, 0);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4);
  return g;
}
function diffuserGeometry() {
  const parts = [];
  const ramp = new THREE.PlaneGeometry(0.7, 1.04, 1, 1); // along x, across z
  ramp.rotateX(-Math.PI / 2); ramp.rotateZ(-0.42); ramp.translate(-1.93, 0.2, 0);
  parts.push(ramp);
  for (const z of [-0.52, -0.26, 0, 0.26, 0.52]) {
    const f = new THREE.BufferGeometry();
    const P = [-1.62, 0.06, z * 0.95, -2.26, 0.06, z * 0.95, -2.26, 0.3, z * 0.95];
    f.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); f.computeVertexNormals();
    parts.push(f);
  }
  return merge(parts);
}
function haloGeometry(seg) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.38, 0.7, -0.3), new THREE.Vector3(-0.28, 0.86, -0.31), new THREE.Vector3(-0.05, 0.93, -0.28),
    new THREE.Vector3(0.25, 0.94, -0.18), new THREE.Vector3(0.42, 0.93, 0), new THREE.Vector3(0.25, 0.94, 0.18),
    new THREE.Vector3(-0.05, 0.93, 0.28), new THREE.Vector3(-0.28, 0.86, 0.31), new THREE.Vector3(-0.38, 0.7, 0.3),
  ]);
  const hoop = new THREE.TubeGeometry(curve, seg, 0.026, 8, false);
  const pillar = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.42, 0.93, 0), new THREE.Vector3(0.52, 0.86, 0), new THREE.Vector3(0.6, 0.72, 0)]), 8, 0.024, 8, false);
  return merge([hoop, pillar]);
}
function sharkFinGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.9, 0.92); s.lineTo(-2.05, 0.94); s.lineTo(-2.15, 0.78); s.lineTo(-1.6, 0.68); s.lineTo(-0.9, 0.88); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
  g.translate(0, 0, -0.006);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 2.38) / 5.4, 0.5 + 0.5 * (0.5 + (p.getZ(i) > 0 ? -0.2 : 0.2)));
  return g;
}

// ---------- wings ----------
function frontWingHalf(side, detail) {
  const parts = [], plates = [];
  const span = 0.86, zc = side * (0.1 + span / 2);
  const main = wing(0.27, 0.045, span, { camber: 0.05, segs: 2 }); main.rotateZ(Math.PI - 0.05); // upside down, trailing edge toward -x
  main.translate(3.05, 0.085, zc); parts.push(main);
  const n = detail >= 2 ? 3 : detail >= 1 ? 2 : 1;
  const els = [[2.82, 0.105, 0.14, 0.32], [2.71, 0.15, 0.12, 0.52], [2.62, 0.2, 0.1, 0.72]];
  for (let k = 0; k < n; k++) {
    const [x, y, ch, ang] = els[k];
    const sp = span - 0.06 * (k + 1);
    const el = wing(ch, 0.05, sp, { camber: 0.07, segs: 2 });
    el.rotateZ(Math.PI - ang);
    el.translate(x, y, zc + side * 0.03 * (k + 1));
    parts.push(el);
  }
  // endplate
  const s = new THREE.Shape();
  s.moveTo(3.06, 0.04); s.lineTo(2.55, 0.04); s.lineTo(2.5, 0.3); s.lineTo(2.78, 0.33); s.lineTo(3.06, 0.16); s.closePath();
  const ep = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
  ep.translate(0, 0, side * (0.1 + span) - 0.006);
  plates.push(ep);
  return { wing: merge(parts), plate: merge(plates) };
}
function rearWingParts(detail) {
  const main = wing(0.36, 0.09, 1.0, { camber: 0.09, segs: 3, dip: 0.025 });
  main.rotateZ(Math.PI - 0.08);
  main.translate(-2.2, 0.86, 0);
  const flap = wing(0.22, 0.07, 0.99, { camber: 0.09, segs: 3 });
  flap.rotateZ(Math.PI - 0.62);
  // pivot at the flap's leading edge: build so that the leading edge sits at the group origin
  const beam = detail >= 1 ? (() => { const b = wing(0.18, 0.08, 0.9, { camber: 0.06, segs: 2 }); b.rotateZ(Math.PI - 0.2); b.translate(-2.28, 0.44, 0); return b; })() : null;
  const s = new THREE.Shape();
  s.moveTo(-2.1, 0.36); s.lineTo(-2.66, 0.36); s.lineTo(-2.7, 1.0); s.quadraticCurveTo(-2.62, 1.1, -2.4, 1.08); s.lineTo(-2.12, 0.98); s.lineTo(-2.08, 0.6); s.closePath();
  const plates = [];
  for (const z of [-0.505, 0.505]) { const e = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false }); e.translate(0, 0, z - 0.007); plates.push(e); }
  const pyl = new THREE.BoxGeometry(0.16, 0.5, 0.03); pyl.translate(-2.18, 0.64, 0);
  return { main: merge([main, beam, pyl].filter(Boolean)), flap, plates: merge(plates) };
}
function remapPlateUV(g) {
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  const p = g.attributes.position, uv = g.attributes.uv, nr = g.attributes.normal;
  const bb = new THREE.Box3().setFromBufferAttribute(p);
  for (let i = 0; i < p.count; i++) {
    let u = (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x || 1), v = (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y || 1);
    const side = Math.sign(p.getZ(i)) || 1, nz = nr.getZ(i);
    if (nz * side > 0.5) { if (side < 0) u = 1 - u; }        // outer face reads correctly from outside
    else if (nz * side < -0.5) { u = 0.02; v = 0.98; }        // inner face: plain colour
    uv.setXY(i, u, v);
  }
  return g;
}

// ---------- wheels ----------
function tyreGeometry(width, radius, rimR, seg) {
  const hw = width / 2, sh = 0.05;
  const prof = [];
  const add = (r, y) => prof.push(new THREE.Vector2(r, y));
  add(rimR, -hw + 0.02);
  add(rimR + (radius - rimR) * 0.5, -hw - 0.005);
  add(radius - sh, -hw);
  for (let k = 1; k <= 4; k++) { const a = (k / 5) * Math.PI / 2; add(radius - sh + Math.sin(a) * sh, -hw + sh - Math.cos(a) * sh); }
  add(radius, -hw + sh); add(radius, hw - sh);
  for (let k = 1; k <= 4; k++) { const a = (k / 5) * Math.PI / 2; add(radius - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh); }
  add(radius - sh, hw); add(rimR + (radius - rimR) * 0.5, hw + 0.005); add(rimR, hw - 0.02);
  const g = new THREE.LatheGeometry(prof, seg);
  // lathe v follows the profile: remap so the sidewall bands land on the texture's sidewall rows
  const uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const y = pos.getY(i), r = Math.hypot(pos.getX(i), pos.getZ(i));
    let v;
    if (y < -hw + 0.04) v = 0.3 * (r - rimR) / (radius - rimR);
    else if (y > hw - 0.04) v = 0.7 + 0.3 * (1 - (r - rimR) / (radius - rimR));
    else v = 0.3 + 0.4 * ((y + hw) / width);
    uv.setY(i, v);
  }
  g.rotateX(Math.PI / 2); // axis along z
  return g;
}
function wheelAssembly(front, side, detail, mats, compound) {
  const grp = new THREE.Group();
  const width = front ? 0.305 : 0.405, rimR = 0.235;
  const seg = detail >= 2 ? 40 : detail >= 1 ? 24 : 14;
  const spin = new THREE.Group(); grp.add(spin);
  const tyreMat = new THREE.MeshStandardMaterial({ map: sidewallTexture(compound), roughness: 0.9, metalness: 0 });
  const tyre = new THREE.Mesh(tyreGeometry(width, WR, rimR, seg), tyreMat);
  tyre.castShadow = true; tyre.receiveShadow = true;
  spin.add(tyre);
  // rim with cover disc (outer face)
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width - 0.03, seg, 1, true), mats.rim); rim.rotation.x = Math.PI / 2; spin.add(rim);
  if (detail >= 1) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(rimR * 0.98, seg), mats.rimCover);
    disc.position.z = side * (width / 2 - 0.03); disc.rotation.y = side > 0 ? 0 : Math.PI; spin.add(disc);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 8), front ? mats.metal : mats.rim); nut.rotation.x = Math.PI / 2; nut.position.z = side * (width / 2 - 0.01); spin.add(nut);
    // spokes visible through the cover edge
    const sp = [];
    for (let k = 0; k < 10; k++) { const b = new THREE.BoxGeometry(0.03, rimR * 1.8, 0.02); b.rotateZ((k / 10) * Math.PI); b.translate(0, 0, side * (width / 2 - 0.05)); sp.push(b); }
    spin.add(new THREE.Mesh(merge(sp), mats.rim));
  }
  // brake disc (glows when hot) and caliper
  const discMat = new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.6, emissive: 0xff3a0a, emissiveIntensity: 0 });
  const bd = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.032, detail >= 1 ? 24 : 10), discMat); bd.rotation.x = Math.PI / 2; bd.position.z = -side * 0.02; grp.add(bd);
  if (detail >= 1) {
    const duct = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.06), mats.carbon); duct.position.set(front ? 0.08 : -0.06, 0.02, -side * (width / 2 + 0.03)); grp.add(duct);
  }
  return { grp, spin, tyreMat, discMat, width };
}

// ---------- steering wheel and driver ----------
function steeringWheel(mats, display) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  const w = 0.15, h = 0.085, r = 0.03;
  s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r); s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h); s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
  const body = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
  body.translate(0, 0, -0.015);
  const m = new THREE.Mesh(body, mats.carbon); g.add(m);
  for (const x of [-0.165, 0.165]) { const gr = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.1, 4, 8), mats.black); gr.position.set(x, -0.005, 0); g.add(gr); }
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.06), display); scr.position.set(0, 0.012, 0.023); g.add(scr);
  // coloured buttons and shift lights
  const btn = [];
  for (let k = 0; k < 8; k++) { const b = new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8); b.rotateX(Math.PI / 2); b.translate(-0.1 + (k % 4) * 0.012 + (k >= 4 ? 0.165 : 0), -0.045 + Math.floor(k / 4) * 0.0, 0.022); btn.push(tint(b, [0xff3030, 0x30a0ff, 0xffd030, 0x30ff70][k % 4])); }
  g.add(new THREE.Mesh(merge(btn, { colors: true }), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })));
  const leds = [];
  const ledMats = [];
  for (let k = 0; k < 10; k++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false });
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 8), mat); l.position.set(-0.054 + k * 0.012, 0.062, 0.022); g.add(l);
    leds.push(l); ledMats.push(mat);
  }
  g.userData.leds = ledMats;
  return g;
}

function displayTexture() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 140;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { canvas: c, tex: t };
}

function driverModel(L, mats, detail) {
  const g = new THREE.Group();
  const hm = new THREE.MeshPhysicalMaterial({ color: L.helmet ? L.helmet.base : "#ffd23a", roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, detail >= 1 ? 24 : 12, detail >= 1 ? 18 : 8), hm);
  helmet.scale.set(1.12, 1, 0.95); helmet.position.set(-0.14, 0.86, 0);
  g.add(helmet);
  if (detail >= 1) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.137, 0.012, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: L.helmet ? L.helmet.stripe : "#d01f2f", roughness: 0.3 }));
    stripe.rotation.y = Math.PI / 2; stripe.position.copy(helmet.position); stripe.scale.set(1, 1, 1.12); g.add(stripe);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.138, 20, 8, -0.95, 1.9, 1.15, 0.5), mats.visor);
    visor.rotation.y = Math.PI / 2; visor.position.copy(helmet.position); visor.scale.set(1.12, 1, 0.95);
    visor.rotation.set(0, Math.PI / 2, 0); g.add(visor);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.08, 12), mats.black); neck.position.set(-0.14, 0.74, 0); g.add(neck);
  }
  return { grp: g, helmet };
}

/**
 * Build a car. opts: { livery, detail 0..2 (LOD), quality (materials), compound, player }
 * Returns { root, parts: {...}, setCompound(c), update(state) }
 */
export function buildCarLOD(livery, detail, quality, compound = "medium", withDriverArms = false) {
  const mats = sharedMaterials(quality);
  const L = { ...defaultLivery(), ...(livery || {}) };
  const root = new THREE.Group();
  const n = detail >= 2 ? 26 : detail >= 1 ? 16 : 8;
  const bodyTex = paintLivery(L, detail >= 2 ? 1024 : 512);
  const paint = paintMaterial(bodyTex, L.finish, quality);
  const wingMat = new THREE.MeshStandardMaterial({ color: L.wing || "#151515", roughness: 0.4, metalness: 0.2 });
  const plateMat = new THREE.MeshStandardMaterial({ map: endplateTexture(L), roughness: 0.4, metalness: 0.15 });
  const parts = {};
  // body, airbox, sidepods, fin
  const bodyList = [remapBodyU(bodyGeometry(n)), airboxGeometry(Math.max(8, n - 6)), sidepodGeometry(Math.max(8, n - 4), 1), sidepodGeometry(Math.max(8, n - 4), -1)];
  if (detail >= 1) bodyList.push(sharkFinGeometry());
  const body = new THREE.Mesh(merge(bodyList), paint);
  body.castShadow = true; body.receiveShadow = true;
  root.add(body); parts.body = body;
  // cockpit interior and pads
  const pit = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.02, 0.5), mats.black); pit.position.set(0.05, 0.655, 0); root.add(pit);
  if (detail >= 1) {
    for (const z of [-0.3, 0.3]) { const pad = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.62, 4, 8), mats.black); pad.rotation.z = Math.PI / 2; pad.position.set(0.05, 0.76, z); root.add(pad); }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.5), mats.black); head.position.set(-0.36, 0.76, 0); root.add(head);
    // sidepod inlets
    for (const z of [-0.66, 0.66]) { const inl = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), mats.inlet); inl.scale.set(1, 1.05, 1); inl.position.set(0.585, 0.47, z); inl.rotation.y = Math.PI / 2; root.add(inl); }
    const ab = new THREE.Mesh(new THREE.CircleGeometry(0.08, 14), mats.inlet); ab.scale.set(1.2, 0.8, 1); ab.position.set(-0.295, 0.95, 0); ab.rotation.y = Math.PI / 2; root.add(ab);
    // T-camera on the airbox
    const tcam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.16), new THREE.MeshStandardMaterial({ color: L.accent, roughness: 0.4 })); tcam.position.set(-0.42, 1.04, 0); root.add(tcam);
  }
  // floor, plank, diffuser
  const floor = new THREE.Mesh(merge([floorGeometry(), detail >= 1 ? diffuserGeometry() : null].filter(Boolean)), mats.carbon);
  floor.material.side = THREE.DoubleSide;
  floor.castShadow = true; floor.receiveShadow = true;
  root.add(floor); parts.floor = floor;
  // halo
  const halo = new THREE.Mesh(haloGeometry(detail >= 1 ? 40 : 14), mats.halo); halo.castShadow = true; root.add(halo);
  // front wing halves (detachable)
  for (const side of [-1, 1]) {
    const fw = frontWingHalf(side, detail);
    const g = new THREE.Group();
    const wm = new THREE.Mesh(fw.wing, wingMat); wm.castShadow = true;
    const pm = new THREE.Mesh(remapPlateUV(fw.plate), plateMat);
    g.add(wm, pm);
    root.add(g);
    parts[side < 0 ? "fwL" : "fwR"] = g;
  }
  // rear wing with DRS flap
  {
    const rw = rearWingParts(detail);
    const g = new THREE.Group();
    const mm = new THREE.Mesh(rw.main, wingMat); mm.castShadow = true;
    const pl = new THREE.Mesh(remapPlateUV(rw.plates), plateMat); pl.castShadow = true;
    const flapPivot = new THREE.Group(); flapPivot.position.set(-2.47, 0.95, 0);
    const fm = new THREE.Mesh(rw.flap, wingMat); fm.castShadow = true;
    // rw.flap leading edge at x = 0 after the flip -> trailing edge points to -x
    flapPivot.add(fm);
    g.add(mm, pl, flapPivot);
    root.add(g);
    parts.rw = g; parts.flap = flapPivot;
    // rear crash structure and rain light
    const crash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.16), mats.carbon); crash.position.set(-2.32, 0.33, 0); root.add(crash);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.12), mats.rainLight.clone()); rl.position.set(-2.575, 0.33, 0); root.add(rl);
    parts.rainLight = rl;
  }
  // mirrors
  parts.mirrors = [];
  const mirrorMat = new THREE.MeshStandardMaterial({ color: L.base, roughness: 0.3, metalness: 0.1 });
  for (const side of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(0.44, 0.73, side * 0.62);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.17), mirrorMat); g.add(housing);
    const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.056), mats.mirrorGlass); glassM.rotation.y = -Math.PI / 2; glassM.position.x = -0.0355; g.add(glassM);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 5), mats.carbon); stalk.rotation.x = Math.PI / 2; stalk.position.set(0, -0.05, -side * 0.12); stalk.rotation.z = 0.3; g.add(stalk);
    root.add(g);
    parts.mirrors.push({ side, group: g, glass: glassM });
  }
  // suspension arms
  if (detail >= 1) {
    const arms = [];
    const link = (a, b, r = 0.012) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const len = va.distanceTo(vb);
      const c = new THREE.CylinderGeometry(r, r, len, 5);
      c.scale(1.8, 1, 0.55);
      c.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      c.applyQuaternion(q); c.translate(va.x, va.y, va.z);
      arms.push(c);
    };
    for (const side of [-1, 1]) {
      const zw = side * 0.66, zc = side * 0.2;
      // front double wishbone + pushrod + track rod
      link([A + 0.25, 0.48, zc], [A, 0.5, zw]); link([A - 0.3, 0.46, zc], [A, 0.5, zw]);
      link([A + 0.2, 0.3, zc], [A, 0.2, zw]); link([A - 0.32, 0.3, zc], [A, 0.2, zw]);
      link([A - 0.05, 0.62, side * 0.18], [A - 0.02, 0.22, side * 0.6]);
      link([A + 0.08, 0.4, zc], [A + 0.1, 0.34, zw]);
      // rear
      const zr = side * 0.64;
      link([-B + 0.35, 0.45, side * 0.22], [-B, 0.48, zr]); link([-B - 0.2, 0.45, side * 0.18], [-B, 0.48, zr]);
      link([-B + 0.35, 0.25, side * 0.22], [-B, 0.2, zr]); link([-B - 0.2, 0.25, side * 0.18], [-B, 0.2, zr]);
      link([-B + 0.15, 0.25, side * 0.2], [-B + 0.05, 0.5, side * 0.6]);
    }
    const sm = new THREE.Mesh(merge(arms), mats.carbon); sm.castShadow = true; root.add(sm);
  }
  // wheels
  parts.wheels = [];
  const wdefs = [[A, -TF, true, -1], [A, TF, true, 1], [-B, -TR, false, -1], [-B, TR, false, 1]];
  for (const [x, z, front, side] of wdefs) {
    const w = wheelAssembly(front, side, detail, mats, compound);
    const steerG = new THREE.Group(); steerG.position.set(x, WR, z);
    steerG.add(w.grp);
    root.add(steerG);
    parts.wheels.push({ ...w, steer: steerG, front, side, baseY: WR });
  }
  // driver, steering wheel, arms
  const drv = driverModel(L, mats, detail);
  root.add(drv.grp); parts.driver = drv;
  if (detail >= 1) {
    const disp = displayTexture();
    const dispMat = new THREE.MeshBasicMaterial({ map: disp.tex, toneMapped: false });
    const sw = steeringWheel(mats, dispMat);
    const swPivot = new THREE.Group(); swPivot.position.set(0.33, 0.80, 0); swPivot.rotation.set(0, -Math.PI / 2, 0);
    const tilt = new THREE.Group(); tilt.rotation.x = -0.34; tilt.add(sw); swPivot.add(tilt);
    root.add(swPivot);
    parts.steeringWheel = sw; parts.display = disp; parts.leds = sw.userData.leds;
    if (withDriverArms) {
      // forearms reach from fixed elbows to the hands on the grips
      const glove = new THREE.MeshStandardMaterial({ color: L.helmet ? L.helmet.stripe : "#222", roughness: 0.75 });
      const arms = [];
      for (const side of [-1, 1]) {
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glove); hand.scale.set(0.9, 1.15, 1.25);
        hand.position.set(side * 0.165, 0, 0.03); sw.add(hand);
        const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 1, 8), mats.black);
        root.add(fore);
        arms.push({ hand, fore, elbow: new THREE.Vector3(-0.05, 0.70, side * 0.245) });
      }
      parts.arms = arms;
    }
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow || detail >= 1; o.receiveShadow = true; } });
  return { root, parts, paint, livery: L };
}

const _hand = new THREE.Vector3(), _mid = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/** a car with three detail levels that follows a physics car */
export class CarView {
  constructor({ livery, quality = 1, compound = "medium", player = false, name = "car" } = {}) {
    this.quality = quality;
    this.lod = new THREE.LOD();
    this.lod.name = name;
    // the player's own car is always built in detail: it fills the screen in the cockpit and chase views
    const levels = player ? (quality >= 1 ? [[2, 0], [1, 60]] : [[1, 0]])
      : quality >= 2 ? [[2, 0], [1, 28], [0, 110]] : quality >= 1 ? [[1, 0], [0, 70]] : [[0, 0]];
    this.levels = levels.map(([d, dist]) => {
      const c = buildCarLOD(livery, d, quality, compound, player && d >= 1);
      this.lod.addLevel(c.root, dist);
      return c;
    });
    this.root = new THREE.Group();
    this.root.add(this.lod);
    this.compound = compound;
    this.detached = { fwL: false, fwR: false, rw: false, wheels: [false, false, false, false] };
    this._dispT = 0;
    this.prev = null;
  }
  get main() { return this.levels[0]; }
  setCompound(c) {
    if (c === this.compound) return;
    this.compound = c;
    for (const L of this.levels) for (const w of L.parts.wheels) { w.tyreMat.map = sidewallTexture(c); w.tyreMat.needsUpdate = true; }
  }
  setDetached(part, on, wheelIndex) {
    for (const L of this.levels) {
      if (part === "wheel") L.parts.wheels[wheelIndex].steer.visible = !on;
      else if (L.parts[part]) L.parts[part].visible = !on;
    }
    if (part === "wheel") this.detached.wheels[wheelIndex] = on; else this.detached[part] = on;
  }
  /** match a physics car's state. alpha blends between the previous and current physics step */
  update(car, dt, opts = {}) {
    const r = this.root;
    r.position.set(car.x, car.y, car.z);
    const pitch = (car.q && car.track ? 0 : 0) + (opts.trackPitch || 0) + car.bodyPitch;
    const roll = (opts.trackBank || 0) + car.bodyRoll;
    r.quaternion.setFromEuler(new THREE.Euler(roll, -car.h, pitch, "YZX"));
    const wet = opts.wet || 0;
    const levelIdx = this.lod.getCurrentLevel();
    const L = this.levels[Math.min(levelIdx, this.levels.length - 1)];
    const P = L.parts;
    // wheels
    for (let k = 0; k < 4; k++) {
      const w = P.wheels[k], pw = car.wheels[k];
      w.spin.rotation.z = -pw.rot;
      if (w.front) w.steer.rotation.y = -car.steer * 1.0;
      const travel = (pw.Fz - 3000) / 220000;
      w.steer.position.y = w.baseY + Math.max(-0.02, Math.min(0.02, -travel));
      const bt = car.brakeTemp ? car.brakeTemp[k] : 0;
      w.discMat.emissiveIntensity = Math.max(0, (bt - 450) / 500) * 3;
    }
    // DRS flap
    if (P.flap) P.flap.rotation.z += ((car.drsOpen ? 0.55 : 0) - P.flap.rotation.z) * Math.min(1, dt * 12);
    // rain light: on in the wet and blinking under the pit limiter
    if (P.rainLight) P.rainLight.material.emissiveIntensity = car.limiter ? ((performance.now() / 160) % 2 < 1 ? 4 : 0) : wet > 0.15 ? ((performance.now() / 250) % 2 < 1.4 ? 3 : 0.4) : 0;
    // steering wheel, hands and arms
    if (P.steeringWheel) {
      P.steeringWheel.rotation.z = -car.steer * 4.2;
      if (P.arms) {
        for (const a of P.arms) {
          a.hand.getWorldPosition(_hand); L.root.worldToLocal(_hand);
          _mid.copy(_hand).add(a.elbow).multiplyScalar(0.5);
          a.fore.position.copy(_mid);
          _dir.copy(_hand).sub(a.elbow);
          a.fore.scale.set(1, _dir.length(), 1);
          a.fore.quaternion.setFromUnitVectors(_up, _dir.normalize());
        }
      }
      // shift lights
      if (P.leds && opts.player) {
        const frac = Math.max(0, (car.rpm - car.cls.shiftRpm * 0.8) / (car.cls.shiftRpm * 0.22));
        const lit = Math.round(frac * 10);
        P.leds.forEach((m, k) => m.color.setHex(k < lit ? (k < 4 ? 0x2bff5a : k < 8 ? 0xff2b2b : 0x5a6bff) : 0x111111));
      }
      // live display at 10 Hz
      if (P.display && opts.player) {
        this._dispT -= dt;
        if (this._dispT <= 0) { this._dispT = 0.1; drawDisplay(P.display, car, opts); }
      }
    }
    // detachable bits
    if (car.damage) {
      const d = car.damage;
      for (const [k, part] of [["fwL", "fwL"], ["fwR", "fwR"], ["rw", "rw"]]) {
        const gone = d[k] >= 1;
        if (gone !== this.detached[part]) this.setDetached(part, gone);
      }
      car.wheels.forEach((w, k) => { if (w.detached !== this.detached.wheels[k]) this.setDetached("wheel", w.detached, k); });
    }
  }
  /** world positions of interesting points, for cameras and effects */
  local(x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(this.root.matrixWorld); }
  setMirrorTextures(left, right) {
    const L = this.levels[0];
    for (const m of L.parts.mirrors) {
      const tex = m.side < 0 ? left : right;
      if (!tex) { m.glass.material = sharedMaterials().mirrorGlass; continue; }
      m.glass.material = new THREE.MeshBasicMaterial({ map: tex });
    }
  }
  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

function drawDisplay(disp, car, opts) {
  const c = disp.canvas, g = c.getContext("2d");
  g.fillStyle = "#05070a"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#ffd23a"; g.font = "900 78px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(car.reverse ? "R" : String(car.gear), 128, 62);
  g.fillStyle = "#fff"; g.font = "700 28px Arial"; g.textAlign = "left";
  g.fillText(String(Math.round(Math.abs(car.u) * 3.6)), 10, 28);
  g.textAlign = "right"; g.fillStyle = car.drsOpen ? "#36e07a" : car.drsAllowed ? "#e8e8e8" : "#444";
  g.fillText("DRS", 246, 28);
  g.fillStyle = "#9ad"; g.font = "700 22px Arial";
  g.textAlign = "left"; g.fillText(opts.delta != null ? (opts.delta >= 0 ? "+" : "") + opts.delta.toFixed(2) : "", 10, 122);
  g.textAlign = "right"; g.fillStyle = "#9f9"; g.fillText("BB " + (car.setup ? car.setup.brakeBias : 57), 246, 122);
  // ERS bar
  const e = car.cls.ersStore ? car.ers / car.cls.ersStore : 0;
  g.fillStyle = "#222"; g.fillRect(70, 100, 116, 10); g.fillStyle = "#ffd23a"; g.fillRect(70, 100, 116 * e, 10);
  disp.tex.needsUpdate = true;
}
