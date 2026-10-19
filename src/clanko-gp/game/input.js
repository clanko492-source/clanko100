// CLANKO GP — keyboard, gamepad and steering-wheel input with rebindable controls,
// speed-sensitive keyboard steering, dead zones, linearity and wheel calibration.

import { clamp, lerp } from "../core/math.js";

export const ACTIONS = [
  ["throttle", "Throttle"], ["brake", "Brake"], ["left", "Steer left"], ["right", "Steer right"],
  ["shiftUp", "Shift up"], ["shiftDown", "Shift down"], ["drs", "DRS"], ["overtake", "ERS overtake"],
  ["ersMode", "ERS mode"], ["limiter", "Pit limiter"], ["camera", "Change camera"], ["lookBack", "Look back"],
  ["reset", "Reset to track"], ["pause", "Pause"], ["biasUp", "Brake bias forward"], ["biasDown", "Brake bias rearward"],
  ["radio", "Team radio menu"], ["hud", "Hide / show HUD"], ["tower", "Timing tower"], ["mfd", "Car settings panel"],
];

export const DEFAULT_KEYS = {
  throttle: ["KeyW", "ArrowUp"], brake: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
  shiftUp: ["KeyE"], shiftDown: ["KeyQ"], drs: ["Space"], overtake: ["ShiftLeft"], ersMode: ["KeyM"], limiter: ["KeyL"],
  camera: ["KeyC"], lookBack: ["KeyV"], reset: ["KeyR"], pause: ["Escape", "KeyP"], biasUp: ["BracketRight"], biasDown: ["BracketLeft"],
  radio: ["KeyT"], hud: ["KeyH"], tower: ["Tab"], mfd: ["KeyF"],
};

// standard gamepad layout (Xbox naming)
export const DEFAULT_PAD = {
  steerAxis: 0, throttle: { button: 7 }, brake: { button: 6 },
  shiftUp: 5, shiftDown: 4, drs: 0, overtake: 2, camera: 3, lookBack: 1, pause: 9, reset: 8,
  biasUp: 12, biasDown: 13, ersMode: 15, limiter: 10, radio: 14, mfd: 11,
};

export function keyName(code) {
  if (!code) return "—";
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace("Arrow", "").replace("Left", " L").replace("Right", " R").replace("Bracket", "[").replace("Space", "Space");
}

