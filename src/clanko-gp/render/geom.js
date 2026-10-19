// CLANKO GP — small geometry helpers shared by the track and car builders.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** merge geometries after making their attributes compatible (non-indexed, position+normal+uv+color) */
export function merge(list, { colors = false } = {}) {
  const prepared = list.filter(Boolean).map((g0) => {
    let g = g0.index ? g0.toNonIndexed() : g0.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (colors && !g.attributes.color) {
      const c = new Float32Array(g.attributes.position.count * 3).fill(1);
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    }
    if (!colors && g.attributes.color) g.deleteAttribute("color");
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    return g;
  });
  if (!prepared.length) return new THREE.BufferGeometry();
  return mergeGeometries(prepared, false);
}

/** paint a geometry with one vertex colour */
export function tint(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

/** apply a transform given as position / euler rotation / scale */
export function place(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...(Array.isArray(s) ? s : [s, s, s])));
  g.applyMatrix4(m);
  return g;
}

/**
 * A grid-based strip builder. Rows run along the circuit, columns across it.
 * pos(r, c) must return [x, y, z]; uv(r, c) returns [u, v]; include(r) says whether quad row r..r+1 is drawn.
 */
export function stripGeometry(rows, cols, pos, uv, include, extra) {
  const nv = (rows + 1) * (cols + 1);
  const P = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
  const extraArr = extra ? new Float32Array(nv * extra.size) : null;
  let k = 0;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++, k++) {
    const p = pos(r, c); P[k * 3] = p[0]; P[k * 3 + 1] = p[1]; P[k * 3 + 2] = p[2];
    const t = uv(r, c); U[k * 2] = t[0]; U[k * 2 + 1] = t[1];
    if (extra) { const e = extra.fn(r, c); for (let q = 0; q < extra.size; q++) extraArr[k * extra.size + q] = extra.size === 1 ? e : e[q]; }
  }
  const idx = [];
  for (let r = 0; r < rows; r++) {
    if (include && !include(r)) continue;
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
  if (extra) g.setAttribute(extra.name, new THREE.BufferAttribute(extraArr, extra.size));
  g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/** loft closed cross-sections into a smooth body. sections: [{ x, pts: [[y, z], ...] }] same point count each */
export function loft(sections, { closeEnds = true, uScale = 1 } = {}) {
  // build from low x to high x so the faces point outwards
  if (sections[0].x > sections[sections.length - 1].x) sections = sections.slice().reverse();
  const n = sections[0].pts.length, m = sections.length;
  const P = [], U = [], idx = [];
  const x0 = sections[0].x, x1 = sections[m - 1].x;
  for (let j = 0; j < m; j++) {
    const s = sections[j];
    for (let i = 0; i <= n; i++) {
      const p = s.pts[i % n];
      P.push(s.x, p[0], p[1]);
      U.push(((s.x - x0) / (x1 - x0 || 1)) * uScale, i / n);
    }
  }
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (!closeEnds) return g;
  // flat caps
  const caps = [];
  for (const [j, flip] of [[0, false], [m - 1, true]]) {
    const s = sections[j];
    let cy = 0, cz = 0; for (const p of s.pts) { cy += p[0]; cz += p[1]; } cy /= n; cz /= n;
    const cp = [s.x, cy, cz], cpts = [], cuv = [];
    for (let i = 0; i < n; i++) {
      const p = s.pts[i], q = s.pts[(i + 1) % n];
      if (flip) cpts.push(...cp, s.x, q[0], q[1], s.x, p[0], p[1]); else cpts.push(...cp, s.x, p[0], p[1], s.x, q[0], q[1]);
      cuv.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.Float32BufferAttribute(cpts, 3));
    cg.setAttribute("uv", new THREE.Float32BufferAttribute(cuv, 2));
    cg.computeVertexNormals();
    caps.push(cg);
  }
  return merge([g, ...caps]);
}

/** superellipse cross-section points (y, z), first point at the bottom centre, going round via +z */
export function section(cy, w, h, n = 16, power = 2.6, flatBottom = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const e = 2 / power;
    let z = Math.sign(c) * Math.pow(Math.abs(c), e) * w / 2;
    let y = Math.sign(s) * Math.pow(Math.abs(s), e) * h / 2;
    if (flatBottom && y < -h / 2 * (1 - flatBottom)) y = -h / 2 * (1 - flatBottom);
    pts.push([cy + y, z]);
  }
  return pts;
}

/** aerofoil element: chord along +x (leading edge at x = 0), thickness up y, span along z (centred) */
export function wing(chord, thick, span, { sweep = 0, camber = 0.06, segs = 4, dip = 0 } = {}) {
  const shape = new THREE.Shape();
  const n = 14;
  const upper = [], lower = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = camber * 4 * t * (1 - t);
    const th = thick * 2.5 * Math.sqrt(t) * (1 - t) * (1 + 0.2 * (1 - t));
    upper.push([t * chord, (c + th) * chord]); lower.push([t * chord, (c - th * 0.45) * chord]);
  }
  shape.moveTo(upper[0][0], upper[0][1]);
  for (let i = 1; i <= n; i++) shape.lineTo(upper[i][0], upper[i][1]);
  for (let i = n - 1; i >= 1; i--) shape.lineTo(lower[i][0], lower[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, steps: segs, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -span / 2);
  if (sweep || dip) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const f = Math.abs(p.getZ(i) / (span / 2));
      p.setX(i, p.getX(i) + sweep * f);
      p.setY(i, p.getY(i) - dip * (1 - f * f));
    }
  }
  g.computeVertexNormals();
  return g;
}
