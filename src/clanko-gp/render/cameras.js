// CLANKO GP — camera rig: chase, far chase, cockpit, helmet, T-cam, wheel cam, TV, helicopter and
// a free orbit camera for replays and photo mode. Smooth, speed-aware, never inside the ground.

import * as THREE from "three";
import { clamp, lerp, wrapAngle } from "../core/math.js";

export const CAMERAS = [
  { id: "chase", name: "Chase" },
  { id: "far", name: "Far chase" },
  { id: "cockpit", name: "Cockpit" },
  { id: "helmet", name: "Helmet" },
  { id: "tcam", name: "T-cam" },
  { id: "wheel", name: "Wheel" },
  { id: "tv", name: "TV" },
  { id: "heli", name: "Helicopter" },
];

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();

export class CameraRig {
  constructor(camera, settings = {}) {
    this.cam = camera;
    this.settings = settings;
    this.mode = settings.camera || "chase";
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.heading = 0;
    this.init = false;
    this.shake = 0;
    this.headRoll = 0; this.headYaw = 0; this.headPitch = 0;
    this.tvIndex = -1;
    this.orbit = { yaw: 0.6, pitch: 0.25, dist: 9, target: new THREE.Vector3() };
    this.lookBack = false;
  }
  setMode(id) { this.mode = id; this.init = false; }
  cycle(dir = 1, allowed) {
    const list = (allowed || CAMERAS.map((c) => c.id));
    const i = list.indexOf(this.mode);
    this.setMode(list[(i + dir + list.length) % list.length]);
    return this.mode;
  }
  get isInside() { return this.mode === "cockpit" || this.mode === "helmet"; }

