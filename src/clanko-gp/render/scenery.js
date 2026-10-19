// CLANKO GP — everything around the circuit: pit building and pit wall, start lights, grandstands,
// trees, buildings, floodlights, marshal posts, TV towers, bridges, tunnels, boats and hills.

import * as THREE from "three";
import { clamp, lerp, smoothstep, rng } from "../core/math.js";
import { SURF } from "../core/track.js";
import * as TX from "./textures.js";
import { merge, tint, place } from "./geom.js";
import { noise2, fbm2 } from "./track-view.js";

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

/** matrix that places a local frame (x along the circuit, z to the right, y up) at (s, d) */
function frameAt(tr, s, d, dy = 0, yaw = 0) {
  const w = tr.toWorld(s, d);
  _q.setFromEuler(_e.set(0, -w.heading + yaw, 0));
  return new THREE.Matrix4().compose(new THREE.Vector3(w.x, w.y + dy, w.z), _q, new THREE.Vector3(1, 1, 1));
}
function boxAt(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return g; }

function textTexture(text, { w = 1024, h = 128, bg = "#111", fg = "#fff", font = "900 72px Arial" } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2, w * 0.94);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildScenery(view) {
  const tr = view.track, th = view.theme, q = view.q, root = new THREE.Group();
  root.name = "scenery";
  view.group.add(root);
  const R = rng(1234 + tr.N);
  const night = view.night;
  const out = { root, startLights: null, marshals: null, occupied: [] };
  const occ = new Map(); // coarse occupancy for placing buildings/trees (20 m cells)
  const occKey = (x, z) => Math.floor(x / 20) * 100000 + Math.floor(z / 20);
  const markOcc = (x, z, r) => { for (let dx = -r; dx <= r; dx += 10) for (let dz = -r; dz <= r; dz += 10) occ.set(occKey(x + dx, z + dz), 1); };
  /** is a world point clear of every part of the circuit corridor by `margin` metres? */
  const clearOfTrack = (x, z, margin) => {
    let ok = true;
    tr.near(x, z, 70 + margin, (j) => {
      if (!ok) return;
      const dx = x - tr.x[j], dz = z - tr.z[j];
      const d = dx * tr.nx[j] + dz * tr.nz[j], a = dx * tr.tx[j] + dz * tr.tz[j];
      if (Math.abs(a) > tr.ds * 2) return;
      const side = d < 0 ? 0 : 1;
      if (Math.abs(d) < tr.bar[side][j] + margin) ok = false;
    });
    return ok;
  };
  out.clearOfTrack = clearOfTrack;

  // shared materials
  const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
  const vcMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a38, roughness: 0.08, metalness: 0.6, emissive: night ? 0x8fb4d8 : 0x000000, emissiveIntensity: night ? 0.35 : 0 });
  const addMerged = (list, mat, { shadow = true, name } = {}) => {
    if (!list.length) return null;
    const m = new THREE.Mesh(merge(list, { colors: !!mat.vertexColors }), mat);
    m.castShadow = shadow; m.receiveShadow = true; if (name) m.name = name;
    root.add(m); return m;
  };

  // ======================= pit complex =======================
  const pit = tr.pit;
  const teams = view.opts.teams || [];
  if (pit) {
    const sg = pit.sign;
    const s0 = tr.boxS(0) - 26, s1 = tr.boxS(9) + 26, Lb = s1 - s0, sm = (s0 + s1) / 2;
    const struct = [], glassG = [], doors = [];
    const M = frameAt(tr, sm, sg * (pit.garage + 9));
    // main pit building: garages below, glass hospitality floor above, roof
    struct.push(tint(boxAt(Lb, 5.2, 18).applyMatrix4(M), 0xe9e9ea));
    glassG.push(boxAt(Lb - 1, 3.4, 16.6, 0, 5.2, 0).applyMatrix4(M));
    struct.push(tint(boxAt(Lb + 4, 0.6, 21, 0, 8.6, -sg * 1.2).applyMatrix4(M), 0xd8d8da));
    // control tower near the start line
    const Mt = frameAt(tr, 30, sg * (pit.garage + 30));
    struct.push(tint(boxAt(12, 16, 12).applyMatrix4(Mt), 0xdedede));
    glassG.push(boxAt(13, 4, 13, 0, 16, 0).applyMatrix4(Mt));
    struct.push(tint(boxAt(14, 0.6, 14, 0, 20, 0).applyMatrix4(Mt), 0xcfcfcf));
    // garage openings with team colours
    for (let slot = 0; slot < 10; slot++) {
      const s = tr.boxS(slot);
      const col = teams[slot] ? teams[slot].color : "#888";
      const Mg = frameAt(tr, s, sg * (pit.garage - 0.02));
      const opening = boxAt(12, 4.4, 0.2, 0, 0, 0); opening.applyMatrix4(Mg);
      doors.push(tint(opening, 0x0b0b0d));
      const band = boxAt(12, 0.6, 0.3, 0, 4.45, 0); band.applyMatrix4(Mg);
      doors.push(tint(band, col));
      // back wall of the garage, lit in team colour
      const back = boxAt(11, 4, 0.2, 0, 0, sg * 10); back.applyMatrix4(Mg);
      doors.push(tint(back, new THREE.Color(col).multiplyScalar(0.55)));
    }
    addMerged(struct, vc, { name: "pitBuilding" });
    const gm = new THREE.Mesh(merge(glassG), glass); gm.castShadow = true; root.add(gm);
    addMerged(doors, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.0 }), { shadow: false });
    // pit wall with fence and team stands
    const wallL = pit.wallEnd - pit.wallStart, wallMid = (pit.wallStart + pit.wallEnd) / 2;
    const Mw = frameAt(tr, wallMid, sg * (pit.wall + 0.25));
    const pw = [tint(boxAt(wallL, 1.1, 0.5).applyMatrix4(Mw), 0xd9d9d9)];
    for (let slot = 0; slot < 10; slot++) {
      const s = tr.boxS(slot) + 2;
      const Ms = frameAt(tr, s, sg * (pit.wall + 1.6));
      pw.push(tint(boxAt(4.2, 0.4, 2.2, 0, 1.1, 0).applyMatrix4(Ms), 0x333338));
      pw.push(tint(boxAt(4.2, 0.12, 2.6, 0, 3.2, 0).applyMatrix4(Ms), teams[slot] ? teams[slot].color : "#777"));
      pw.push(tint(boxAt(0.1, 2.0, 0.1, -2, 1.2, -sg * 1).applyMatrix4(Ms), 0x777777));
      pw.push(tint(boxAt(0.1, 2.0, 0.1, 2, 1.2, -sg * 1).applyMatrix4(Ms), 0x777777));
    }
    addMerged(pw, vc);
    const fenceG = new THREE.PlaneGeometry(wallL, 3.2); fenceG.translate(0, 1.1 + 1.6, 0);
    const fu = fenceG.attributes.uv; for (let i = 0; i < fu.count; i++) fu.setXY(i, fu.getX(i) * wallL / 4, fu.getY(i) * 0.8);
    fenceG.applyMatrix4(frameAt(tr, wallMid, sg * (pit.wall + 0.05)));
    root.add(new THREE.Mesh(fenceG, view.mat.fence));
    // sign on the roof
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(36, 4.5), new THREE.MeshStandardMaterial({ map: textTexture("CLANKO GP", { bg: "#0d0d10", fg: "#ffd23a" }), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: night ? 0.6 : 0, roughness: 0.5 }));
    sign.material.emissiveMap = sign.material.map;
    sign.position.set(0, 11.6, -sg * 9.5); sign.rotation.y = sg > 0 ? 0 : Math.PI;
    const sg2 = new THREE.Group(); sg2.add(sign); sg2.applyMatrix4(frameAt(tr, sm, sg * (pit.garage + 9)));
    root.add(sg2);
    out.pitBuildingMid = sm;
  }

  // ======================= start gantry and lights =======================
  {
    const s = 2.5, hw = tr.hw[0], reach = hw + 3.2;
    const M = frameAt(tr, s, 0);
    const parts = [];
    for (const z of [-reach, reach]) parts.push(tint(boxAt(0.7, 7.6, 0.7, 0, 0, z), 0x2a2a2e));
    parts.push(tint(boxAt(1.0, 1.0, reach * 2 + 0.7, 0, 6.6, 0), 0x2a2a2e));
    const pods = [];
    for (let k = 0; k < 5; k++) pods.push(tint(boxAt(0.5, 1.5, 0.95, 0, 5.0, -2.6 + k * 1.3), 0x101012));
    const g = merge([...parts, ...pods], { colors: true }).applyMatrix4(M);
    const mesh = new THREE.Mesh(g, vc); mesh.castShadow = true; root.add(mesh);
    // lamps (both faces)
    const lampGeo = new THREE.CircleGeometry(0.17, 16);
    const lamps = [];
    const lampGroup = new THREE.Group(); lampGroup.applyMatrix4(M); root.add(lampGroup);
    for (let k = 0; k < 5; k++) for (let r = 0; r < 2; r++) for (const face of [-1, 1]) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.3 });
      const l = new THREE.Mesh(lampGeo, mat);
      l.position.set(face * 0.26, 5.35 + r * 0.42, -2.6 + k * 1.3);
      l.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
      lampGroup.add(l); lamps.push({ k, mat });
    }
    out.startLights = {
      set(n, color) { for (const l of lamps) { const on = l.k < n; l.mat.emissiveIntensity = on ? 6 : 0; l.mat.emissive.set(color || 0xff1a1a); } },
    };
  }

  // ======================= grandstands =======================
  const crowdMat = new THREE.MeshStandardMaterial({ map: TX.crowd(512, 0.85, 3), roughness: 0.9 });
  const standParts = [], crowdParts = [], roofParts = [], adParts = [];
  const adMat = new THREE.MeshStandardMaterial({ map: TX.adStrip(2048, 128, 3), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: night ? 0.25 : 0 });
  adMat.emissiveMap = adMat.map;
  const placeStand = (sA, sB, side, offsetExtra = 3, rows = 10) => {
    const sg = side === 0 ? -1 : 1;
    const segL = 16;
    for (let s = sA; s < sB; s += segL) {
      const sc = s + segL / 2, i = tr.idx(sc);
      const off = tr.bar[side][i] + 1.6 + offsetExtra;
      const depth = rows * 0.85;
      // footprint check
      const a = tr.toWorld(sc, sg * (off + depth + 2));
      if (!clearOfTrack(a.x, a.z, 4) || view.inWater(a.x, a.z)) continue;
      const M = frameAt(tr, sc, sg * off, 0);
      const base = 2.2, rise = rows * 0.48;
      // structure under the seats
      standParts.push(tint(boxAt(segL, base, depth, 0, 0, sg * depth / 2), 0xbfc3c8).applyMatrix4(M));
      standParts.push(tint(boxAt(segL, base + rise + 0.6, 0.6, 0, 0, sg * (depth + 0.3)), 0xa9adb3).applyMatrix4(M));
      // seating slope
      const slope = new THREE.PlaneGeometry(segL, Math.hypot(depth, rise));
      const uv = slope.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * segL / 8, uv.getY(k) * rows / 16);
      slope.rotateX(-Math.PI / 2 + Math.atan2(rise, depth) * (sg > 0 ? 1 : 1));
      if (sg > 0) slope.rotateY(Math.PI);
      slope.translate(0, base + rise / 2, sg * depth / 2);
      crowdParts.push(slope.applyMatrix4(M));
      // roof on posts
      roofParts.push(tint(boxAt(segL + 0.2, 0.35, depth + 2, 0, base + rise + 4.2, sg * (depth / 2 - 0.5)), 0xe8e8e8).applyMatrix4(M));
      for (const x of [-segL / 2 + 0.4]) roofParts.push(tint(boxAt(0.3, base + rise + 4.2, 0.3, x, 0, sg * (depth + 0.2)), 0x9a9da3).applyMatrix4(M));
      // advertising fascia
      const ad = new THREE.PlaneGeometry(segL, 1.1);
      const auv = ad.attributes.uv; const u0 = (s / 16.8) % 1; for (let k = 0; k < auv.count; k++) auv.setX(k, u0 + auv.getX(k) * segL / 16.8);
      if (sg > 0) ad.rotateY(Math.PI);
      ad.translate(0, base - 0.6, -sg * 0.02);
      adParts.push(ad.applyMatrix4(M));
      const fp = tr.toWorld(sc, sg * (off + depth / 2)); markOcc(fp.x, fp.z, 20);
    }
  };
  {
    const oppSide = pit ? 1 - pit.side : 0;
    placeStand(-260, 180, oppSide, 3, 12);
    // stands around the slowest corners
    const slow = tr.corners.slice().sort((a, b) => a.radius - b.radius).slice(0, Math.max(0, (th.grandstands || 3) - 1) + 1);
    for (const c of slow) {
      const outsideSide = c.dir === "R" ? 0 : 1;
      if (Math.abs(tr.sDelta(c.s, 0)) < 300) continue;
      placeStand(c.s - 55, c.s + 40, outsideSide, 4, 9);
    }
  }
  addMerged(standParts, vc, { name: "stands" });
  if (crowdParts.length) { const m = new THREE.Mesh(merge(crowdParts), crowdMat); m.receiveShadow = true; root.add(m); }
  addMerged(roofParts, vc);
  if (adParts.length) { const m = new THREE.Mesh(merge(adParts), adMat); root.add(m); }

  // ======================= marshal posts and TV towers =======================
  {
    const posts = [], panels = [];
    const spacing = 320;
    let n = 0;
    for (let s = 120; s < tr.length - 60; s += spacing, n++) {
      const i = tr.idx(s), side = n % 2;
      const sg = side === 0 ? -1 : 1;
      if (pit && side === pit.side && tr.runSurf[side][i] === SURF.PIT) continue;
      const off = tr.bar[side][i] + 2.4;
      const p = tr.toWorld(s, sg * off);
      if (!clearOfTrack(p.x, p.z, 1) || view.inWater(p.x, p.z)) continue;
      const M = frameAt(tr, s, sg * off);
      posts.push(tint(boxAt(2.2, 2.4, 2.0), 0xf2f2f2).applyMatrix4(M));
      posts.push(tint(boxAt(2.6, 0.2, 2.4, 0, 2.4, 0), 0xff7a00).applyMatrix4(M));
      panels.push({ s, M: frameAt(tr, s, sg * (off - 1.05), 1.4), sector: tr.sectors.findIndex((x, k) => s >= x && (k === 2 || s < tr.sectors[k + 1])) });
    }
    addMerged(posts, vc);
    const pg = new THREE.PlaneGeometry(1.0, 0.7);
    const pm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const im = new THREE.InstancedMesh(pg, pm, Math.max(1, panels.length));
    panels.forEach((p, k) => {
      const m = p.M.clone();
      // face the track: rotate so the plane looks toward -side
      const w = new THREE.Vector3(), qq = new THREE.Quaternion(), sc = new THREE.Vector3();
      m.decompose(w, qq, sc);
      const sideSign = Math.sign((new THREE.Vector3(0, 0, 1).applyQuaternion(qq)).dot(new THREE.Vector3(w.x - tr.toWorld(p.s, 0).x, 0, w.z - tr.toWorld(p.s, 0).z)));
      qq.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sideSign > 0 ? Math.PI : 0, 0)));
      m.compose(w, qq, sc);
      im.setMatrixAt(k, m); im.setColorAt(k, new THREE.Color(0x111111));
    });
    root.add(im);
    out.marshals = {
      panels,
      set(fn) { panels.forEach((p, k) => im.setColorAt(k, new THREE.Color(fn(p) || 0x111111))); if (im.instanceColor) im.instanceColor.needsUpdate = true; },
    };
    // TV camera towers at corners (also used by the TV camera)
    const towers = [];
    const cs = tr.corners.slice().sort((a, b) => a.s - b.s);
    let lastS = -1e9;
    for (const c of cs) {
      if (c.s - lastS < 260) continue;
      const side = c.dir === "R" ? 0 : 1, sg = side === 0 ? -1 : 1, i = tr.idx(c.s - 40);
      const off = tr.bar[side][i] + 7;
      const p = tr.toWorld(c.s - 40, sg * off);
      if (!clearOfTrack(p.x, p.z, 3) || view.inWater(p.x, p.z)) continue;
      const M = frameAt(tr, c.s - 40, sg * off);
      towers.push(tint(boxAt(2.4, 8, 2.4), 0x6d7075).applyMatrix4(M));
      towers.push(tint(boxAt(3, 0.3, 3, 0, 8, 0), 0x4a4d52).applyMatrix4(M));
      view.tvSpots.push({ s: c.s - 40, x: p.x, y: p.y + 9.7, z: p.z });
      lastS = c.s;
    }
    // straights get ground-level cameras
    for (let s = 0; s < tr.length; s += 450) {
      if (view.tvSpots.some((t) => Math.abs(tr.sDelta(t.s, s)) < 200)) continue;
      const i = tr.idx(s), side = pit && pit.side === 0 ? 1 : 0, sg = side === 0 ? -1 : 1;
      const p = tr.toWorld(s, sg * (tr.bar[side][i] + 3));
      view.tvSpots.push({ s, x: p.x, y: p.y + 3.2, z: p.z });
    }
    view.tvSpots.sort((a, b) => a.s - b.s);
    addMerged(towers, vc);
  }

  // ======================= DRS signs and distance boards =======================
  {
    const parts = [];
    const drsTex = textTexture("DRS", { w: 256, h: 128, bg: "#0d0d10", fg: "#36e07a", font: "900 84px Arial" });
    const drsMat = new THREE.MeshStandardMaterial({ map: drsTex, emissive: 0xffffff, emissiveMap: drsTex, emissiveIntensity: night ? 0.8 : 0.3 });
    const signs = [];
    for (const z of tr.drs) {
      const i = tr.idx(z.start);
      for (const side of [0, 1]) {
        if (pit && side === pit.side && tr.runSurf[side][i] === SURF.PIT) continue;
        const sg = side === 0 ? -1 : 1, off = tr.hw[i] + tr.kerb[side][i] + 3.5;
        const M = frameAt(tr, z.start, sg * Math.min(off, tr.bar[side][i] - 0.6));
        parts.push(tint(boxAt(0.12, 2.4, 0.12), 0x9a9a9a).applyMatrix4(M));
        const pl = new THREE.PlaneGeometry(1.4, 0.7); pl.rotateY(-Math.PI / 2); pl.translate(-0.07, 2.6, 0);
        signs.push(pl.applyMatrix4(M));
      }
    }
    // braking boards 100/50 before the heaviest stops
    const boardTex = [300, 200, 100].map((n) => textTexture(String(n), { w: 256, h: 256, bg: "#f4f4f4", fg: "#111", font: "900 150px Arial" }));
    const boards = [[], [], []];
    const heavy = tr.corners.filter((c) => c.radius < 60);
    for (const c of heavy) {
      // find the braking point: walk back to where the previous straight ends
      let s0 = c.s - 30; while (Math.abs(tr.k[tr.idx(s0)]) > 1 / 400 && c.s - s0 < 200) s0 -= 4;
      const side = c.dir === "R" ? 0 : 1, sg = side === 0 ? -1 : 1;
      [300, 200, 100].forEach((n, k) => {
        const s = s0 - n * 0.55, i = tr.idx(s);
        if (pit && side === pit.side && tr.runSurf[side][i] === SURF.PIT) return;
        const off = Math.min(tr.hw[i] + tr.kerb[side][i] + 4, tr.bar[side][i] - 0.6);
        const M = frameAt(tr, s, sg * off);
        parts.push(tint(boxAt(0.1, 1.2, 0.1), 0x9a9a9a).applyMatrix4(M));
        const pl = new THREE.PlaneGeometry(1, 1); pl.rotateY(-Math.PI / 2); pl.translate(-0.06, 1.7, 0);
        boards[k].push(pl.applyMatrix4(M));
      });
    }
    addMerged(parts, vc, { shadow: false });
    if (signs.length) root.add(new THREE.Mesh(merge(signs), drsMat));
    boards.forEach((list, k) => { if (list.length) root.add(new THREE.Mesh(merge(list), new THREE.MeshStandardMaterial({ map: boardTex[k], roughness: 0.6 }))); });
  }

  // ======================= bridges over the circuit (advertising bridges) =======================
  if (!tr.street) {
    const parts = [], ads = [];
    const candidates = [];
    for (let s = 300; s < tr.length - 300; s += 20) {
      let straight = true; for (let o = -40; o <= 40; o += 8) if (Math.abs(tr.k[tr.idx(s + o)]) > 1 / 900) { straight = false; break; }
      if (straight && Math.abs(tr.sDelta(s, 0)) > 350 && !(tr.flags[tr.idx(s)] & 3)) candidates.push(s);
    }
    const chosen = [];
    for (const s of candidates) if (chosen.every((c) => Math.abs(tr.sDelta(c, s)) > 1200) && chosen.length < 2 && R() < 0.5) chosen.push(s);
    for (const s of chosen) {
      const i = tr.idx(s), l = tr.bar[0][i] + 2, r = tr.bar[1][i] + 2;
      const M = frameAt(tr, s, (r - l) / 2);
      const span = l + r;
      parts.push(tint(boxAt(2.6, 1.0, span + 2, 0, 6.6, 0), 0xdedede).applyMatrix4(M));
      for (const z of [-span / 2, span / 2]) parts.push(tint(boxAt(2.2, 6.6, 2.2, 0, -1, z), 0xcfcfcf).applyMatrix4(M));
      for (const face of [-1, 1]) {
        const ad = new THREE.PlaneGeometry(span, 1.3);
        const uv = ad.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * span / 16.8);
        ad.rotateY(face * Math.PI / 2); ad.translate(face * 1.32, 7.1, 0);
        ads.push(ad.applyMatrix4(M));
      }
    }
    addMerged(parts, vc);
    if (ads.length) root.add(new THREE.Mesh(merge(ads), adMat));
  }

  // ======================= the circuit's own bridge and tunnel structures =======================
  {
    const parts = [], tunnelLights = [];
    for (let i = 0; i < tr.N; i++) {
      const j = (i + 1) % tr.N;
      if ((tr.flags[i] & 1) && (tr.flags[j] & 1)) {
        // deck underside and fascia
        const l = tr.bar[0][i] + 1.6, r = tr.bar[1][i] + 1.6;
        const a = view.P(i, -l), b = view.P(i, r), c = view.P(j, -l), d = view.P(j, r);
        const quad = (p0, p1, p2, p3, color) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p1, ...p3, ...p2], 3));
          g.computeVertexNormals(); parts.push(tint(g, color));
        };
        const dn = (p, h) => [p[0], p[1] - h, p[2]];
        quad(dn(b, 1.4), dn(a, 1.4), dn(d, 1.4), dn(c, 1.4), 0x9c9c9c);
        quad(a, dn(a, 1.4), c, dn(c, 1.4), 0xb5b5b5);
        quad(dn(b, 1.4), b, dn(d, 1.4), d, 0xb5b5b5);
        if (i % 15 === 0) {
          const m = view.P(i, (r - l) / 2);
          const gy = view.groundY(m[0], m[2]);
          const h = m[1] - 1.4 - gy;
          if (h > 2) { const p = boxAt(2.4, h, 6, 0, 0, 0); p.translate(m[0], gy, m[2]); parts.push(tint(p, 0xa8a8a8)); }
        }
      }
      if ((tr.flags[i] & 2) && (tr.flags[j] & 2)) {
        const l = tr.bar[0][i] + 0.5, r = tr.bar[1][i] + 0.5;
        const H = 7.2;
        const a = view.P(i, -l, H), b = view.P(i, r, H), c = view.P(j, -l, H), d = view.P(j, r, H);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...c, ...b, ...b, ...c, ...d], 3));
        g.computeVertexNormals(); parts.push(tint(g, 0x7a7a7a));
        // building mass on top
        if (i % 10 === 0) { const m = view.P(i, (r - l) / 2, H); const bx = boxAt(22, 14, l + r + 10); bx.rotateY(-tr.heading[i]); bx.translate(m[0], m[1], m[2]); parts.push(tint(bx, 0xd7c9b5)); }
        if (i % 4 === 0) { const m = view.P(i, 0, H - 0.05); tunnelLights.push(m); }
        // tunnel walls above the barrier
        for (const side of [0, 1]) {
          const sgn = side === 0 ? -1 : 1, off = tr.bar[side][i] + 0.5;
          const p0 = view.P(i, sgn * off, 1.05), p1 = view.P(i, sgn * off, H), p2 = view.P(j, sgn * off, 1.05), p3 = view.P(j, sgn * off, H);
          const w = new THREE.BufferGeometry();
          w.setAttribute("position", new THREE.Float32BufferAttribute(side === 0 ? [...p0, ...p2, ...p1, ...p1, ...p2, ...p3] : [...p0, ...p1, ...p2, ...p1, ...p3, ...p2], 3));
          w.computeVertexNormals(); parts.push(tint(w, 0xcfc7ba));
        }
      }
    }
    if (parts.length) { const m = addMerged(parts, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); }
    if (tunnelLights.length) {
      const lg = new THREE.BoxGeometry(0.4, 0.08, 3.2);
      const im = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: 0xfff2d0, toneMapped: false }), tunnelLights.length);
      tunnelLights.forEach((p, k) => im.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2])));
      root.add(im);
    }
  }

  // ======================= floodlights for night races =======================
  if (night) {
    const poles = [], heads = [];
    const sp = 34;
    let k = 0;
    for (let s = 0; s < tr.length; s += sp, k++) {
      const i = tr.idx(s), side = k % 2, sg = side === 0 ? -1 : 1;
      if (tr.flags[i] & 2) continue;
      const off = tr.bar[side][i] + 2.2;
      const p = tr.toWorld(s, sg * off);
      if (view.inWater(p.x, p.z)) continue;
      poles.push([p.x, p.y, p.z, tr.heading[i], sg]);
    }
    const pg = new THREE.CylinderGeometry(0.16, 0.24, 1, 6); pg.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.6, roughness: 0.4 }), poles.length);
    const hg = new THREE.BoxGeometry(0.6, 0.5, 3.0);
    const hm = new THREE.InstancedMesh(hg, new THREE.MeshBasicMaterial({ color: 0xfff8e6, toneMapped: false }), poles.length);
    poles.forEach((p, n) => {
      const H = 17;
      pm.setMatrixAt(n, new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion(), new THREE.Vector3(1, H, 1)));
      const qh = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -p[3], p[4] * 0.5));
      hm.setMatrixAt(n, new THREE.Matrix4().compose(new THREE.Vector3(p[0] - Math.sin(p[3]) * 0, p[1] + H, p[2]), qh, new THREE.Vector3(1, 1, 1)));
    });
    root.add(pm, hm);
  }

  // ======================= trees =======================
  {
    const kinds = th.trees.kinds || ["broad"];
    const geos = { pine: pineGeo(), broad: broadGeo(), palm: palmGeo() };
    const b = tr.bounds, margin = 700;
    const area = (b.maxx - b.minx + 2 * margin) * (b.maxz - b.minz + 2 * margin);
    const target = Math.round(clamp(area / 2200, 500, 12000) * (th.trees.density || 0.5) * (q.trees || 1));
    const chunkSize = 320;
    const chunks = new Map();
    let placed = 0, tries = 0;
    while (placed < target && tries < target * 8) {
      tries++;
      const x = b.minx - margin + R() * (b.maxx - b.minx + 2 * margin), z = b.minz - margin + R() * (b.maxz - b.minz + 2 * margin);
      const dc = view.distC(x, z);
      const dens = fbm2(x / 260, z / 260, 3, 77);
      const thick = (th.trees.density || 0.5) >= 0.8;
      if (dc < (thick ? 8 : 20)) continue;
      if (dens < (thick ? 0.3 : 0.42) - (th.trees.density || 0.5) * 0.12) continue;
      if (view.inWater(x, z) || occ.has(occKey(x, z))) continue;
      if (dc < 90 && !clearOfTrack(x, z, thick ? 5 : 9)) continue;
      const kind = kinds[Math.floor(R() * kinds.length)];
      const key = Math.floor(x / chunkSize) + "," + Math.floor(z / chunkSize) + "," + kind;
      if (!chunks.has(key)) chunks.set(key, []);
      const y = view.groundY(x, z);
      const s = 0.75 + R() * 0.65;
      chunks.get(key).push([x, y - 0.2, z, R() * Math.PI * 2, s * (kind === "pine" ? 1.15 : 1), 0.8 + R() * 0.35]);
      placed++;
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    for (const [key, list] of chunks) {
      const kind = key.split(",")[2];
      const im = new THREE.InstancedMesh(geos[kind], mat, list.length);
      const col = new THREE.Color();
      list.forEach((t, k) => {
        _q.setFromEuler(_e.set(0, t[3], 0));
        _m.compose(_v.set(t[0], t[1], t[2]), _q, _s.set(t[4], t[4] * (0.9 + (t[5] - 0.8) * 0.5), t[4]));
        im.setMatrixAt(k, _m);
        col.setScalar(t[5] * (night ? 0.55 : 1)); im.setColorAt(k, col);
      });
      im.castShadow = q.detail >= 2; im.receiveShadow = false;
      im.computeBoundingSphere();
      root.add(im);
    }
    out.treeCount = placed;
  }

  // ======================= buildings =======================
  if (th.buildings || th.hangars) {
    const facadeKinds = th.buildings >= 2 ? [1, 3, 4, 6, 1] : [0, 2, 5, 0, 4];
    const byKind = new Map();
    const addBuilding = (x, z, w, d, h, yaw, kind) => {
      const y = view.groundY(x, z) - 0.5;
      const g = new THREE.BoxGeometry(w, h, d);
      // UVs in metres so windows keep their size
      const uv = g.attributes.uv, pos = g.attributes.position, nor = g.attributes.normal;
      for (let k = 0; k < uv.count; k++) {
        const nx = Math.abs(nor.getX(k)), ny = Math.abs(nor.getY(k));
        const px = pos.getX(k), py = pos.getY(k), pz = pos.getZ(k);
        if (ny > 0.5) uv.setXY(k, 0.02, 0.02); else uv.setXY(k, (nx > 0.5 ? pz : px) / 24, (py + h / 2) / 24);
      }
      g.translate(0, h / 2, 0); g.rotateY(yaw); g.translate(x, y, z);
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(g);
      markOcc(x, z, Math.max(w, d) / 2);
    };
    // along the street circuits: blocks just outside the corridor
    const big = th.buildings >= 2;
    const maxDist = th.buildings >= 2 ? 650 : 380;
    const cell = big ? 46 : 40;
    const b = tr.bounds;
    for (let x = b.minx - maxDist; th.buildings >= 1 && x < b.maxx + maxDist; x += cell) for (let z = b.minz - maxDist; z < b.maxz + maxDist; z += cell) {
      const px = x + (R() - 0.5) * cell * 0.3, pz = z + (R() - 0.5) * cell * 0.3;
      const dc = view.distC(px, pz);
      if (dc < 24 || dc > maxDist) continue;
      if (view.inWater(px, pz) || occ.has(occKey(px, pz))) continue;
      if (th.buildings === 1 && R() < 0.45) continue;
      const w = cell * (0.55 + R() * 0.3), d = cell * (0.55 + R() * 0.3);
      if (!clearOfTrack(px, pz, Math.max(w, d) * 0.75 + 4)) continue;
      let h = big ? 18 + Math.pow(R(), 2.2) * 150 * (1 - smoothstep(200, 650, dc) * 0.3) : 9 + R() * 22;
      if (th.buildings === 3) h = 12 + Math.pow(R(), 1.6) * 90;
      const kind = facadeKinds[Math.floor(R() * facadeKinds.length)];
      // align with the nearest bit of road
      const ni = tr.nearestIndex(px, pz);
      addBuilding(px, pz, w, d, h, -tr.heading[ni], kind);
    }
    for (const [kind, list] of byKind) {
      const F = TX.facade(kind, 256, 5);
      const mat = new THREE.MeshStandardMaterial({ map: F.map, roughness: 0.75, metalness: 0.1, emissive: night ? 0xffffff : 0x000000, emissiveMap: F.emissiveMap, emissiveIntensity: night ? 0.9 : 0 });
      const m = new THREE.Mesh(merge(list), mat);
      m.castShadow = true; m.receiveShadow = true;
      root.add(m);
    }
    // neon signs on the boulevard
    if (th.neon) {
      const neonParts = [];
      const cols = [0xff2bd6, 0x2bf0ff, 0xffe12b, 0x7a2bff, 0xff4b2b, 0x2bff8a];
      for (let s = 40; s < tr.length; s += 70) {
        const i = tr.idx(s), side = Math.floor(s / 70) % 2, sg = side === 0 ? -1 : 1;
        const off = tr.bar[side][i] + 8 + R() * 6;
        const p = tr.toWorld(s, sg * off);
        if (view.inWater(p.x, p.z) || !clearOfTrack(p.x, p.z, 2)) continue;
        const M = frameAt(tr, s, sg * off);
        const w = 6 + R() * 10, h = 2 + R() * 4;
        const g = boxAt(w, h, 0.3, 0, 8 + R() * 18, 0).applyMatrix4(M);
        neonParts.push(tint(g, cols[Math.floor(R() * cols.length)]));
      }
      if (neonParts.length) {
        const m = new THREE.Mesh(merge(neonParts, { colors: true }), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
        m.material.color.setScalar(2.2);
        root.add(m);
      }
    }
    // airfield hangars
    if (th.hangars) {
      const hs = [];
      for (let k = 0; k < 6; k++) {
        for (let t = 0; t < 30; t++) {
          const x = b.minx - 200 + R() * (b.maxx - b.minx + 400), z = b.minz - 200 + R() * (b.maxz - b.minz + 400);
          if (view.distC(x, z) < 60 || occ.has(occKey(x, z)) || !clearOfTrack(x, z, 40)) continue;
          const y = view.groundY(x, z);
          const shell = new THREE.CylinderGeometry(18, 18, 50, 16, 1, false, 0, Math.PI);
          shell.rotateZ(Math.PI / 2); shell.rotateY(R() * Math.PI); shell.translate(x, y, z);
          hs.push(tint(shell, 0x9aa1a8));
          markOcc(x, z, 30);
          break;
        }
      }
      addMerged(hs, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide }));
    }
  }

  // ======================= ferris wheel (hills theme) =======================
  if (th.wheel) {
    const b = tr.bounds;
    for (let t = 0; t < 200; t++) {
      const x = b.minx + R() * (b.maxx - b.minx), z = b.minz + R() * (b.maxz - b.minz);
      if (view.distC(x, z) < 90 || !clearOfTrack(x, z, 70)) continue;
      const y = view.groundY(x, z);
      const grp = new THREE.Group();
      const rimMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.5, roughness: 0.4, emissive: night ? 0xffd090 : 0, emissiveIntensity: night ? 0.6 : 0 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(32, 0.6, 6, 64), rimMat);
      const spokes = [];
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; const sp = new THREE.CylinderGeometry(0.15, 0.15, 32, 4); sp.translate(0, 16, 0); sp.rotateZ(a); spokes.push(sp); }
      const sm = new THREE.Mesh(merge(spokes), rimMat);
      const cabins = [];
      for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; const c = boxAt(2, 2.4, 2, Math.cos(a) * 32, Math.sin(a) * 32 - 2.4, 0); cabins.push(tint(c, [0xff4b4b, 0x4bb4ff, 0xffd84b, 0x4bff8a][k % 4])); }
      const cm = new THREE.Mesh(merge(cabins, { colors: true }), vc);
      const wheel = new THREE.Group(); wheel.add(rim, sm, cm); wheel.position.y = 36;
      const legs = [boxAt(1, 37, 1, -10, 0, -3), boxAt(1, 37, 1, 10, 0, -3), boxAt(1, 37, 1, -10, 0, 3), boxAt(1, 37, 1, 10, 0, 3)];
      legs[0].rotateZ(-0.27); legs[1].rotateZ(0.27); legs[2].rotateZ(-0.27); legs[3].rotateZ(0.27);
      grp.add(new THREE.Mesh(merge(legs), new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.5, roughness: 0.4 })));
      grp.add(wheel);
      grp.position.set(x, y, z); grp.rotation.y = R() * Math.PI;
      grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      root.add(grp);
      view.animated.push({ update: (dt) => { wheel.rotation.z += dt * 0.03; } });
      break;
    }
  }

  // ======================= boats in the harbour =======================
  if (th.boats && view.lake) {
    const L = view.lake, boats = [];
    for (let k = 0, t = 0; k < 40 && t < 600; t++) {
      const a = R() * Math.PI * 2, r = L.r * (0.35 + R() * 0.6);
      const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
      if (!view.inWater(x, z) || view.distC(x, z) < 50) continue;
      const len = 10 + R() * 28, yaw = R() * Math.PI;
      const hull = boxAt(len, 2.2, len * 0.28, 0, -1.2, 0); const deck = boxAt(len * 0.55, 2.2 + R() * 3, len * 0.22, -len * 0.08, 1, 0);
      const mast = boxAt(0.25, len * 0.9, 0.25, len * 0.1, 1, 0);
      for (const [g, c] of [[hull, 0xf4f4f4], [deck, 0xe6e6e6], [mast, 0xbcbcbc]]) { g.rotateY(yaw); g.translate(x, L.level, z); boats.push(tint(g, c)); }
      k++;
    }
    addMerged(boats, vc);
  }

  // ======================= distant hills / skyline =======================
  {
    const cx = (tr.bounds.minx + tr.bounds.maxx) / 2, cz = (tr.bounds.minz + tr.bounds.maxz) / 2;
    const r0 = Math.max(tr.bounds.maxx - tr.bounds.minx, tr.bounds.maxz - tr.bounds.minz) / 2 + 3500;
    if ((th.hills || 0) >= 20 || th.ground === "sand") {
      const n = 160, P = [], idx = [];
      const amp = th.ground === "sand" ? 260 : 700;
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const h = (fbm2(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10, 4, 5) - 0.25) * amp;
        const x = cx + Math.cos(a) * r0, z = cz + Math.sin(a) * r0;
        P.push(x, view.tc.edgeY - 30, z, x, view.tc.edgeY + Math.max(40, h), z);
        if (k < n) { const b2 = k * 2; idx.push(b2, b2 + 2, b2 + 1, b2 + 1, b2 + 2, b2 + 3); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx);
      const col = night ? 0x10131a : th.ground === "sand" ? 0xc7a985 : 0x7d93a6;
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, fog: false, side: THREE.DoubleSide }));
      m.name = "farHills"; root.add(m); out.farHills = m;
    }
    if (th.buildings >= 2) {
      const sky = [];
      for (let k = 0; k < 220; k++) {
        const a = R() * Math.PI * 2, r = r0 - 2600 + R() * 1400;
        const w = 30 + R() * 60, h = 60 + Math.pow(R(), 1.5) * 320;
        const g = boxAt(w, h, w); g.translate(cx + Math.cos(a) * r, view.tc.edgeY, cz + Math.sin(a) * r);
        sky.push(g);
      }
      const F = TX.facade(1, 256, 9);
      const m = new THREE.Mesh(merge(sky), new THREE.MeshStandardMaterial({ map: F.map, emissive: night ? 0xffffff : 0, emissiveMap: F.emissiveMap, emissiveIntensity: night ? 1 : 0, roughness: 0.6, fog: true }));
      root.add(m);
    }
  }

  return out;
}