export class Input {
  constructor(settings = {}) {
    this.settings = settings;
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered actions this frame
    this.kbSteer = 0;
    this.out = { steer: 0, throttle: 0, brake: 0, analog: false, device: "keyboard" };
    this.padPrev = [];
    this.listening = null;     // when rebinding: callback(code)
    this._down = (e) => this._onKey(e, true);
    this._up = (e) => this._onKey(e, false);
    this._blur = () => this.keys.clear();
    this.touch = { steer: 0, throttle: 0, brake: 0, active: false };
  }
  get bindings() { return { ...DEFAULT_KEYS, ...(this.settings.keys || {}) }; }
  attach(target = window) {
    target.addEventListener("keydown", this._down);
    target.addEventListener("keyup", this._up);
    window.addEventListener("blur", this._blur);
    this.target = target;
  }
  detach() {
    if (!this.target) return;
    this.target.removeEventListener("keydown", this._down);
    this.target.removeEventListener("keyup", this._up);
    window.removeEventListener("blur", this._blur);
  }
  _onKey(e, down) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (this.listening && down) { e.preventDefault(); const cb = this.listening; this.listening = null; cb(e.code); return; }
    const b = this.bindings;
    let used = false;
    for (const [action, codes] of Object.entries(b)) {
      if (codes && codes.includes(e.code)) {
        used = true;
        if (down && !this.keys.has(e.code)) this.pressed.add(action);
      }
    }
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (used && this.enabled !== false) e.preventDefault();
  }
  held(action) { const c = this.bindings[action]; return !!c && c.some((k) => this.keys.has(k)); }
  /** consume an edge-triggered action */
  take(action) { if (this.pressed.has(action)) { this.pressed.delete(action); return true; } return false; }

  /** gamepads: pick the configured or first connected device */
  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const want = this.settings.padIndex;
    if (want != null && pads[want]) return pads[want];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
  padName() { const p = this._pad(); return p ? p.id : null; }

  /**
   * Read the controls. speed in m/s (for speed-sensitive keyboard steering).
   */
  poll(dt, speed = 0) {
    const S = this.settings, o = this.out;
    // ---------- keyboard ----------
    const left = this.held("left"), right = this.held("right");
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rateIn = S.kbSteerRate || 3.2, rateOut = S.kbReturnRate || 5.5;
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.kbSteer) ? rateOut : rateIn;
    this.kbSteer += clamp(target - this.kbSteer, -rate * dt, rate * dt);
    // the faster you go, the less lock a full key press gives (like a real driver's hands)
    const sens = S.kbSpeedSens != null ? S.kbSpeedSens : 1;
    const kbLimit = lerp(1, clamp(1 / (1 + Math.pow(Math.max(0, speed - 8) / 26, 1.35)), 0.11, 1), sens);
    let steer = this.kbSteer * kbLimit;
    let throttle = this.held("throttle") ? 1 : 0, brake = this.held("brake") ? 1 : 0;
    let device = "keyboard", analog = false;
    // ---------- touch ----------
    if (this.touch.active) { steer = this.touch.steer * kbLimit; throttle = this.touch.throttle; brake = this.touch.brake; device = "touch"; analog = true; }
    // ---------- gamepad / wheel ----------
    const pad = S.padEnabled === false ? null : this._pad();
    if (pad) {
      const isWheel = S.wheel && S.wheel.enabled;
      const W = S.wheel || {};
      const P = { ...DEFAULT_PAD, ...(S.pad || {}) };
      const axis = (i) => (pad.axes[i] != null ? pad.axes[i] : 0);
      const btn = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      let ps = 0, pt = 0, pb = 0;
      if (isWheel) {
        const raw = axis(W.steerAxis != null ? W.steerAxis : 0) * (W.steerInvert ? -1 : 1);
        const centre = W.steerCentre || 0;
        // wheel rotation (degrees lock to lock) -> fraction of the car's lock
        const rot = W.rotation || 360;
        ps = clamp((raw - centre) * (rot / 2) / (W.carLockDeg || 180), -1, 1);
        const pedal = (cfg) => {
          if (!cfg) return 0;
          const v = cfg.axis != null ? axis(cfg.axis) : btn(cfg.button);
          const lo = cfg.min != null ? cfg.min : (cfg.axis != null ? 1 : 0), hi = cfg.max != null ? cfg.max : (cfg.axis != null ? -1 : 1);
          return clamp((v - lo) / (hi - lo || 1), 0, 1);
        };
        pt = pedal(W.throttle); pb = pedal(W.brake);
      } else {
        const dz = S.padDeadzone != null ? S.padDeadzone : 0.08;
        let x = axis(P.steerAxis);
        x = Math.abs(x) < dz ? 0 : Math.sign(x) * (Math.abs(x) - dz) / (1 - dz);
        const lin = S.padLinearity != null ? S.padLinearity : 1.6;
        ps = Math.sign(x) * Math.pow(Math.abs(x), lin);
        const padSens = S.padSpeedSens != null ? S.padSpeedSens : 0.7;
        ps *= lerp(1, kbLimit, padSens);
        pt = P.throttle.axis != null ? clamp((axis(P.throttle.axis) + 1) / 2, 0, 1) : btn(P.throttle.button);
        pb = P.brake.axis != null ? clamp((axis(P.brake.axis) + 1) / 2, 0, 1) : btn(P.brake.button);
      }
      const active = Math.abs(ps) > 0.02 || pt > 0.02 || pb > 0.02;
      if (active || this.out.device !== "keyboard") {
        if (active || (target === 0 && !this.held("throttle") && !this.held("brake"))) {
          steer = ps; throttle = pt; brake = pb; device = isWheel ? "wheel" : "gamepad"; analog = true;
        }
      }
      // buttons -> edge-triggered actions
      const map = isWheel ? { ...P, ...(W.buttons || {}) } : P;
      for (const [action, idx] of Object.entries(map)) {
        if (typeof idx !== "number" || action === "steerAxis") continue;
        const now = btn(idx) > 0.5, before = !!this.padPrev[idx];
        if (now && !before) this.pressed.add(action);
      }
      this.padPrev = pad.buttons.map((b) => b.value > 0.5);
      this.padHeld = (a) => { const i = map[a]; return typeof i === "number" && btn(i) > 0.5; };
    } else this.padHeld = () => false;
    o.steer = clamp(steer, -1, 1); o.throttle = clamp(throttle, 0, 1); o.brake = clamp(brake, 0, 1);
    o.analog = analog; o.device = device;
    o.overtake = this.held("overtake") || this.padHeld("overtake");
    o.lookBack = this.held("lookBack") || this.padHeld("lookBack");
    o.drsHeld = this.held("drs") || this.padHeld("drs");
    return o;
  }

  /** rumble on gamepads that support it (force feedback in browsers is limited to this) */
  rumble(strong, weak, ms = 60) {
    if (this.settings.rumble === false) return;
    const p = this._pad();
    const act = p && (p.vibrationActuator || (p.hapticActuators && p.hapticActuators[0]));
    if (act && act.playEffect) act.playEffect("dual-rumble", { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
  }
}
