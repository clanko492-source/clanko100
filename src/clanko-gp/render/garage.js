// CLANKO GP — the garage: the menu background, with your car turning slowly under studio lights.
// Also used as the live 3D preview for the livery designer, car editor and setup screens.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CarView, defaultLivery } from "./car-model.js";
import * as TX from "./textures.js";

export class Garage {
  constructor(graphics, store) {
    this.g = graphics; this.store = store;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x0b0c10);
    scene.fog = new THREE.Fog(0x0b0c10, 14, 40);
    const pm = new THREE.PMREMGenerator(graphics.renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = this.env.texture;
    scene.environmentIntensity = 0.4;
    pm.dispose();
    // floor: glossy epoxy with markings
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x25272d, roughness: 0.45, metalness: 0.05 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.75, 96), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; scene.add(ring);
    this.turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.06, 64), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0.4 }));
    this.turntable.position.y = 0.03; this.turntable.receiveShadow = true; scene.add(this.turntable);
    // back wall with light strips and a sign
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.8 }));
    wall.position.set(0, 5, -9); scene.add(wall);
    for (let k = -3; k <= 3; k++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
      strip.position.set(k * 4, 4, -8.95); scene.add(strip);
    }
    const c = document.createElement("canvas"); c.width = 1024; c.height = 160;
    const g2 = c.getContext("2d"); g2.fillStyle = "rgba(0,0,0,0)"; g2.clearRect(0, 0, 1024, 160);
    g2.fillStyle = "#ffd23a"; g2.font = "italic 900 120px Arial"; g2.textAlign = "center"; g2.textBaseline = "middle"; g2.fillText("CLANKO GP", 512, 84);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
    sign.position.set(0, 7.6, -8.9); scene.add(sign);
    // tool chests and tyre stacks for atmosphere
    const props = new THREE.Group();
    const tyreG = new THREE.TorusGeometry(0.3, 0.14, 10, 24);
    const tyreM = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    for (const [x, z, n] of [[-7, -5, 4], [-6.1, -5.6, 3], [7, -5, 4], [6.2, -5.7, 2]]) for (let k = 0; k < n; k++) { const ty = new THREE.Mesh(tyreG, tyreM); ty.rotation.x = Math.PI / 2; ty.position.set(x, 0.14 + k * 0.28, z); ty.castShadow = true; props.add(ty); }
    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.6), new THREE.MeshStandardMaterial({ color: 0xc81e2a, roughness: 0.4, metalness: 0.3 }));
    chest.position.set(4.6, 0.55, -6.5); chest.castShadow = true; props.add(chest);
    scene.add(props);
    // lights
    const key = new THREE.SpotLight(0xfff4e2, 240, 36, 0.75, 0.75, 1.5);
    key.position.set(4, 9, 5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005;
    scene.add(key); scene.add(key.target);
    const rim = new THREE.SpotLight(0x9fc4ff, 150, 36, 0.85, 0.8, 1.5); rim.position.set(-7, 7, -7); scene.add(rim); scene.add(rim.target);
    const fill = new THREE.PointLight(0xffe9cc, 70, 26, 1.7); fill.position.set(-2, 4.5, 6); scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x24262c, 0.3));
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.angle = 0.6;
    this.spin = true;
    this.view = null;
    this.camTarget = new THREE.Vector3(0, 0.45, 0);
    this.camDist = 8.8; this.camHeight = 2.0; this.camAngle = 0.55;
    this.setLivery(this.store.data.profile && this.store.data.profile.livery ? this.store.data.profile.livery : defaultLivery());
    this.resize();
    this._ro = () => this.resize();
    window.addEventListener("resize", this._ro);
  }
  resize() {
    const w = this.g.width || window.innerWidth, h = this.g.height || window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setLivery(livery) {
    if (this.view) { this.scene.remove(this.view.root); this.view.dispose(); }
    this.view = new CarView({ livery, quality: Math.max(1, this.g.preset.car), player: false });
    this.view.lod.levels.forEach((l, i) => (l.object.visible = i === 0)); this.view.lod.autoUpdate = false;
    this.scene.add(this.view.root);
    this.view.root.position.y = 0.06;
    this._fake = { x: 0, y: 0.06, z: 0, h: 0, bodyPitch: 0, bodyRoll: 0, steer: 0.15, drsOpen: false, limiter: false, rpm: 4000, gear: 1, u: 0, cls: { shiftRpm: 11850, ersStore: 4e6, revLimit: 12500 }, ers: 0, setup: { brakeBias: 57 }, wheels: [0, 1, 2, 3].map(() => ({ rot: 0, Fz: 3000, detached: false })), brakeTemp: [200, 200, 200, 200], damage: null };
  }
  focus(mode) {
    // camera presets for the editors
    if (mode === "front") { this.camDist = 5.2; this.camHeight = 1.0; this.camTarget.set(1.8, 0.35, 0); }
    else if (mode === "rear") { this.camDist = 5.5; this.camHeight = 1.6; this.camTarget.set(-1.8, 0.6, 0); }
    else if (mode === "cockpit") { this.camDist = 3.2; this.camHeight = 2.2; this.camTarget.set(0, 0.8, 0); }
    else { this.camDist = 8.8; this.camHeight = 2.0; this.camTarget.set(0, 0.45, 0); }
  }
  update(dt) {
    this.g.renderer.toneMappingExposure = 1.0;
    if (this.spin) this.angle += dt * 0.18;
    this.turntable.rotation.y = this.angle;
    if (this.view) {
      this._fake.h = -this.angle;
      this._fake.x = 0; this._fake.z = 0;
      this.view.update(this._fake, dt, {});
    }
    const a = this.camAngle;
    this.camera.position.set(Math.cos(a) * this.camDist + this.camTarget.x * 0.3, this.camHeight, Math.sin(a) * this.camDist);
    this.camera.lookAt(this.camTarget);
  }
  restore() { /* textures re-upload automatically */ }
  dispose() {
    window.removeEventListener("resize", this._ro);
    if (this.view) this.view.dispose();
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) for (const m of [].concat(o.material)) m.dispose(); });
    this.env.dispose();
  }
}
