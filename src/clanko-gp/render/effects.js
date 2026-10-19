// CLANKO GP — particles and other effects: sparks, tyre smoke, dust, wet spray, rain, skid marks
// and broken parts that fly off and lie on the track.

import * as THREE from "three";
import { clamp, lerp, rng } from "../core/math.js";
import * as TX from "./textures.js";

const VERT = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uMap; varying float vAlpha; varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor, t.a * vAlpha);
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(max, additive) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.grow = new Float32Array(max);
    this.alpha = new Float32Array(max); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.col = new Float32Array(max * 3); this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.aPos); g.setAttribute("aSize", this.aSize); g.setAttribute("aAlpha", this.aAlpha); g.setAttribute("aColor", this.aCol);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: TX.softDot(64) }, uScale: { value: 600 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }
  spawn(x, y, z, vx, vy, vz, size, grow, life, r, g, b, alpha, drag = 0.5, grav = 0) {
    let i;
    if (this.n < this.max) i = this.n++;
    else { // replace the oldest
      let oldest = 0, oa = -1; for (let k = 0; k < this.n; k += 7) { const a = this.age[k] / this.life[k]; if (a > oa) { oa = a; oldest = k; } } i = oldest;
    }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.age[i] = 0;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.alpha[i] = alpha; this.a0[i] = alpha; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap with last
        n--;
        if (i !== n) {
          for (const arr of [this.pos, this.vel, this.col]) { arr[i * 3] = arr[n * 3]; arr[i * 3 + 1] = arr[n * 3 + 1]; arr[i * 3 + 2] = arr[n * 3 + 2]; }
          for (const arr of [this.size, this.grow, this.life, this.age, this.alpha, this.drag, this.grav, this.a0]) arr[i] = arr[n];
          i--;
        }
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.age[i] / this.life[i];
      this.alpha[i] = this.a0[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
    }
    this.n = n;
    this.points.geometry.setDrawRange(0, n);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aCol.needsUpdate = true;
  }
  clear() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
}

