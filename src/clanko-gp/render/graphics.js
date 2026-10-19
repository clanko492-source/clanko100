// CLANKO GP — renderer, sky, sun, fog, shadows, environment reflections, post-processing,
// quality presets and automatic resolution scaling.

import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { clamp, lerp, smoothstep } from "../core/math.js";
import * as TX from "./textures.js";

export const QUALITY = {
  low:    { id: "low", name: "Low", pixelRatio: 0.75, shadows: 0, tex: 256, terrainCell: 16, trees: 0.35, car: 0, detail: 0, composer: false, bloom: false, smaa: false, mirrorSize: 128, mirrorEvery: 3, particles: 0.4, aniso: 2, envEvery: 0, maxLights: 0 },
  medium: { id: "medium", name: "Medium", pixelRatio: 1, shadows: 1024, tex: 512, terrainCell: 12, trees: 0.7, car: 1, detail: 1, composer: true, bloom: true, smaa: false, msaa: 4, mirrorSize: 256, mirrorEvery: 2, particles: 0.7, aniso: 4, envEvery: 60 },
  high:   { id: "high", name: "High", pixelRatio: 1.25, shadows: 2048, tex: 1024, terrainCell: 9, trees: 1, car: 2, detail: 2, composer: true, bloom: true, smaa: false, msaa: 4, mirrorSize: 384, mirrorEvery: 1, particles: 1, aniso: 8, envEvery: 30 },
  ultra:  { id: "ultra", name: "Ultra", pixelRatio: 2, shadows: 4096, tex: 1024, terrainCell: 7, trees: 1.5, car: 2, detail: 2, composer: true, bloom: true, smaa: true, msaa: 4, mirrorSize: 512, mirrorEvery: 1, particles: 1.4, aniso: 16, envEvery: 15 },
};

/** choose a starting preset from what the device reports */
export function detectQuality() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return "low";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).toLowerCase() : "";
    const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
    if (/swiftshader|llvmpipe|software/.test(name)) return "low";
    if (mobile) return "low";
    if (/rtx|radeon rx|apple m[1-9]|geforce gtx 1[06-9]|arc a/.test(name)) return "high";
    if (/intel|uhd|iris|mali|adreno/.test(name)) return "medium";
    return "medium";
  } catch { return "low"; }
}

