/*!
 * CLANKO100 game kit — shared runtime for every game in /embed/.
 * Canvas scaling, keyboard / mouse / touch input, start + pause + game-over screens,
 * sound effects (WebAudio, no files), best scores saved in the browser, thumbnail mode.
 * Made by clanko for clanko100.com
 */
(function () {
  "use strict";
  var K = {};
  var qs = new URLSearchParams(location.search);
  K.thumb = qs.has("thumb");
  K.embedded = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  K.id = document.body.getAttribute("data-game") || "game";
  if (K.thumb) document.documentElement.classList.add("thumb");
  K.isTouch = !!((window.matchMedia && matchMedia("(pointer: coarse)").matches) || (navigator.maxTouchPoints > 0 && "ontouchstart" in window));
  K.state = "menu";      // menu | play | over
  K.paused = false;
  K.pausable = true;

  /* ---------------- helpers ---------------- */
  K.C = { blue: "#2fb8ff", purple: "#a65bff", pink: "#ff4fd8", cyan: "#45f0ff", green: "#3dffa8", yellow: "#ffd84a",
    red: "#ff4b6e", orange: "#ff9a3d", white: "#eef0ff", muted: "#9aa0d0", bg: "#070818" };
  K.rand = function (a, b) { return a + Math.random() * (b - a); };
  K.randi = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
  K.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  K.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  K.lerp = function (a, b, t) { return a + (b - a) * t; };
  K.dist = function (x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); };
  K.shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  K.fmt = function (n) {
    n = Math.floor(n);
    if (n < 1000) return String(n);
    var units = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
    var i = -1;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + units[i];
  };
  K.time = function (s) { s = Math.max(0, s); var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ":" + (r < 10 ? "0" : "") + r; };
  K.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  /* ---------------- storage (never throws) ---------------- */
  var pre = "c100:" + K.id + ":";
  function rawGet(key, def) { try { var v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function rawSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  K.store = {
    get: function (k, d) { return rawGet(pre + k, d); },
    set: function (k, v) { rawSet(pre + k, v); },
    del: function (k) { try { localStorage.removeItem(pre + k); } catch (e) {} }
  };
  K.best = function () { return K.store.get("best", 0); };
  K.saveBest = function (score, lowerIsBetter) {
    var b = K.store.get("best", null);
    var isNew = lowerIsBetter ? (b == null || score < b) : (score > 0 && (b == null || score > b));
    if (isNew) K.store.set("best", score);
    return { best: isNew ? score : (b == null ? 0 : b), isNew: isNew };
  };

  /* ---------------- events ---------------- */
  var handlers = {};
  K.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); };
  function emit(name, a, b) { var l = handlers[name]; if (!l) return; for (var i = 0; i < l.length; i++) l[i](a, b); }

  /* ---------------- audio ---------------- */
  var actx = null, master = null, noiseBuf = null, gestured = false;
  K.muted = rawGet("c100:muted", false);
  function ac() {
    if (!gestured) return null;
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { actx = new AC(); } catch (e) { return null; }
      master = actx.createGain(); master.gain.value = 0.45; master.connect(actx.destination);
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate);
      var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) { window.addEventListener(ev, function () { gestured = true; ac(); }, { passive: true, capture: true }); });
  K.tone = function (freq, dur, o) {
    if (K.muted || K.thumb) return; var a = ac(); if (!a) return; o = o || {};
    var t = a.currentTime + (o.delay || 0), osc = a.createOscillator(), g = a.createGain();
    osc.type = o.type || "square"; osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
    var v = o.vol == null ? 0.18 : o.vol;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.02);
  };
  K.noise = function (dur, o) {
    if (K.muted || K.thumb) return; var a = ac(); if (!a) return; o = o || {};
    var t = a.currentTime + (o.delay || 0), src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf; f.type = o.filter || "lowpass"; f.frequency.setValueAtTime(o.freq || 1200, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
    var v = o.vol == null ? 0.25 : o.vol;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
  };
  var SFX = {
    coin: function () { K.tone(988, 0.06, { vol: 0.12 }); K.tone(1319, 0.14, { vol: 0.12, delay: 0.06 }); },
    jump: function () { K.tone(260, 0.14, { slide: 620, vol: 0.12 }); },
    shoot: function () { K.tone(920, 0.08, { type: "sawtooth", slide: 260, vol: 0.06 }); },
    hit: function () { K.noise(0.12, { freq: 2400, vol: 0.2 }); K.tone(160, 0.12, { slide: 60, vol: 0.12 }); },
    explode: function () { K.noise(0.45, { freq: 1400, sweep: 120, vol: 0.32 }); K.tone(110, 0.35, { type: "triangle", slide: 30, vol: 0.2 }); },
    power: function () { [523, 659, 784, 1046].forEach(function (f, i) { K.tone(f, 0.09, { type: "triangle", vol: 0.14, delay: i * 0.06 }); }); },
    lose: function () { K.tone(420, 0.55, { type: "sawtooth", slide: 90, vol: 0.12 }); },
    win: function () { [523, 659, 784, 1046, 1319].forEach(function (f, i) { K.tone(f, 0.14, { type: "triangle", vol: 0.14, delay: i * 0.08 }); }); },
    click: function () { K.tone(640, 0.035, { type: "triangle", vol: 0.12 }); },
    select: function () { K.tone(760, 0.05, { type: "triangle", vol: 0.12 }); K.tone(1140, 0.06, { type: "triangle", vol: 0.1, delay: 0.04 }); },
    step: function () { K.tone(130, 0.03, { type: "triangle", vol: 0.06 }); },
    beep: function () { K.tone(440, 0.08, { vol: 0.1 }); },
    thud: function () { K.tone(95, 0.16, { type: "sine", slide: 40, vol: 0.3 }); },
    bounce: function () { K.tone(520, 0.05, { type: "square", vol: 0.08 }); },
    error: function () { K.tone(180, 0.15, { type: "square", vol: 0.1 }); K.tone(140, 0.2, { type: "square", vol: 0.1, delay: 0.12 }); }
  };
  K.sfx = function (name) { if (SFX[name]) SFX[name](); };
  K.setMuted = function (m) { K.muted = !!m; rawSet("c100:muted", K.muted); updateToolbar(); emit("mute", K.muted); };

  /* ---------------- canvas ---------------- */
  var stage = document.getElementById("stage");
  function ensureStage() {
    if (!stage) { stage = document.createElement("div"); stage.id = "stage"; document.body.insertBefore(stage, document.body.firstChild); }
    K.stage = stage; return stage;
  }
  K.W = 0; K.H = 0; K.scale = 1;
  /**
   * K.canvas(w, h, opts) — logical resolution w × h, scaled to fit the frame (letterboxed).
   * opts.fill = { minW, maxW } keeps logical height h and stretches width to the window's shape.
   * opts.pixel = true for crisp pixel art.
   */
  K.canvas = function (w, h, opts) {
    opts = opts || {};
    ensureStage();
    var c = document.createElement("canvas");
    c.setAttribute("tabindex", "0"); c.setAttribute("aria-label", document.title);
    stage.appendChild(c);
    var ctx = c.getContext("2d");
    K.cv = c; K.ctx = ctx; K.W = w; K.H = h;
    function fit() {
      var vw = window.innerWidth || 800, vh = window.innerHeight || 600;
      var lw = w, lh = h;
      if (opts.fill) { lw = K.clamp(Math.round(h * vw / vh), opts.fill.minW || w, opts.fill.maxW || w * 2); }
      var s = Math.min(vw / lw, vh / lh);
      var cw = Math.floor(lw * s), ch = Math.floor(lh * s);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.style.width = cw + "px"; c.style.height = ch + "px";
      c.width = Math.max(1, Math.round(cw * dpr)); c.height = Math.max(1, Math.round(ch * dpr));
      K.W = lw; K.H = lh; K.scale = s;
      ctx.setTransform(s * dpr * (c.width / Math.round(cw * dpr)), 0, 0, s * dpr * (c.height / Math.round(ch * dpr)), 0, 0);
      if (opts.pixel) ctx.imageSmoothingEnabled = false;
      emit("resize");
      if (K._redraw) K._redraw();
    }
    window.addEventListener("resize", fit);
    fit();
    return ctx;
  };
  K.toLogical = function (cx, cy) {
    if (!K.cv) return { x: cx, y: cy };
    var r = K.cv.getBoundingClientRect();
    return { x: (cx - r.left) / r.width * K.W, y: (cy - r.top) / r.height * K.H };
  };

  /* ---------------- loop ---------------- */
  K.loop = function (update, draw) {
    var last = performance.now();
    K._redraw = function () { if (draw) draw(K.ctx); };
    K._resetClock = function () { last = performance.now(); };
    var thumbClock = 0;
    function frame(t) {
      var dt = (t - last) / 1000; last = t;
      if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;
      if (K.thumb) { thumbClock += dt; if (thumbClock > (K.thumbTime == null ? 0.5 : K.thumbTime)) dt = 0; }
      if (!K.paused) { if (update && dt > 0) update(dt); if (draw) draw(K.ctx); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  /* ---------------- keyboard ---------------- */
  K.keys = {};
  var BLOCK = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, PageUp: 1, PageDown: 1 };
  window.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (BLOCK[e.code]) e.preventDefault();
    K.keys[e.code] = true;
    if (e.repeat) return;
    if (screenEl && (e.code === "Enter" || e.code === "Space") && screenPrimary) { e.preventDefault(); screenPrimary.click(); return; }
    if ((e.code === "Escape" || e.code === "KeyP") && K.pausable) {
      if (K.state === "play" && !K.paused) { K.pause(); return; }
      if (K.paused) { K.resume(); return; }
    }
    if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey) { K.setMuted(!K.muted); }
    if (!screenEl && !K.paused) emit("key", e.code, e);
  });
  window.addEventListener("keyup", function (e) { K.keys[e.code] = false; emit("keyup", e.code, e); });
  var KEYMAP = { left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"],
    jump: ["Space", "ArrowUp", "KeyW", "KeyZ"], action: ["Space", "KeyJ", "KeyX", "Enter"] };
  K.held = function (name) { var l = KEYMAP[name] || [name]; for (var i = 0; i < l.length; i++) if (K.keys[l[i]]) return true; return false; };
  /** Movement axis from keyboard + joystick, length ≤ 1 */
  K.axis = function () {
    var x = (K.held("right") ? 1 : 0) - (K.held("left") ? 1 : 0), y = (K.held("down") ? 1 : 0) - (K.held("up") ? 1 : 0);
    if (joy && joy.active) { x = joy.x; y = joy.y; }
    var m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x: x, y: y };
  };

  /* ---------------- pointer (mouse + touch) ---------------- */
  K.pointer = { x: 0, y: 0, down: false, type: "mouse", button: 0 };
  var claimed = {}, downInfo = null;
  function isUI(t) { return t && t.closest && t.closest(".k-ui"); }
  window.addEventListener("contextmenu", function (e) { if (!isUI(e.target)) e.preventDefault(); });
  window.addEventListener("pointerdown", function (e) {
    if (isUI(e.target) || claimed[e.pointerId] || K.paused || screenEl) return;
    if (K.cv && document.activeElement !== K.cv) { try { K.cv.focus({ preventScroll: true }); } catch (x) {} }
    var p = K.toLogical(e.clientX, e.clientY);
    K.pointer.x = p.x; K.pointer.y = p.y; K.pointer.down = true; K.pointer.type = e.pointerType; K.pointer.button = e.button;
    downInfo = { id: e.pointerId, cx: e.clientX, cy: e.clientY, t: performance.now() };
    if (e.pointerType === "touch") showTouch();
    emit("down", K.pointer, e);
  });
  window.addEventListener("pointermove", function (e) {
    if (claimed[e.pointerId]) return;
    var p = K.toLogical(e.clientX, e.clientY);
    K.pointer.x = p.x; K.pointer.y = p.y;
    if (!K.paused && !screenEl) emit("move", K.pointer, e);
  });
  function up(e) {
    if (claimed[e.pointerId]) { return; }
    var p = K.toLogical(e.clientX, e.clientY);
    K.pointer.x = p.x; K.pointer.y = p.y; K.pointer.down = false;
    if (K.paused || screenEl) { downInfo = null; return; }
    emit("up", K.pointer, e);
    if (downInfo && downInfo.id === e.pointerId) {
      var dx = e.clientX - downInfo.cx, dy = e.clientY - downInfo.cy, dt = performance.now() - downInfo.t;
      var ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.max(ax, ay) > 26 && dt < 700) emit("swipe", ax > ay ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"), e);
      else if (Math.max(ax, ay) < 12) emit("tap", K.pointer, e);
    }
    downInfo = null;
  }
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", function (e) { delete claimed[e.pointerId]; K.pointer.down = false; downInfo = null; });

  /* ---------------- touch controls ---------------- */
  var touchEls = [], joy = null;
  function showTouch() { touchEls.forEach(function (el) { el.classList.remove("k-hidden"); }); }
  /** Floating virtual joystick: touch anywhere in the left part of the screen. */
  K.joystick = function (opts) {
    opts = opts || {};
    var zone = opts.zone == null ? 0.5 : opts.zone;
    var radius = 46;
    var base = document.createElement("div"); base.className = "k-joy"; base.innerHTML = "<i></i>"; document.body.appendChild(base);
    var knob = base.firstChild;
    var hint = document.createElement("div"); hint.className = "k-joy-hint k-hidden"; hint.textContent = opts.hint || "Drag here to move"; document.body.appendChild(hint);
    if (K.isTouch) hint.classList.remove("k-hidden");
    touchEls.push(hint);
    joy = { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0 };
    window.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch" || joy.active || isUI(e.target) || K.paused || screenEl) return;
      if (e.clientX > window.innerWidth * zone) return;
      claimed[e.pointerId] = 1; joy.active = true; joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
      base.style.left = e.clientX + "px"; base.style.top = e.clientY + "px"; knob.style.transform = ""; base.classList.add("on");
      hint.classList.add("k-hidden");
    }, true);
    window.addEventListener("pointermove", function (e) {
      if (!joy.active || e.pointerId !== joy.id) return;
      var dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, m = Math.hypot(dx, dy);
      if (m > radius) { dx = dx / m * radius; dy = dy / m * radius; }
      joy.x = dx / radius; joy.y = dy / radius;
      if (Math.hypot(joy.x, joy.y) < 0.15) { joy.x = 0; joy.y = 0; }
      knob.style.transform = "translate(" + dx + "px," + dy + "px)";
    }, true);
    function end(e) { if (e.pointerId !== joy.id) return; delete claimed[e.pointerId]; joy.active = false; joy.id = null; joy.x = joy.y = 0; base.classList.remove("on"); }
    window.addEventListener("pointerup", end, true); window.addEventListener("pointercancel", end, true);
    return joy;
  };
  var ICON = {
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
  };
  K.icon = ICON;
  /**
   * On-screen buttons for touch devices. defs: [{id, label|icon, side:"left"|"right"}]
   * Returns a state object: state[id] === true while held. Also emits K.on("button", id).
   */
  K.buttons = function (defs) {
    var state = {}, groups = {};
    defs.forEach(function (d) {
      var side = d.side || "right";
      if (!groups[side]) {
        var g = document.createElement("div"); g.className = "k-btns k-ui " + side + (K.isTouch ? "" : " k-hidden");
        document.body.appendChild(g); groups[side] = g; touchEls.push(g);
      }
      var b = document.createElement("button"); b.type = "button"; b.className = "k-tbtn";
      b.setAttribute("aria-label", d.aria || d.id);
      b.innerHTML = d.icon ? ICON[d.icon] : K.esc(d.label || d.id);
      if (d.size) { b.style.width = b.style.height = d.size + "px"; }
      state[d.id] = false;
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {} state[d.id] = true; b.classList.add("on"); if (!K.paused && !screenEl) emit("button", d.id); });
      function rel() { state[d.id] = false; b.classList.remove("on"); emit("buttonup", d.id); }
      b.addEventListener("pointerup", rel); b.addEventListener("pointercancel", rel); b.addEventListener("lostpointercapture", rel);
      groups[side].appendChild(b);
      d.el = b;
    });
    return state;
  };
  K.showTouchControls = showTouch;

  /* ---------------- screens ---------------- */
  var screenEl = null, screenPrimary = null, thumbStarted = false;
  K.hideScreen = function () { if (screenEl) { screenEl.remove(); screenEl = null; screenPrimary = null; } };
  /**
   * K.screen({ title, body (html), button, onStart, secondary:[{label,onClick}], credit, html })
   */
  K.screen = function (o) {
    o = o || {};
    if (K.thumb) { if (!thumbStarted && o.onStart) { thumbStarted = true; K.state = "play"; o.onStart(); } return; }
    K.hideScreen();
    var el = document.createElement("div"); el.className = "k-screen k-ui"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", o.title || "Menu");
    var html = '<div class="k-card">';
    if (o.title) html += '<h1 class="k-title">' + K.esc(o.title) + "</h1>";
    if (o.html) html += o.html;
    if (o.body) html += '<p class="k-body">' + o.body + "</p>";
    html += '<div class="k-actions"><button type="button" class="k-btn" data-primary>' + K.esc(o.button || "Play") + "</button>";
    (o.secondary || []).forEach(function (s, i) { html += '<button type="button" class="k-btn alt small" data-sec="' + i + '">' + K.esc(s.label) + "</button>"; });
    html += "</div>";
    if (o.credit !== false) html += '<div class="k-credit">' + (o.creditText || "Made by clanko for CLANKO100") + "</div>";
    html += "</div>";
    el.innerHTML = html;
    document.body.appendChild(el);
    screenEl = el; screenPrimary = el.querySelector("[data-primary]");
    screenPrimary.addEventListener("click", function () {
      K.sfx("select"); K.hideScreen(); K.paused = false; K.state = "play"; K.keys = {}; if (K._resetClock) K._resetClock(); updateToolbar();
      if (K.cv) { try { K.cv.focus({ preventScroll: true }); } catch (x) {} }
      if (o.onStart) o.onStart();
    });
    Array.prototype.forEach.call(el.querySelectorAll("[data-sec]"), function (b) {
      b.addEventListener("click", function () { var s = o.secondary[+b.getAttribute("data-sec")]; if (s && s.onClick) s.onClick(b); });
    });
    if (o.onShow) o.onShow(el);
    setTimeout(function () { try { screenPrimary && screenPrimary.focus({ preventScroll: true }); } catch (x) {} }, 30);
    updateToolbar();
    return el;
  };
  /** Title screen helper */
  K.menu = function (o) { K.state = "menu"; return K.screen(o); };
  /**
   * Game over helper. o: { title, score, label, lowerIsBetter, format, extra(html), onRestart, button, noBest }
   */
  K.over = function (o) {
    K.state = "over"; K.paused = false;
    if (K.thumb) return;
    var fmt = o.format || function (n) { return K.fmt(n); };
    var html = "";
    if (o.score != null) {
      var r = o.noBest ? { best: 0, isNew: false } : K.saveBest(o.score, o.lowerIsBetter);
      html += '<div class="k-score-label">' + K.esc(o.label || "Score") + '</div><div class="k-score">' + K.esc(fmt(o.score)) + "</div>";
      if (r.isNew && !o.noBest) html += '<div class="k-new">New best!</div>';
      else if (!o.noBest && r.best) html += '<div class="k-best">Best: ' + K.esc(fmt(r.best)) + "</div>";
    }
    if (o.extra) html += o.extra;
    html += '<div style="height:18px"></div>';
    return K.screen({ title: o.title || "Game over", html: html, button: o.button || "Play again", onStart: o.onRestart, secondary: o.secondary, credit: false });
  };

  /* ---------------- pause ---------------- */
  K.pause = function () {
    if (!K.pausable || K.state !== "play" || K.paused || K.thumb) return;
    K.paused = true; K.keys = {}; updateToolbar();
    var el = document.createElement("div"); el.className = "k-screen k-ui"; el.setAttribute("data-pause", "");
    el.innerHTML = '<div class="k-card"><h1 class="k-title">Paused</h1><p class="k-body">Press <kbd>P</kbd> or <kbd>Esc</kbd> to keep playing.</p>' +
      '<div class="k-actions"><button type="button" class="k-btn" data-resume>Resume</button>' +
      (K.onRestart ? '<button type="button" class="k-btn alt small" data-restart>Restart</button>' : "") + "</div></div>";
    document.body.appendChild(el); K._pauseEl = el;
    el.querySelector("[data-resume]").addEventListener("click", K.resume);
    var rb = el.querySelector("[data-restart]");
    if (rb) rb.addEventListener("click", function () { K.resume(); K.onRestart(); });
    setTimeout(function () { try { el.querySelector("[data-resume]").focus({ preventScroll: true }); } catch (x) {} }, 30);
    emit("pause");
  };
  K.resume = function () {
    if (!K.paused) return;
    K.paused = false; if (K._pauseEl) { K._pauseEl.remove(); K._pauseEl = null; }
    if (K._resetClock) K._resetClock(); updateToolbar();
    if (K.cv) { try { K.cv.focus({ preventScroll: true }); } catch (x) {} }
    emit("resume");
  };
  window.addEventListener("blur", function () { if (K.autoPause !== false) K.pause(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) K.pause(); });

  /* ---------------- toolbar ---------------- */
  var tb = document.createElement("div"); tb.className = "k-toolbar k-ui";
  var bPause = document.createElement("button"), bSound = document.createElement("button"), bFull = null;
  bPause.type = bSound.type = "button"; bPause.className = bSound.className = "k-tb";
  bPause.addEventListener("click", function () { if (K.paused) K.resume(); else K.pause(); });
  bSound.addEventListener("click", function () { K.setMuted(!K.muted); });
  tb.appendChild(bPause); tb.appendChild(bSound);
  if (!K.embedded && document.documentElement.requestFullscreen) {
    bFull = document.createElement("button"); bFull.type = "button"; bFull.className = "k-tb"; bFull.innerHTML = ICON.full;
    bFull.setAttribute("aria-label", "Fullscreen"); bFull.title = "Fullscreen";
    bFull.addEventListener("click", function () { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () {}); });
    tb.appendChild(bFull);
  }
  function updateToolbar() {
    bPause.innerHTML = K.paused ? ICON.play : ICON.pause;
    bPause.setAttribute("aria-label", K.paused ? "Resume" : "Pause"); bPause.title = K.paused ? "Resume (P)" : "Pause (P)";
    bPause.classList.toggle("k-hidden", !K.pausable || (K.state !== "play" && !K.paused));
    bSound.innerHTML = K.muted ? ICON.mute : ICON.sound;
    bSound.setAttribute("aria-label", K.muted ? "Turn sound on" : "Turn sound off"); bSound.title = K.muted ? "Sound off (M)" : "Sound on (M)";
  }
  K.updateToolbar = updateToolbar;
  document.body.appendChild(tb);
  updateToolbar();

  /* ---------------- toast ---------------- */
  var toastT = null;
  K.toast = function (msg, ms) {
    var old = document.querySelector(".k-toast"); if (old) old.remove();
    var t = document.createElement("div"); t.className = "k-toast"; t.textContent = msg; document.body.appendChild(t);
    clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, ms || 1600);
  };

  /* ---------------- drawing helpers ---------------- */
  K.font = function (size, weight, family) { return (weight || 700) + " " + size + "px " + (family === "body" ? '"Sora",system-ui,sans-serif' : '"Chakra Petch","Trebuchet MS",system-ui,sans-serif'); };
  K.text = function (ctx, s, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.font = K.font(o.size || 20, o.weight, o.family);
    ctx.textAlign = o.align || "left"; ctx.textBaseline = o.baseline || "middle";
    if (o.glow) { ctx.shadowColor = o.glowColor || o.color || "#fff"; ctx.shadowBlur = o.glow; }
    if (o.stroke) { ctx.lineWidth = o.strokeWidth || 4; ctx.strokeStyle = o.stroke; ctx.lineJoin = "round"; ctx.strokeText(s, x, y); }
    ctx.fillStyle = o.color || "#fff"; ctx.fillText(s, x, y);
    ctx.restore();
  };
  K.roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };
  K.glow = function (ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; };
  K.noGlow = function (ctx) { ctx.shadowBlur = 0; ctx.shadowColor = "transparent"; };

  /** Lightweight particle system (additive blending for a neon look). */
  K.Particles = function () { this.list = []; };
  K.Particles.prototype.burst = function (x, y, n, o) {
    o = o || {};
    for (var i = 0; i < n; i++) {
      var a = (o.angle || 0) + (Math.random() - 0.5) * (o.spread == null ? Math.PI * 2 : o.spread);
      var sp = (o.speed || 140) * (0.35 + Math.random() * 0.65);
      var life = (o.life || 0.6) * (0.6 + Math.random() * 0.4);
      this.list.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: life, max: life,
        size: (o.size || 3) * (0.6 + Math.random() * 0.6), color: Array.isArray(o.color) ? K.pick(o.color) : (o.color || "#fff"),
        g: o.gravity || 0, drag: o.drag == null ? 1.5 : o.drag });
    }
    if (this.list.length > 900) this.list.splice(0, this.list.length - 900);
  };
  K.Particles.prototype.update = function (dt) {
    var l = this.list;
    for (var i = l.length - 1; i >= 0; i--) {
      var p = l[i]; p.life -= dt; if (p.life <= 0) { l.splice(i, 1); continue; }
      var d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy = p.vy * d + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  };
  K.Particles.prototype.draw = function (ctx) {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i], a = p.life / p.max;
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      var s = p.size * (0.5 + a * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  };
  K.Particles.prototype.clear = function () { this.list.length = 0; };

  /** Screen shake helper: call K.shake(px), then K.applyShake(ctx, dt) at the start of draw (inside save/restore). */
  var shakeAmt = 0;
  K.shake = function (px) { shakeAmt = Math.max(shakeAmt, px); };
  K.applyShake = function (ctx, dt) {
    if (shakeAmt <= 0.1) { shakeAmt = 0; return; }
    ctx.translate((Math.random() - 0.5) * shakeAmt * 2, (Math.random() - 0.5) * shakeAmt * 2);
    shakeAmt *= Math.pow(0.002, dt || 0.016);
  };

  if (document.fonts && document.fonts.load) { document.fonts.load('700 20px "Chakra Petch"'); document.fonts.load('600 14px "Sora"'); }

  window.Kit = K;
})();