/** dark marks left by locked or spinning tyres */
class SkidMarks {
  constructor(max = 3000) {
    this.max = max; this.next = 0;
    const g = new THREE.BufferGeometry();
    this.P = new Float32Array(max * 4 * 3); this.A = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let k = 0; k < max; k++) { const b = k * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], k * 6); }
    g.setAttribute("position", new THREE.BufferAttribute(this.P, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.A, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: "attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "varying float vA; void main(){ gl_FragColor = vec4(0.03,0.03,0.03, vA); }",
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    this.last = new Map();
  }
  add(key, x, y, z, nx, nz, w, alpha) {
    const prev = this.last.get(key);
    this.last.set(key, { x, y, z, nx, nz, t: performance.now() });
    if (!prev || performance.now() - prev.t > 120) return;
    const dx = x - prev.x, dz = z - prev.z;
    if (dx * dx + dz * dz < 0.09) { this.last.set(key, prev); return; }
    const k = this.next; this.next = (this.next + 1) % this.max;
    const P = this.P, b = k * 12;
    P[b] = prev.x - prev.nx * w; P[b + 1] = prev.y + 0.02; P[b + 2] = prev.z - prev.nz * w;
    P[b + 3] = prev.x + prev.nx * w; P[b + 4] = prev.y + 0.02; P[b + 5] = prev.z + prev.nz * w;
    P[b + 6] = x - nx * w; P[b + 7] = y + 0.02; P[b + 8] = z - nz * w;
    P[b + 9] = x + nx * w; P[b + 10] = y + 0.02; P[b + 11] = z + nz * w;
    this.A.fill(alpha, k * 4, k * 4 + 4);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
  break(key) { this.last.delete(key); }
  clear() { this.P.fill(0); this.A.fill(0); this.mesh.geometry.attributes.position.needsUpdate = true; }
}

export class Effects {
  constructor(scene, track, opts = {}) {
    this.scene = scene; this.track = track;
    this.q = opts.particles != null ? opts.particles : 1;
    this.groundY = opts.groundY || (() => 0);
    this.glow = new Particles(Math.round(1500 * this.q) + 200, true);
    this.smoke = new Particles(Math.round(2500 * this.q) + 300, false);
    this.skids = new SkidMarks(Math.round(2500 * this.q) + 500);
    scene.add(this.glow.points, this.smoke.points, this.skids.mesh);
    this.debris = [];
    this.R = rng(55);
    this.rainOn = 0;
    this._rain();
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.2 });
  }

  _rain() {
    const n = Math.round(5000 * this.q) + 1000;
    this.rainN = n;
    this.rainPos = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    this.rainLines = new Float32Array(n * 6);
    g.setAttribute("position", new THREE.BufferAttribute(this.rainLines, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8c6d6, transparent: true, opacity: 0.32, depthWrite: false }));
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false;
    const R = rng(3);
    for (let i = 0; i < n; i++) { this.rainPos[i * 3] = (R() - 0.5) * 60; this.rainPos[i * 3 + 1] = R() * 30; this.rainPos[i * 3 + 2] = (R() - 0.5) * 60; }
    this.scene.add(this.rainMesh);
  }

  setRain(intensity) { this.rainOn = intensity; this.rainMesh.visible = intensity > 0.02; this.rainMesh.material.opacity = 0.12 + intensity * 0.3; }

  sparks(x, y, z, vx, vz, n = 12, power = 1) {
    const R = this.R;
    n = Math.round(n * this.q);
    for (let k = 0; k < n; k++) {
      const s = 0.5 + R() * 0.9;
      this.glow.spawn(x + (R() - 0.5) * 0.3, y + 0.05, z + (R() - 0.5) * 0.3, vx * s + (R() - 0.5) * 6 * power, 1 + R() * 3 * power, vz * s + (R() - 0.5) * 6 * power, 0.09 + R() * 0.06, 0, 0.25 + R() * 0.35, 6, 3.2 + R(), 1.1, 1, 0.6, 9.8);
    }
  }
  tyreSmoke(x, y, z, vx, vz, amount, dark = 0.85) {
    const R = this.R;
    if (R() > amount * this.q) return;
    const c = dark * (0.9 + R() * 0.1);
    this.smoke.spawn(x + (R() - 0.5) * 0.4, y + 0.25, z + (R() - 0.5) * 0.4, vx * 0.25 + (R() - 0.5), 0.6 + R() * 0.6, vz * 0.25 + (R() - 0.5), 0.6, 2.6, 1.6 + R() * 1.4, c, c, c, 0.55, 1.4, -0.15);
  }
  dust(x, y, z, vx, vz, amount, color) {
    const R = this.R;
    if (R() > amount * this.q) return;
    this.smoke.spawn(x + (R() - 0.5) * 0.6, y + 0.15, z + (R() - 0.5) * 0.6, vx * 0.35 + (R() - 0.5) * 2, 0.8 + R() * 1.6, vz * 0.35 + (R() - 0.5) * 2, 0.5, 2.2, 1.2 + R(), color[0], color[1], color[2], 0.6, 1.2, 1.5);
  }
  spray(x, y, z, vx, vz, amount) {
    const R = this.R;
    for (let k = 0; k < 3; k++) {
      if (R() > amount * this.q) continue;
      this.smoke.spawn(x + (R() - 0.5) * 1.6, y + 0.3 + R() * 0.4, z + (R() - 0.5) * 1.6, vx * 0.55 + (R() - 0.5) * 2, 0.3 + R() * 1.2, vz * 0.55 + (R() - 0.5) * 2, 1.0, 4.5, 0.8 + R() * 0.7, 0.82, 0.85, 0.88, 0.32, 2.2, 0.2);
    }
  }
  /** a broken part flies off */
  debrisPiece(kind, x, y, z, vx, vz, color) {
    let g;
    if (kind === "wheel") { g = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 16); g.rotateX(Math.PI / 2); }
    else if (kind === "rw") g = new THREE.BoxGeometry(0.4, 0.5, 1.0);
    else g = new THREE.BoxGeometry(0.45, 0.06, 0.8);
    const mat = kind === "wheel" ? new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }) : new THREE.MeshStandardMaterial({ color: color || 0x1a1a1c, roughness: 0.45, metalness: 0.2 });
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.position.set(x, y + 0.4, z);
    const R = this.R;
    const d = { mesh: m, vx: vx * 0.7 + (R() - 0.5) * 6, vy: 3 + R() * 5, vz: vz * 0.7 + (R() - 0.5) * 6, wx: (R() - 0.5) * 12, wy: (R() - 0.5) * 12, wz: (R() - 0.5) * 12, age: 0, rest: false, kind };
    this.scene.add(m);
    this.debris.push(d);
    if (this.debris.length > 40) { const old = this.debris.shift(); this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    return d;
  }

  /** per-frame: emit from cars (list of { car, view, wet }) and move everything */
  update(dt, cars, camera, wetness) {
    for (const { car } of cars) this._emitCar(car, wetness, dt);
    this.glow.update(dt); this.smoke.update(dt);
    const scale = camera ? (camera.isPerspectiveCamera ? 0.5 * window.innerHeight / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) : 600) : 600;
    this.glow.mat.uniforms.uScale.value = scale; this.smoke.mat.uniforms.uScale.value = scale;
    // debris
    for (const d of this.debris) {
      d.age += dt;
      if (!d.rest) {
        d.vy -= 9.81 * dt;
        d.mesh.position.x += d.vx * dt; d.mesh.position.y += d.vy * dt; d.mesh.position.z += d.vz * dt;
        d.mesh.rotation.x += d.wx * dt; d.mesh.rotation.y += d.wy * dt; d.mesh.rotation.z += d.wz * dt;
        const gy = this._ground(d.mesh.position.x, d.mesh.position.z) + 0.1;
        if (d.mesh.position.y < gy) {
          d.mesh.position.y = gy; d.vy = -d.vy * 0.3; d.vx *= 0.6; d.vz *= 0.6; d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5;
          if (Math.abs(d.vy) < 0.8 && Math.hypot(d.vx, d.vz) < 0.6) { d.rest = true; d.mesh.rotation.x = d.kind === "wheel" ? Math.PI / 2 : 0; d.mesh.rotation.z = 0; }
        }
      }
      if (d.age > 50) d.fade = true;
    }
    this.debris = this.debris.filter((d) => { if (d.age > 60) { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); return false; } return true; });
    // rain streaks follow the camera
    if (this.rainMesh.visible && camera) {
      const n = this.rainN, P = this.rainPos, Lb = this.rainLines;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const fall = 11 * dt, active = Math.round(n * clamp(this.rainOn * 1.3, 0.1, 1));
      for (let i = 0; i < n; i++) {
        let y = P[i * 3 + 1] - fall; if (y < -8) y += 30;
        P[i * 3 + 1] = y;
        const wx = ((P[i * 3] - cx + 30) % 60 + 60) % 60 - 30, wz = ((P[i * 3 + 2] - cz + 30) % 60 + 60) % 60 - 30;
        const x = cx + wx, z = cz + wz;
        const on = i < active;
        Lb[i * 6] = x; Lb[i * 6 + 1] = on ? cy + y : -1e4; Lb[i * 6 + 2] = z;
        Lb[i * 6 + 3] = x + 0.03; Lb[i * 6 + 4] = on ? cy + y + 0.45 : -1e4; Lb[i * 6 + 5] = z + 0.02;
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
    }
  }
  _ground(x, z) {
    const tr = this.track;
    const q = tr.query(x, z, this._hint, this._q || (this._q = {}));
    this._hint = q.i;
    const side = q.d < 0 ? 0 : 1;
    if (Math.abs(q.d) <= tr.bar[side][q.i] + 1.5) return q.y;
    return this.groundY(x, z);
  }

  _emitCar(car, wetness, dt) {
    const sp = car.speed;
    if (sp < 2 || car.removed) return;
    const ch = Math.cos(car.h), sh = Math.sin(car.h);
    for (let k = 0; k < 4; k++) {
      const w = car.wheels[k];
      if (w.detached) continue;
      const wx = car.x + ch * w.x - sh * w.z, wz = car.z + sh * w.x + ch * w.z, wy = car.y;
      const key = car.id + ":" + k;
      const slide = (w.locked ? 1 : 0) + (w.spinning ? clamp(w.spin / 8, 0, 1) : 0) + clamp((Math.abs(w.slip) / 0.088 - 1.3) * 0.6, 0, 1);
      const surf = w.surf;
      if (surf === 0 || surf === 1 || surf === 6) {
        if (slide > 0.25 && wetness < 0.3) {
          this.tyreSmoke(wx, wy, wz, car.vx, car.vz, clamp(slide * 0.7, 0, 0.9) * (sp > 8 ? 1 : 0.5));
          this.skids.add(key, wx, wy, wz, -sh, ch, w.front ? 0.15 : 0.2, clamp(slide * 0.5, 0.15, 0.5));
        } else this.skids.break(key);
        if (wetness > 0.1 && sp > 12 && !w.front) this.spray(wx - ch * 0.4, wy, wz - sh * 0.4, car.vx, car.vz, clamp(wetness * 1.6, 0, 1) * clamp(sp / 60, 0.2, 1));
      } else {
        this.skids.break(key);
        if (sp > 5) {
          const col = surf === 3 ? [0.62, 0.56, 0.46] : surf === 5 ? [0.82, 0.7, 0.5] : surf === 2 ? [0.4, 0.36, 0.26] : [0.5, 0.5, 0.5];
          this.dust(wx, wy, wz, car.vx, car.vz, clamp(sp / 30, 0.15, 0.9), col);
        }
      }
    }
    // sparks from the plank on bumps and kerbs at speed
    if (sp > 55 && (car.kerbWheels > 0 || (car.heave < -0.008)) && this.R() < 0.35 * this.q) {
      this.sparks(car.x - ch * 0.8, car.y, car.z - sh * 0.8, -car.vx * 0.15, -car.vz * 0.15, 4, 0.5);
    }
  }
  clear() { this.glow.clear(); this.smoke.clear(); this.skids.clear(); for (const d of this.debris) this.scene.remove(d.mesh); this.debris = []; }
  dispose() { this.clear(); for (const o of [this.glow.points, this.smoke.points, this.skids.mesh, this.rainMesh]) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); } }
}