  /**
   * car: physics car; view: CarView; track; tv spots (array of {s,x,y,z}); dt
   */
  update(dt, car, view, track, tvSpots, groundY) {
    const cam = this.cam, S = this.settings;
    const speed = Math.abs(car.u);
    const ch = Math.cos(car.h), sh = Math.sin(car.h);
    view.root.updateMatrixWorld();
    let fov = S.fov || 62;
    const back = this.lookBack;
    switch (this.mode) {
      case "chase": case "far": {
        const far = this.mode === "far";
        const dist = (far ? 10.5 : 6.4) * (S.chaseDist || 1), height = (far ? 3.2 : 2.05) * (S.chaseHeight || 1);
        // the camera swings round slowly so slides are visible
        const velH = speed > 4 ? Math.atan2(car.vz, car.vx) : car.h;
        const want = wrapAngle(lerp(car.h, car.h + wrapAngle(velH - car.h) * 0.35, 1) + (back ? Math.PI : 0));
        if (!this.init) this.heading = want;
        this.heading = wrapAngle(this.heading + wrapAngle(want - this.heading) * Math.min(1, dt * (back ? 30 : 6.5)));
        const hx = Math.cos(this.heading), hz = Math.sin(this.heading);
        const lag = clamp(speed * 0.004, 0, 0.6);
        const target = _v.set(car.x - hx * (dist + lag), car.y + height, car.z - hz * (dist + lag));
        if (!this.init) this.pos.copy(target);
        this.pos.lerp(target, Math.min(1, dt * 14));
        // stay above the ground
        const gy = groundY ? groundY(this.pos.x, this.pos.z) : car.y;
        if (this.pos.y < gy + 0.6) this.pos.y = gy + 0.6;
        cam.position.copy(this.pos);
        this.look.set(car.x + hx * 3, car.y + (far ? 0.6 : 0.85), car.z + hz * 3);
        cam.up.set(0, 1, 0);
        cam.lookAt(this.look);
        fov = (S.fov || 62) + clamp((speed - 30) * 0.12, 0, 9);
        break;
      }
      case "cockpit": case "helmet": {
        const helmet = this.mode === "helmet";
        // driver's eye, moving with the g-forces
        const ax = car.axF || 0, ay = car.ayF || 0;
        const tRoll = clamp(-ay * (helmet ? 0.007 : 0.0035), -0.12, 0.12);
        const tYaw = clamp(-car.steer * (helmet ? 0.35 : 0.12) + (car.r || 0) * (helmet ? 0.05 : 0.02), -0.25, 0.25);
        const tPitch = clamp(ax * 0.002, -0.05, 0.05);
        this.headRoll += (tRoll - this.headRoll) * Math.min(1, dt * 6);
        this.headYaw += (tYaw - this.headYaw) * Math.min(1, dt * 5);
        this.headPitch += (tPitch - this.headPitch) * Math.min(1, dt * 6);
        const ox = S.cockpitX || 0, oy = S.cockpitY || 0;
        const eye = view.local(-0.20 + ox + (helmet ? 0.03 : 0) - clamp(ax * 0.0012, -0.04, 0.04), 0.985 + oy + (helmet ? 0.015 : 0), clamp(-ay * 0.0007, -0.025, 0.025), _w);
        cam.position.copy(eye);
        // orientation: car orientation then head motion
        view.root.getWorldQuaternion(_q);
        cam.quaternion.copy(_q);
        // three's camera looks down -z; the car's forward is +x -> rotate -90 degrees about y
        cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(_e.set(0, -Math.PI / 2, 0)));
        cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(_e.set(-0.045 + this.headPitch + (S.cockpitPitch || 0), this.headYaw + (back ? Math.PI : 0), this.headRoll, "YXZ")));
        // vibration from kerbs and engine
        const vib = (car.rumble || 0) * 0.004 + speed * 0.00002 + this.shake;
        if (vib > 0) cam.position.y += (Math.random() - 0.5) * vib;
        fov = S.cockpitFov || (helmet ? 72 : 76);
        break;
      }
      case "tcam": case "wheel": {
        const t = this.mode === "tcam";
        const p = t ? view.local(-0.46, 1.16, 0, _w) : view.local(0.15, 0.72, 0.62, _w);
        cam.position.copy(p);
        view.root.getWorldQuaternion(_q);
        cam.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromEuler(_e.set(0, -Math.PI / 2 + (back ? Math.PI : 0), 0)));
        cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(_e.set(t ? -0.08 : -0.03, 0, 0)));
        fov = t ? 68 : 80;
        break;
      }
      case "tv": {
        if (!tvSpots || !tvSpots.length) { this.setMode("chase"); return this.update(dt, car, view, track, tvSpots, groundY); }
        // the nearest camera ahead of the car on the lap, switching as it passes
        const s = car.q.s;
        let best = -1, bd = 1e9;
        for (let k = 0; k < tvSpots.length; k++) {
          const d = track.sDelta(s, tvSpots[k].s);
          const score = d > -60 ? d + 60 : 1e9;
          if (score < bd) { bd = score; best = k; }
        }
        if (best !== this.tvIndex) { this.tvIndex = best; this.init = false; }
        const sp = tvSpots[best];
        cam.position.set(sp.x, sp.y, sp.z);
        const target = _v.set(car.x, car.y + 0.5, car.z);
        if (!this.init) this.look.copy(target);
        this.look.lerp(target, Math.min(1, dt * 10));
        cam.up.set(0, 1, 0); cam.lookAt(this.look);
        const dist = cam.position.distanceTo(target);
        fov = clamp(2 * Math.atan(7 / dist) * 180 / Math.PI, 4, 55);
        break;
      }
      case "heli": {
        const target = _v.set(car.x - ch * 26, car.y + 34, car.z - sh * 26);
        if (!this.init) this.pos.copy(target);
        this.pos.lerp(target, Math.min(1, dt * 1.5));
        cam.position.copy(this.pos); cam.up.set(0, 1, 0);
        cam.lookAt(car.x + ch * 10, car.y, car.z + sh * 10);
        fov = 45;
        break;
      }
      case "orbit": {
        const o = this.orbit;
        o.target.lerp(_v.set(car.x, car.y + 0.6, car.z), this.init ? Math.min(1, dt * 8) : 1);
        const cx = Math.cos(o.pitch) * Math.cos(o.yaw) * o.dist, cy = Math.sin(o.pitch) * o.dist, cz = Math.cos(o.pitch) * Math.sin(o.yaw) * o.dist;
        cam.position.set(o.target.x + cx, o.target.y + cy, o.target.z + cz);
        const gy = groundY ? groundY(cam.position.x, cam.position.z) : 0;
        if (cam.position.y < gy + 0.4) cam.position.y = gy + 0.4;
        cam.up.set(0, 1, 0); cam.lookAt(o.target);
        fov = 50;
        break;
      }
    }
    this.init = true;
    this.shake *= Math.exp(-dt * 6);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix(); }
    cam.near = this.isInside || this.mode === "wheel" || this.mode === "tcam" ? 0.03 : 0.1;
    cam.updateProjectionMatrix();
  }
  bump(amount) { this.shake = Math.min(0.08, this.shake + amount); }
}

