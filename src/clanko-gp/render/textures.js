// CLANKO GP — procedural textures. Everything is generated at load time (tileable noise, normal maps,
// painted signs), so the game needs no image downloads. Sizes follow the graphics quality.

import * as THREE from "three";
import { rng } from "../core/math.js";

// ---------- tileable noise ----------
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** value noise with `period` lattice cells across a size x size tile (wraps seamlessly) */
export function valueNoise(size, period, seed) {
  const out = new Float32Array(size * size);
  const lat = new Float32Array(period * period);
  for (let j = 0; j < period; j++) for (let i = 0; i < period; i++) lat[j * period + i] = hash2(i, j, seed);
  const sc = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * sc, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % period) * period, r1 = ((y0 + 1) % period) * period;
    for (let x = 0; x < size; x++) {
      const fx = x * sc, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % period, c1 = (x0 + 1) % period;
      const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
      const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}
export function fbm(size, octaves, period, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const p = Math.min(size, period << o);
    const n = valueNoise(size, p, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function dataTex(size, rgba, { srgb = false, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** tangent-space normal map from a height field */
function normalFrom(size, h, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
    const dx = (h[y * size + xr] - h[y * size + xl]) * strength, dy = (h[yd * size + x] - h[yu * size + x]) * strength;
    const l = Math.hypot(dx, dy, 1);
    const k = (y * size + x) * 4;
    out[k] = (-dx / l * 0.5 + 0.5) * 255; out[k + 1] = (dy / l * 0.5 + 0.5) * 255; out[k + 2] = (1 / l * 0.5 + 0.5) * 255; out[k + 3] = 255;
  }
  return out;
}
/** stamp round "stones" into a height field (wrapping) and report their positions for colouring */
function stones(size, h, count, rMin, rMax, seed, cb) {
  const R = rng(seed);
  for (let n = 0; n < count; n++) {
    const cx = R() * size, cy = R() * size, r = rMin + R() * (rMax - rMin), hgt = 0.5 + R() * 0.5, tone = R();
    const r2 = r * r, ir = Math.ceil(r);
    for (let dy = -ir; dy <= ir; dy++) for (let dx = -ir; dx <= ir; dx++) {
      const d2 = dx * dx + dy * dy; if (d2 > r2) continue;
      const x = ((Math.floor(cx) + dx) % size + size) % size, y = ((Math.floor(cy) + dy) % size + size) % size;
      const v = Math.sqrt(1 - d2 / r2) * hgt;
      const i = y * size + x;
      if (v > h[i]) { h[i] = v; cb && cb(i, tone, v); }
    }
  }
}

const cache = new Map();
function cached(key, make) { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); }

// ---------- surfaces ----------
export function asphalt(size = 512, aniso = 8) {
  return cached("asphalt" + size, () => {
    const h = fbm(size, 5, 8, 11, 0.55);
    const tone = new Float32Array(size * size);
    const st = new Float32Array(size * size);
    stones(size, st, Math.round(size * size * 0.03), 0.5, size / 300 + 0.7, 7, (i, t) => { tone[i] = t; });
    const col = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
    const hh = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const base = 78 + (h[i] - 0.5) * 22;
      let c = base;
      if (st[i] > 0) c = base + (tone[i] - 0.45) * 30 * Math.min(1, st[i] * 1.5);
      const k = i * 4;
      col[k] = c * 0.98; col[k + 1] = c; col[k + 2] = c * 1.03; col[k + 3] = 255;
      const r = 230 - st[i] * 70 - (h[i] - 0.5) * 30;
      rough[k] = rough[k + 1] = rough[k + 2] = r; rough[k + 3] = 255;
      hh[i] = st[i] * 0.9 + h[i] * 0.3;
    }
    return { map: dataTex(size, col, { srgb: true, aniso }), roughnessMap: dataTex(size, rough, { aniso }), normalMap: dataTex(size, normalFrom(size, hh, 2.2), { aniso }) };
  });
}

export function grass(size = 512, aniso = 8, dry = 0) {
  return cached("grass" + size + dry, () => {
    const h = fbm(size, 4, 6, 21, 0.6), fine = valueNoise(size, size / 2, 23);
    const col = new Uint8Array(size * size * 4), hh = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const v = h[i], f = fine[i];
      const k = i * 4;
      const g = 0.8 + (v - 0.5) * 0.5 + (f - 0.5) * 0.35;
      col[k] = (62 + dry * 60) * g; col[k + 1] = (104 + dry * 20) * g; col[k + 2] = (40 + dry * 10) * g; col[k + 3] = 255;
      hh[i] = f * 0.6 + v * 0.4;
    }
    return { map: dataTex(size, col, { srgb: true, aniso }), normalMap: dataTex(size, normalFrom(size, hh, 3), { aniso }) };
  });
}