// ---------- tree models (vertex coloured) ----------
function jitter(g, amt, seed) {
  const R = rng(seed), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + (R() - 0.5) * amt, p.getY(i) + (R() - 0.5) * amt, p.getZ(i) + (R() - 0.5) * amt);
  g.computeVertexNormals();
  return g;
}
function pineGeo() {
  const parts = [tint(place(new THREE.CylinderGeometry(0.22, 0.32, 4, 6), [0, 2, 0]), 0x4a3524)];
  const greens = [0x1f4a2a, 0x24532f, 0x2a5c33];
  for (let k = 0; k < 4; k++) {
    const r = 3.4 - k * 0.7, h = 4.4 - k * 0.6;
    parts.push(tint(place(new THREE.ConeGeometry(r, h, 8), [0, 3.4 + k * 2.3 + h / 2, 0]), greens[k % 3]));
  }
  return merge(parts, { colors: true });
}
function broadGeo() {
  const parts = [tint(place(new THREE.CylinderGeometry(0.28, 0.42, 4.5, 6), [0, 2.25, 0]), 0x5a4330)];
  const greens = [0x3f6b2b, 0x4a7a33, 0x36602a, 0x557f37];
  const blobs = [[0, 6.6, 0, 3.4], [1.9, 5.6, 0.8, 2.5], [-1.7, 5.8, -0.6, 2.6], [0.4, 8.2, -0.5, 2.3], [-0.6, 5.4, 1.8, 2.2]];
  blobs.forEach((b, k) => parts.push(tint(jitter(place(new THREE.IcosahedronGeometry(b[3], 1), [b[0], b[1], b[2]]), 0.5, k + 3), greens[k % 4])));
  return merge(parts, { colors: true });
}
function palmGeo() {
  const parts = [];
  let x = 0, y = 0;
  for (let k = 0; k < 6; k++) {
    const seg = place(new THREE.CylinderGeometry(0.22 - k * 0.012, 0.26 - k * 0.012, 1.7, 6), [x, y + 0.85, 0], [0, 0, -0.05 * k]);
    parts.push(tint(seg, 0x7a6248));
    x += Math.sin(0.05 * k) * 1.7; y += 1.65;
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const f = new THREE.PlaneGeometry(4.2, 0.9, 4, 1);
    const p = f.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = (p.getX(i) + 2.1) / 4.2; p.setY(i, p.getY(i) - t * t * 1.6); p.setX(i, p.getX(i) + 2.1); }
    f.rotateX(Math.PI / 2);
    for (let i = 0; i < p.count; i++) { const t = (p.getX(i)) / 4.2; p.setY(i, -t * t * 1.8); }
    f.rotateY(a); f.translate(x, y, 0);
    parts.push(tint(f, k % 2 ? 0x3d7a2e : 0x4c8a34));
  }
  const g = merge(parts, { colors: true });
  return g;
}