/** live rear-view mirrors: renders a rear-facing view into textures (cockpit) or a HUD mirror */
export class Mirrors {
  constructor(graphics, size = 256) {
    this.g = graphics;
    this.size = size;
    const mk = () => new THREE.WebGLRenderTarget(size, Math.round(size * 0.42), { type: THREE.HalfFloatType, depthBuffer: true });
    this.left = mk(); this.right = mk();
    // mirror images are flipped left-right by the texture transform (keeps face culling correct)
    for (const rt of [this.left, this.right]) { rt.texture.repeat.set(-1, 1); rt.texture.offset.set(1, 0); }
    this.cam = new THREE.PerspectiveCamera(32, 0.15 / 0.056, 0.2, 1500);
    this.frame = 0;
    this.every = 1;
  }
  setSize(size) {
    this.size = size;
    this.left.setSize(size, Math.round(size * 0.42)); this.right.setSize(size, Math.round(size * 0.42));
  }
  /** render the two side mirrors (positions on the car) */
  renderSide(view, hideSelf = true) {
    this.frame++;
    if (this.frame % this.every) return;
    const r = this.g.renderer, scene = this.g.scene;
    const prevTarget = r.getRenderTarget();
    const tm = r.toneMapping;
    view.root.updateMatrixWorld();
    const q = new THREE.Quaternion(); view.root.getWorldQuaternion(q);
    for (const side of [-1, 1]) {
      const pos = view.local(0.30, 0.80, side * 0.68, new THREE.Vector3());
      this.cam.position.copy(pos);
      // look backwards and slightly outwards
      this.cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 - side * 0.22, 0)));
      this.cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04, 0, 0)));
      this.cam.aspect = 0.15 / 0.056; this.cam.fov = 30; this.cam.near = 0.08; this.cam.updateProjectionMatrix();
      r.setRenderTarget(side < 0 ? this.left : this.right);
      r.render(scene, this.cam);
    }
    r.setRenderTarget(prevTarget);
    r.toneMapping = tm;
  }
  /** a wide rear-view mirror shown on screen for the outside cameras. rect in CSS pixels {x, y, w, h} */
  renderCentre(view, rect) {
    const r = this.g.renderer;
    const pr = r.getPixelRatio();
    const W = Math.max(64, Math.round(rect.w * pr)), H = Math.max(16, Math.round(rect.h * pr));
    if (!this.centreRT) {
      this.centreRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
      this.centreRT.texture.repeat.set(-1, 1); this.centreRT.texture.offset.set(1, 0);
      this.hudScene = new THREE.Scene();
      this.hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
      this.hudQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.centreRT.texture, depthTest: false, toneMapped: false }));
      this.hudFrame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x0b0b0e, depthTest: false }));
      this.hudFrame.renderOrder = 0; this.hudQuad.renderOrder = 1;
      this.hudScene.add(this.hudFrame, this.hudQuad);
    } else if (this.centreRT.width !== W || this.centreRT.height !== H) this.centreRT.setSize(W, H);
    this.frame++;
    if (this.frame % this.every === 0) {
      view.root.updateMatrixWorld();
      const q = new THREE.Quaternion(); view.root.getWorldQuaternion(q);
      this.cam.position.copy(view.local(-0.75, 1.45, 0, new THREE.Vector3()));
      this.cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)));
      this.cam.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.07, 0, 0)));
      this.cam.aspect = rect.w / rect.h; this.cam.fov = 16; this.cam.updateProjectionMatrix();
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.centreRT); r.render(this.g.scene, this.cam); r.setRenderTarget(prev);
    }
    // draw it over the frame
    const SW = this.g.width, SH = this.g.height;
    this.hudCam.left = 0; this.hudCam.right = SW; this.hudCam.top = SH; this.hudCam.bottom = 0; this.hudCam.updateProjectionMatrix();
    this.hudQuad.position.set(rect.x + rect.w / 2, SH - rect.y - rect.h / 2, 0); this.hudQuad.scale.set(rect.w, rect.h, 1);
    this.hudFrame.position.set(rect.x + rect.w / 2, SH - rect.y - rect.h / 2, 0); this.hudFrame.scale.set(rect.w + 6, rect.h + 6, 1);
    const ac = r.autoClear; r.autoClear = false;
    r.setRenderTarget(null); r.render(this.hudScene, this.hudCam);
    r.autoClear = ac;
  }
  dispose() { this.left.dispose(); this.right.dispose(); if (this.centreRT) this.centreRT.dispose(); }
}