export function gravel(size = 512, aniso = 8) {
  return cached("gravel" + size, () => {
    const h = new Float32Array(size * size), tone = new Float32Array(size * size);
    const base = fbm(size, 3, 8, 31);
    stones(size, h, Math.round(size * size * 0.06), 1.2, size / 90 + 1.5, 33, (i, t) => { tone[i] = t; });
    const col = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const k = i * 4, t = tone[i], sh = 0.55 + h[i] * 0.5;
      const r = (150 + t * 60) * sh, g = (138 + t * 52) * sh, b = (118 + t * 40) * sh;
      col[k] = r + (base[i] - 0.5) * 20; col[k + 1] = g + (base[i] - 0.5) * 20; col[k + 2] = b; col[k + 3] = 255;
    }
    return { map: dataTex(size, col, { srgb: true, aniso }), normalMap: dataTex(size, normalFrom(size, h, 4), { aniso }) };
  });
}

export function sand(size = 512, aniso = 8) {
  return cached("sand" + size, () => {
    const h = fbm(size, 5, 4, 41, 0.55), fine = valueNoise(size, size / 2, 43);
    const col = new Uint8Array(size * size * 4), hh = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, k = i * 4;
      const ripple = Math.sin((x / size) * Math.PI * 2 * 9 + h[i] * 6) * 0.5 + 0.5;
      const v = 0.85 + (h[i] - 0.5) * 0.3 + (fine[i] - 0.5) * 0.12;
      col[k] = 214 * v; col[k + 1] = 182 * v; col[k + 2] = 132 * v; col[k + 3] = 255;
      hh[i] = ripple * 0.5 + fine[i] * 0.3;
    }
    return { map: dataTex(size, col, { srgb: true, aniso }), normalMap: dataTex(size, normalFrom(size, hh, 1.6), { aniso }) };
  });
}

export function concrete(size = 256, aniso = 8, tint = 1) {
  return cached("concrete" + size + tint, () => {
    const h = fbm(size, 5, 6, 51, 0.6);
    const col = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, k = i * 4;
      let v = (170 + (h[i] - 0.5) * 50) * tint;
      if (x % (size / 2) < 2) v *= 0.7; // panel seams
      col[k] = v; col[k + 1] = v; col[k + 2] = v * 0.98; col[k + 3] = 255;
    }
    return { map: dataTex(size, col, { srgb: true, aniso }), normalMap: dataTex(size, normalFrom(size, h, 1.2), { aniso }) };
  });
}

/** red/white (or other colours) kerb blocks; u runs along the track, one texture = two blocks */
export function kerb(colA = "#d2232a", colB = "#f2f2f2", size = 256) {
  return cached("kerb" + colA + colB + size, () => {
    const c = document.createElement("canvas"); c.width = size; c.height = size / 4;
    const g = c.getContext("2d");
    g.fillStyle = colA; g.fillRect(0, 0, size / 2, c.height);
    g.fillStyle = colB; g.fillRect(size / 2, 0, size / 2, c.height);
    // wear and dirt
    const R = rng(61);
    for (let n = 0; n < 900; n++) { g.fillStyle = `rgba(30,30,30,${R() * 0.12})`; g.fillRect(R() * size, R() * c.height, 1 + R() * 3, 1 + R() * 2); }
    const grd = g.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, "rgba(0,0,0,0.18)"); grd.addColorStop(0.25, "rgba(0,0,0,0)"); grd.addColorStop(1, "rgba(0,0,0,0.1)");
    g.fillStyle = grd; g.fillRect(0, 0, size, c.height);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8;
    return t;
  });
}