export class Graphics {
  constructor(container, settings = {}) {
    this.container = container;
    this.settings = settings;
    this.preset = QUALITY[settings.quality] || QUALITY.medium;
    const canvas = document.createElement("canvas");
    canvas.className = "gp-canvas";
    container.appendChild(canvas);
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.preset.composer && this.preset.id !== "low", powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.preset.shadows > 0;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 16000);
    this.scale = 1; // dynamic resolution factor
    this.frameTimes = [];
    this.lost = false;
    this.stats = { fps: 0, ms: 0, calls: 0, tris: 0, scale: 1 };
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; this.onContextLost && this.onContextLost(); });
    canvas.addEventListener("webglcontextrestored", () => { this.lost = false; this._restore(); this.onContextRestored && this.onContextRestored(); });
    this._setupLights();
    this._setupSky();
    this._setupComposer();
    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
  }

  get maxAniso() { return this.renderer.capabilities.getMaxAnisotropy(); }

  setQuality(id) {
    this.preset = QUALITY[id] || QUALITY.medium;
    this.renderer.shadowMap.enabled = this.preset.shadows > 0;
    if (this.sun) {
      this.sun.castShadow = this.preset.shadows > 0;
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.sun.shadow.mapSize.set(this.preset.shadows || 512, this.preset.shadows || 512);
    }
    this._setupComposer();
    this.resize();
    this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  }

  _setupLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4436, 0.9);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = this.preset.shadows > 0;
    const sh = this.sun.shadow;
    sh.mapSize.set(this.preset.shadows || 512, this.preset.shadows || 512);
    sh.camera.near = 1; sh.camera.far = 500;
    const ext = 55;
    sh.camera.left = -ext; sh.camera.right = ext; sh.camera.top = ext; sh.camera.bottom = -ext;
    sh.bias = -0.0004; sh.normalBias = 0.04;
    s.add(this.sun); s.add(this.sun.target);
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  }

  _setupSky() {
    const sky = new Sky();
    sky.scale.setScalar(12000);
    sky.material.depthWrite = false;
    this.sky = sky;
    this.scene.add(sky);
    const u = sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    // night sky: stars on a dome
    const starG = new THREE.BufferGeometry();
    const P = [];
    for (let i = 0; i < 2500; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.asin(Math.random() * 0.95 + 0.05);
      P.push(Math.cos(a) * Math.cos(e) * 9000, Math.sin(e) * 9000, Math.sin(a) * Math.cos(e) * 9000);
    }
    starG.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    this.stars = new THREE.Points(starG, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);
    // cloud layer
    const ct = TX.clouds(512, 0.5, 71);
    ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.repeat.set(3, 3);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.8, depthWrite: false, fog: false, color: 0xffffff });
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), this.cloudMat);
    cloud.renderOrder = -1;
    this.clouds = cloud;
    this.scene.add(cloud);
    this.fog = new THREE.FogExp2(0xbfd0e0, 0.0003);
    this.scene.fog = this.fog;
    this.envTimer = 0;
  }

  _setupComposer() {
    if (this.composer) { this.composer.dispose && this.composer.dispose(); this.composer = null; }
    const p = this.preset;
    if (!p.composer) return;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: p.msaa || 0 });
    const c = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.renderPass);
    if (p.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.45, 0.92); c.addPass(this.bloom); } else this.bloom = null;
    c.addPass(new OutputPass());
    if (p.smaa) c.addPass(new SMAAPass());
    this.composer = c;
  }

  _restore() {
    this.scene.traverse((o) => {
      if (o.material) for (const m of [].concat(o.material)) { for (const k of ["map", "normalMap", "roughnessMap", "emissiveMap"]) if (m[k]) m[k].needsUpdate = true; m.needsUpdate = true; }
    });
    this._setupComposer(); this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio) * this.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = "100%"; this.canvas.style.height = "100%";
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    if (this.bloom) this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    this.width = w; this.height = h;
  }

  /**
   * Set the light for a time of day (hours) and weather. env: { hour, clouds 0..1, rain 0..1, night (floodlit), theme }
   */
  setAtmosphere(env) {
    const hour = env.hour, clouds = clamp(env.clouds || 0, 0, 1), rain = clamp(env.rain || 0, 0, 1);
    // sun position from the hour (simple: rises 6, sets 20)
    const t = (hour - 6) / 14;
    const elev = Math.sin(clamp(t, -0.2, 1.2) * Math.PI) * 62 - (t < 0 || t > 1 ? 14 : 0);
    const azim = lerp(100, 260, clamp(t, 0, 1));
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    const day = smoothstep(-6, 8, elev);
    const dusk = smoothstep(18, 2, elev) * day;
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 2.5 + clouds * 6 + rain * 6;
    u.rayleigh.value = 1.0 + dusk * 1.8 + clouds * 0.6;
    this.sky.visible = day > 0.02;
    this.stars.material.opacity = (1 - day) * (1 - clouds * 0.9);
    const floodlit = !!env.floodlit && day < 0.5;
    // sun / moon light
    const sunCol = new THREE.Color().setHSL(0.09, 0.6 * dusk + 0.08, 0.55 + 0.4 * (1 - dusk));
    this.sun.color.copy(sunCol);
    const sunI = day * 3.2 * (1 - clouds * 0.62) * (1 - rain * 0.35);
    if (floodlit) {
      // floodlights: strong, neutral, nearly overhead
      this.sun.intensity = 2.4; this.sun.color.set(0xfff6ea);
      this.sunDir.set(0.25, 1, 0.18).normalize();
    } else this.sun.intensity = Math.max(sunI, 0.08);
    const skyC = new THREE.Color().setHSL(0.58, 0.4 - clouds * 0.3, lerp(0.05, 0.55, day) * (1 - rain * 0.3));
    this.hemi.color.copy(skyC);
    this.hemi.groundColor.setHSL(0.1, 0.25, lerp(0.03, 0.28, day));
    this.hemi.intensity = floodlit ? 0.6 : lerp(0.06, 0.5, day) * (1 + clouds * 0.6);
    // fog colour follows the horizon
    const fogC = new THREE.Color().setHSL(0.58, 0.3 - clouds * 0.2, lerp(0.03, 0.62, day) * (1 - rain * 0.3) + dusk * 0.05);
    if (dusk > 0.1) fogC.lerp(new THREE.Color(0xf0b080), dusk * 0.35);
    this.fog.color.copy(fogC);
    this.fog.density = (env.fogBase || 0.0003) * (1 + rain * 3.5 + clouds * 0.6) * (day < 0.3 ? 1.6 : 1);
    this.scene.background = day > 0.02 ? null : new THREE.Color(0x05070d);
    u.cloudCoverage.value = clamp(clouds * 0.9 + rain * 0.2, 0, 1);
    u.cloudDensity.value = 0.35 + rain * 0.55 + clouds * 0.15;
    u.showSunDisc.value = clouds < 0.85 ? 1 : 0;
    // at night the procedural sky is off; a faint cloud dome hides the stars instead
    this.cloudMat.opacity = clamp(clouds * 0.9, 0, 1) * 0.35;
    this.cloudMat.color.setScalar(0.12 * (1 - rain * 0.4));
    this.clouds.visible = day <= 0.02 && clouds > 0.1;
    this.renderer.toneMappingExposure = floodlit ? 0.9 : lerp(1.4, 0.72, day) * (1 + clouds * 0.12);
    if (this.bloom) { this.bloom.enabled = floodlit || day < 0.3; this.bloom.strength = 0.45; this.bloom.threshold = 1.0; this.bloom.radius = 0.35; }
    this.atmo = { ...env, day, floodlit, elev };
    this.envDirty = true;
  }

  /** rebuild the reflection environment from the current sky (cheap enough every few seconds) */
  updateEnvironment(force) {
    if (!force && !this.envDirty) return;
    this.envDirty = false;
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    if (this.sky.visible) {
      const sky2 = new Sky(); sky2.scale.setScalar(1000);
      for (const k of Object.keys(this.sky.material.uniforms)) {
        const v = this.sky.material.uniforms[k].value;
        sky2.material.uniforms[k].value = v && v.clone ? v.clone() : v;
      }
      envScene.add(sky2);
    } else {
      envScene.background = new THREE.Color(0x070910);
    }
    // a ground hemisphere so reflections are not sky below the horizon
    const ground = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: this.atmo && this.atmo.day > 0.2 ? 0x3a3c3a : 0x050505, side: THREE.BackSide }));
    envScene.add(ground);
    if (this.atmo && this.atmo.floodlit) {
      // bright panels to give cars highlights under floodlights
      for (let k = 0; k < 10; k++) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), new THREE.MeshBasicMaterial({ color: 0xfff4e0, side: THREE.DoubleSide }));
        const a = (k / 10) * Math.PI * 2; p.position.set(Math.cos(a) * 300, 140, Math.sin(a) * 300); p.lookAt(0, 0, 0); envScene.add(p);
      }
    }
    const rt = this.pmrem.fromScene(envScene, 0, 1, 2000);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = !this.atmo ? 0.4 : this.atmo.floodlit ? 0.6 : this.atmo.day < 0.3 ? 0.25 : 0.35;
    envScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  /** keep the shadow box centred on what the camera looks at */
  followShadows(target) {
    const s = this.sun, ext = 55;
    const dir = this.sunDir;
    // snap to shadow texels to stop shimmering
    const texel = (ext * 2) / (this.preset.shadows || 512);
    const tx = Math.round(target.x / texel) * texel, ty = Math.round(target.y / texel) * texel, tz = Math.round(target.z / texel) * texel;
    s.target.position.set(tx, ty, tz);
    s.position.set(tx + dir.x * 200, ty + Math.max(0.15, dir.y) * 200, tz + dir.z * 200);
    s.target.updateMatrixWorld();
    // the sky follows the camera
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.clouds.position.set(this.camera.position.x, this.camera.position.y - 200, this.camera.position.z);
    this.sky.material.uniforms.time.value = performance.now() / 1000;
  }

  render(dt) {
    if (this.lost) return;
    const t0 = performance.now();
    if (this.composer) { this.renderPass.camera = this.camera; this.composer.render(dt); }
    else this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.stats.calls = info.calls; this.stats.tris = info.triangles;
    this._autoScale(dt);
    this.stats.cpu = performance.now() - t0;
  }

  _autoScale(dt) {
    if (!dt) return;
    const ft = this.frameTimes;
    ft.push(dt); if (ft.length > 90) ft.shift();
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    this.stats.fps = 1 / avg; this.stats.ms = avg * 1000;
    if (!this.settings.autoScale || ft.length < 90) return;
    const target = 1 / (this.settings.targetFps || 60);
    let s = this.scale;
    if (avg > target * 1.15 && s > 0.5) s = Math.max(0.5, s - 0.08);
    else if (avg < target * 0.8 && s < 1) s = Math.min(1, s + 0.05);
    if (s !== this.scale) { this.scale = s; this.frameTimes.length = 0; this.resize(); }
    this.stats.scale = this.scale;
  }

  dispose() {
    this._ro.disconnect();
    if (this.composer) this.composer.dispose && this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