export function carbon(size = 128) {
  return cached("carbon" + size, () => {
    const col = new Uint8Array(size * size * 4), hh = new Float32Array(size * size);
    const cell = size / 16;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const dir = (cx + cy) % 2;
      const f = dir ? (x % cell) / cell : (y % cell) / cell;
      const v = 20 + Math.sin(f * Math.PI) * 11;
      const i = y * size + x, k = i * 4;
      col[k] = v; col[k + 1] = v; col[k + 2] = v * 1.08; col[k + 3] = 255;
      hh[i] = Math.sin(f * Math.PI) * 0.5;
    }
    return { map: dataTex(size, col, { srgb: true }), normalMap: dataTex(size, normalFrom(size, hh, 1.5)) };
  });
}

/** a strip of fictional advertising boards */
const BRANDS = [
  ["CLANKO100.COM", "#ffd23a", "#111"], ["VOLTA ENERGY", "#0b3d91", "#fff"], ["NORDHAVEN", "#f4f4f4", "#c8102e"],
  ["KESTREL TIME", "#111", "#e7c66b"], ["APEXLINE TYRES", "#ffe600", "#111"], ["MERIDIAN AIR", "#e8f1ff", "#1a4fa0"],
  ["SOLENNE", "#7a0026", "#fff"], ["IRONHART OIL", "#1d1d1d", "#ff6a00"], ["ZEPHYR MOBILE", "#00a3a1", "#fff"], ["CORVANE BANK", "#14213d", "#fca311"],
];
export function adStrip(width = 2048, height = 128, seed = 1) {
  return cached("ads" + width + seed, () => {
    const c = document.createElement("canvas"); c.width = width; c.height = height;
    const g = c.getContext("2d");
    const R = rng(seed);
    const n = 4, w = width / n;
    for (let k = 0; k < n; k++) {
      const [txt, bg, fg] = BRANDS[Math.floor(R() * BRANDS.length)];
      g.fillStyle = bg; g.fillRect(k * w, 0, w, height);
      g.fillStyle = fg; g.font = `900 ${height * 0.52}px Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(txt, k * w + w / 2, height * 0.54, w * 0.9);
      g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(k * w, 0, 3, height);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  });
}

/** grandstand crowd: rows of seats with people */
export function crowd(size = 512, density = 0.8, seed = 3) {
  return cached("crowd" + size + density + seed, () => {
    const c = document.createElement("canvas"); c.width = size; c.height = size;
    const g = c.getContext("2d");
    const R = rng(seed);
    const rows = 16, rowH = size / rows;
    const seats = ["#2856a8", "#b8202b", "#e0e0e0", "#1f7a3a"];
    for (let r = 0; r < rows; r++) {
      g.fillStyle = r % 2 ? "#2b2b2f" : "#323238"; g.fillRect(0, r * rowH, size, rowH);
      const seat = seats[Math.floor(R() * seats.length)];
      for (let x = 0; x < size; x += rowH * 0.55) {
        if (R() > density) { g.fillStyle = seat; g.fillRect(x + 1, r * rowH + rowH * 0.45, rowH * 0.45, rowH * 0.45); continue; }
        const hue = Math.floor(R() * 360), l = 30 + R() * 45;
        g.fillStyle = `hsl(${hue},${40 + R() * 50}%,${l}%)`;
        g.fillRect(x + 1, r * rowH + rowH * 0.38, rowH * 0.46, rowH * 0.55);
        g.fillStyle = `hsl(${20 + R() * 20},${30 + R() * 30}%,${25 + R() * 50}%)`;
        g.beginPath(); g.arc(x + 1 + rowH * 0.23, r * rowH + rowH * 0.27, rowH * 0.16, 0, Math.PI * 2); g.fill();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  });
}

/** building facade with windows; returns colour + emissive (lit windows at night) */
export function facade(kind = 0, size = 256, seed = 5) {
  return cached("facade" + kind + size + seed, () => {
    const R = rng(seed + kind * 17);
    const mk = () => { const c = document.createElement("canvas"); c.width = size; c.height = size; return c; };
    const c = mk(), e = mk();
    const g = c.getContext("2d"), ge = e.getContext("2d");
    const walls = ["#cfc6b8", "#9aa3ad", "#e2dccf", "#7f8790", "#b7a089", "#d8d0c0", "#556070"];
    g.fillStyle = walls[kind % walls.length]; g.fillRect(0, 0, size, size);
    ge.fillStyle = "#000"; ge.fillRect(0, 0, size, size);
    const glass = kind % 3 === 1;
    const cols = glass ? 8 : 6, rows = glass ? 10 : 8;
    const cw = size / cols, rh = size / rows;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = q * cw + cw * (glass ? 0.06 : 0.2), y = r * rh + rh * (glass ? 0.08 : 0.22), w = cw * (glass ? 0.88 : 0.6), h = rh * (glass ? 0.84 : 0.56);
      const v = 40 + R() * 50;
      g.fillStyle = glass ? `rgb(${v * 0.8},${v + 20},${v + 45})` : `rgb(${v},${v + 8},${v + 18})`;
      g.fillRect(x, y, w, h);
      if (R() < 0.42) { const warm = R() < 0.7; ge.fillStyle = warm ? `rgba(255,${200 + R() * 40},${130 + R() * 60},1)` : "rgba(200,225,255,1)"; ge.fillRect(x, y, w, h); }
    }
    const tex = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
    return { map: tex(c, true), emissiveMap: tex(e, true) };
  });
}

/** a see-through catch fence */
export function fence(size = 128) {
  return cached("fence" + size, () => {
    const c = document.createElement("canvas"); c.width = size; c.height = size;
    const g = c.getContext("2d");
    g.clearRect(0, 0, size, size);
    g.strokeStyle = "rgba(170,175,180,0.95)"; g.lineWidth = 1.4;
    const n = 8, st = size / n;
    for (let k = -n; k <= n * 2; k++) {
      g.beginPath(); g.moveTo(k * st, 0); g.lineTo(k * st + size, size); g.stroke();
      g.beginPath(); g.moveTo(k * st, size); g.lineTo(k * st + size, 0); g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  });
}

/** stacked tyre wall seen from the front: tyre circles behind a coloured belt */
export function tyreWall(size = 256, belt = "#d22") {
  return cached("tyres" + size + belt, () => {
    const c = document.createElement("canvas"); c.width = size; c.height = size / 2;
    const g = c.getContext("2d");
    g.fillStyle = "#151515"; g.fillRect(0, 0, size, size / 2);
    const r = size / 8;
    for (let row = 0; row < 2; row++) for (let k = 0; k < 4; k++) {
      const x = k * r * 2 + r, y = row * r * 2 + r;
      g.fillStyle = "#222"; g.beginPath(); g.arc(x, y, r * 0.96, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0b0b0b"; g.beginPath(); g.arc(x, y, r * 0.5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = belt; g.fillRect(0, size * 0.16, size, size * 0.18);
    g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(0, size * 0.16, size, size * 0.012); g.fillRect(0, size * 0.328, size, size * 0.012);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  });
}

/** soft round sprite used for particles (smoke, spray, sparks) */
export function softDot(size = 64) {
  return cached("dot" + size, () => {
    const c = document.createElement("canvas"); c.width = c.height = size;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.4, "rgba(255,255,255,0.5)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); return t;
  });
}

/** cloud layer texture (tileable fbm) */
export function clouds(size = 512, cover = 0.5, seed = 71) {
  return cached("clouds" + size + cover + seed, () => {
    const h = fbm(size, 6, 4, seed, 0.55);
    const col = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const v = Math.max(0, Math.min(1, (h[i] - (1 - cover) * 0.75 - 0.12) * 3.2));
      const k = i * 4;
      const sh = 205 + h[i] * 50;
      col[k] = sh; col[k + 1] = sh; col[k + 2] = sh + 6; col[k + 3] = v * 255;
    }
    return dataTex(size, col, { srgb: true });
  });
}

export function disposeTextures() {
  for (const v of cache.values()) {
    if (v && v.isTexture) v.dispose();
    else if (v) for (const t of Object.values(v)) t && t.isTexture && t.dispose();
  }
  cache.clear();
}
