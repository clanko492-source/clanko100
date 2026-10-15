/*!
 * CLANKO100 site script: theme, search, favourites, recently played, game of the day,
 * library filters, the game player and the contact / report forms.
 * Everything personal is stored only in this browser (localStorage). Made by clanko.
 */
(function () {
  "use strict";
  var D = document, root = D.documentElement, base = root.getAttribute("data-base") || "./";
  var CAT = window.C100 || { games: [], categories: [] }, Cards = window.C100Cards, CFG = window.C100_CONFIG || {};
  Cards.init(CAT);
  var games = CAT.games, bySlug = {};
  games.forEach(function (g) { bySlug[g.slug] = g; });
  var $ = function (s, el) { return (el || D).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || D).querySelectorAll(s)); };

  /* ---------- storage that never throws ---------- */
  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- toast ---------- */
  var toastT;
  function toast(msg) {
    var old = $(".toast"); if (old) old.remove();
    var t = D.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; D.body.appendChild(t);
    clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, 2200);
  }

  /* ---------- theme ---------- */
  $$("[data-theme-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next); set("c100:theme", next);
      b.setAttribute("aria-label", next === "light" ? "Switch to dark theme" : "Switch to light theme");
    });
    b.setAttribute("aria-label", root.getAttribute("data-theme") === "light" ? "Switch to dark theme" : "Switch to light theme");
  });

  /* ---------- mobile menu ---------- */
  var nav = $(".nav"), menuBtn = $("[data-menu]");
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", function () {
      var open = !nav.classList.contains("open"); nav.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", String(open));
    });
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("open")) { nav.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); menuBtn.focus(); } });
  }

  /* ---------- favourites + recently played ---------- */
  function favs() { return get("c100:favs", []).filter(function (s) { return bySlug[s]; }); }
  function isFav(s) { return favs().indexOf(s) >= 0; }
  function syncFavs() {
    var f = favs();
    $$("[data-fav]").forEach(function (b) {
      var s = b.getAttribute("data-fav"), on = f.indexOf(s) >= 0, g = bySlug[s];
      b.setAttribute("aria-pressed", String(on));
      if (g) b.setAttribute("aria-label", (on ? "Remove " : "Save ") + g.title + (on ? " from favourites" : " to favourites"));
      var lbl = b.querySelector("[data-fav-label]"); if (lbl) lbl.textContent = on ? "Saved" : "Favourite";
    });
  }
  D.addEventListener("click", function (e) {
    var b = e.target.closest("[data-fav]"); if (!b) return;
    e.preventDefault();
    var s = b.getAttribute("data-fav"), f = favs(), i = f.indexOf(s);
    if (i >= 0) { f.splice(i, 1); toast("Removed from favourites"); } else { f.unshift(s); toast("Saved to favourites"); }
    set("c100:favs", f); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
    syncFavs(); renderHomeLists(); if (library) library.apply();
  });
  function recent() { return get("c100:recent", []).filter(function (s) { return bySlug[s]; }); }
  function addRecent(s) { var r = recent().filter(function (x) { return x !== s; }); r.unshift(s); set("c100:recent", r.slice(0, 12)); }

  function renderHomeLists() {
    var rSec = $("[data-recent-section]"), rList = $("[data-recent-list]");
    if (rSec && rList) {
      var r = recent().slice(0, 6);
      rSec.hidden = !r.length;
      rList.innerHTML = r.map(function (s) { return Cards.card(bySlug[s], base); }).join("");
    }
    var fList = $("[data-favs-list]"), fEmpty = $("[data-favs-empty]");
    if (fList) {
      var f = favs();
      fList.innerHTML = f.map(function (s) { return Cards.card(bySlug[s], base); }).join("");
      fList.hidden = !f.length; if (fEmpty) fEmpty.hidden = !!f.length;
    }
    syncFavs();
  }

  /* ---------- random game ---------- */
  var currentSlug = (D.body.getAttribute("data-game") || "");
  function randomGame() { var pool = games.filter(function (g) { return g.slug !== currentSlug; }); return pool[Math.floor(Math.random() * pool.length)]; }
  $$("[data-random]").forEach(function (b) { b.addEventListener("click", function (e) { e.preventDefault(); location.href = base + "game/" + randomGame().slug + "/"; }); });

  /* ---------- game of the day (same pick for everyone on a given day) ---------- */
  function gameOfTheDay() {
    var d = new Date(), key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(), h = 2166136261;
    String(key).split("").forEach(function (c) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); });
    return games[(h >>> 0) % games.length];
  }
  var gotd = $("[data-gotd]");
  if (gotd && games.length) {
    var g = gameOfTheDay();
    gotd.href = base + "game/" + g.slug + "/";
    gotd.setAttribute("aria-label", "Game of the day: " + g.title);
    var gi = $("img", gotd); if (gi) { gi.src = base + "assets/thumbs/" + g.slug + ".webp"; }
    var gt = $("[data-gotd-title]", gotd); if (gt) gt.textContent = g.title;
    var gs = $("[data-gotd-summary]", gotd); if (gs) gs.textContent = g.summary;
  }

  /* ---------- search ---------- */
  function score(g, q) {
    var t = g.title.toLowerCase(), s = 0;
    if (t === q) s += 200; if (t.indexOf(q) === 0) s += 100; else if (t.indexOf(q) > 0) s += 60;
    g.tags.forEach(function (x) { if (x.indexOf(q) >= 0) s += 25; });
    g.cats.forEach(function (c) { var n = Cards.catName(c).toLowerCase(); if (n.indexOf(q) >= 0 || c.indexOf(q) >= 0) s += 30; });
    if (g.summary.toLowerCase().indexOf(q) >= 0) s += 8;
    return s;
  }
  function search(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    var words = q.split(/\s+/);
    return games.map(function (g) { var s = 0, all = true; words.forEach(function (w) { var ws = score(g, w); if (!ws) all = false; s += ws; }); return { g: g, s: all ? s : 0 }; })
      .filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.g; });
  }
  function attachSearch(input, list, opts) {
    opts = opts || {};
    var items = [], active = -1;
    function render() {
      var q = input.value.trim();
      if (!q) { list.hidden = true; list.innerHTML = ""; input.setAttribute("aria-expanded", "false"); return; }
      items = search(q).slice(0, 6); active = -1;
      var html = items.length ? items.map(function (g, i) {
        return '<a class="result" role="option" id="' + list.id + "-" + i + '" href="' + base + "game/" + g.slug + '/"><img src="' + base + "assets/thumbs/" + g.slug + '.webp" alt="" width="72" height="45" loading="lazy"><span><b>' +
          Cards.esc(g.title) + "</b><span>" + Cards.esc(Cards.catName(g.cats[0])) + "</span></span></a>";
      }).join("") : '<div class="no-results">No games match “' + Cards.esc(q) + '”. Try a category like racing or puzzle.</div>';
      html += '<a class="result-all" href="' + base + "games/?q=" + encodeURIComponent(q) + '">See all results in the library</a>';
      list.innerHTML = html; list.hidden = false; input.setAttribute("aria-expanded", "true");
    }
    function highlight() { $$(".result", list).forEach(function (r, i) { r.setAttribute("aria-selected", String(i === active)); if (i === active) { input.setAttribute("aria-activedescendant", r.id); r.scrollIntoView({ block: "nearest" }); } }); }
    input.addEventListener("input", render);
    input.addEventListener("focus", function () { if (input.value.trim()) render(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(-1, active - 1); highlight(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0 && items[active]) location.href = base + "game/" + items[active].slug + "/";
        else if (items.length === 1) location.href = base + "game/" + items[0].slug + "/";
        else if (input.value.trim()) location.href = base + "games/?q=" + encodeURIComponent(input.value.trim());
      } else if (e.key === "Escape" && !opts.inDialog) { list.hidden = true; }
    });
    if (!opts.inDialog) D.addEventListener("click", function (e) { if (!list.contains(e.target) && e.target !== input) list.hidden = true; });
  }
  $$("[data-search]").forEach(function (box) { var input = $("input", box), list = $(".results", box); if (input && list) attachSearch(input, list, { inDialog: !!box.closest("dialog") }); });

  var palette = $("#search-dialog");
  function openPalette() {
    if (!palette || !palette.showModal) { location.href = base + "games/"; return; }
    if (!palette.open) palette.showModal();
    var i = $("input", palette); i.value = ""; $(".results", palette).hidden = true; setTimeout(function () { i.focus(); }, 20);
  }
  $$("[data-search-open]").forEach(function (b) { b.addEventListener("click", openPalette); });
  if (palette) palette.addEventListener("click", function (e) { if (e.target === palette) palette.close(); });
  D.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase(), typing = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); openPalette(); }
  });

  /* ---------- library filters ---------- */
  var library = null, grid = $("#library-grid");
  if (grid) {
    var cards = $$(".card", grid), qInput = $("#lib-q"), sortSel = $("#lib-sort"), countEl = $("#lib-count"), emptyEl = $("#lib-empty");
    var params = new URLSearchParams(location.search);
    var state = { q: params.get("q") || "", cat: params.get("cat") || "all", sort: params.get("sort") || "featured" };
    if (state.cat !== "all" && state.cat !== "favs" && !CAT.categories.some(function (c) { return c.slug === state.cat; })) state.cat = "all";
    qInput.value = state.q; sortSel.value = state.sort;
    library = {
      apply: function () {
        var q = state.q.trim().toLowerCase(), words = q ? q.split(/\s+/) : [], f = favs(), shown = 0;
        cards.forEach(function (c) {
          var ok = true, s = c.getAttribute("data-slug");
          if (state.cat === "favs") ok = f.indexOf(s) >= 0;
          else if (state.cat !== "all") ok = c.getAttribute("data-cats").split(" ").indexOf(state.cat) >= 0;
          if (ok && words.length) { var hay = c.getAttribute("data-search"); ok = words.every(function (w) { return hay.indexOf(w) >= 0; }); }
          c.hidden = !ok; if (ok) shown++;
        });
        var sorted = cards.slice().sort(function (a, b) {
          if (state.sort === "az") return bySlug[a.dataset.slug].title.localeCompare(bySlug[b.dataset.slug].title);
          if (state.sort === "new") return (+b.dataset.order) - (+a.dataset.order);
          return bySlug[a.dataset.slug].rank - bySlug[b.dataset.slug].rank;
        });
        sorted.forEach(function (c) { grid.appendChild(c); });
        countEl.textContent = shown === cards.length ? cards.length + " games" : shown + (shown === 1 ? " game" : " games") + " found";
        emptyEl.hidden = shown > 0;
        if (!shown) $("[data-empty-text]", emptyEl).textContent = state.cat === "favs" && !q ? "You haven't saved any favourites yet. Tap the heart on a game to keep it here." : "No games match your search. Try another word or show all games.";
        $$("[data-cat]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-cat") === state.cat)); });
        var p = new URLSearchParams(); if (state.q) p.set("q", state.q); if (state.cat !== "all") p.set("cat", state.cat); if (state.sort !== "featured") p.set("sort", state.sort);
        var qs = p.toString(); try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "")); } catch (e) {}
      }
    };
    qInput.addEventListener("input", function () { state.q = qInput.value; library.apply(); });
    sortSel.addEventListener("change", function () { state.sort = sortSel.value; library.apply(); });
    $$("[data-cat]").forEach(function (b) { b.addEventListener("click", function () { state.cat = b.getAttribute("data-cat"); library.apply(); }); });
    $$("[data-clear]").forEach(function (b) { b.addEventListener("click", function () { state = { q: "", cat: "all", sort: state.sort }; qInput.value = ""; library.apply(); qInput.focus(); }); });
    library.apply();
  }

  /* ---------- game player ---------- */
  var player = $("[data-player]");
  if (player) {
    var slug = player.getAttribute("data-slug"), frame = $("iframe", player), loader = $(".loader", player);
    addRecent(slug);
    var loaded = false;
    function done() { if (loaded) return; loaded = true; loader.classList.add("done"); try { frame.contentWindow.focus(); } catch (e) {} }
    frame.addEventListener("load", function () { setTimeout(done, 250); });
    if (frame.contentDocument && frame.contentDocument.readyState === "complete" && frame.contentDocument.URL !== "about:blank") setTimeout(done, 250);
    setTimeout(function () { if (!loaded) { var p = $("p", loader); if (p) p.innerHTML = 'Still loading... <a href="' + frame.getAttribute("src") + '" target="_blank" rel="noopener">open the game in a new tab</a>'; } }, 12000);
    player.addEventListener("pointerdown", function () { try { frame.contentWindow.focus(); } catch (e) {} });

    var fsBtn = $("[data-fullscreen]"), closeBtn = $(".theater-close", player);
    var canFs = !!(player.requestFullscreen || player.webkitRequestFullscreen) && !/iPhone|iPod/.test(navigator.userAgent);
    function theater(on) {
      player.classList.toggle("theater", on); D.body.style.overflow = on ? "hidden" : "";
      if (on && closeBtn) closeBtn.focus();
      try { frame.contentWindow.focus(); } catch (e) {}
      setLabel();
    }
    function isFull() { return D.fullscreenElement === player || D.webkitFullscreenElement === player || player.classList.contains("theater"); }
    function setLabel() { if (!fsBtn) return; var on = isFull(); $("[data-fs-label]", fsBtn).textContent = on ? "Exit fullscreen" : "Fullscreen"; fsBtn.innerHTML = fsBtn.innerHTML.replace(/<svg[\s\S]*?<\/svg>/, Cards.icon(on ? "shrink" : "expand")); }
    if (fsBtn) fsBtn.addEventListener("click", function () {
      if (isFull()) { if (player.classList.contains("theater")) theater(false); else (D.exitFullscreen || D.webkitExitFullscreen).call(D); return; }
      if (canFs) { var r = (player.requestFullscreen || player.webkitRequestFullscreen).call(player); if (r && r.catch) r.catch(function () { theater(true); }); try { frame.contentWindow.focus(); } catch (e) {} }
      else theater(true);
    });
    if (closeBtn) closeBtn.addEventListener("click", function () { if (player.classList.contains("theater")) theater(false); else if (D.fullscreenElement || D.webkitFullscreenElement) (D.exitFullscreen || D.webkitExitFullscreen).call(D); });
    D.addEventListener("fullscreenchange", setLabel); D.addEventListener("webkitfullscreenchange", setLabel);
    D.addEventListener("keydown", function (e) { if (e.key === "Escape" && player.classList.contains("theater")) theater(false); });
  }

  /* ---------- report + contact forms ---------- */
  var reportDlg = $("#report-dialog");
  $$("[data-report]").forEach(function (b) { b.addEventListener("click", function () { if (reportDlg && reportDlg.showModal) { reportDlg.showModal(); var f = $("textarea, select", reportDlg); if (f) setTimeout(function () { f.focus(); }, 30); } else location.href = base + "contact/?type=report&game=" + encodeURIComponent(currentSlug); }); });
  $$("[data-close-dialog]").forEach(function (b) { b.addEventListener("click", function () { var d = b.closest("dialog"); if (d) d.close(); }); });

  // contact page: prefill from ?type= and ?game=
  var contactForm = $("#contact-form");
  if (contactForm) {
    var cp = new URLSearchParams(location.search), gameSel = $("[name=game]", contactForm);
    if (gameSel) gameSel.innerHTML = '<option value="">Not about a game</option>' + games.slice().sort(function (a, b) { return a.title.localeCompare(b.title); }).map(function (g) { return '<option value="' + g.slug + '">' + Cards.esc(g.title) + "</option>"; }).join("");
    if (cp.get("type")) $("[name=type]", contactForm).value = cp.get("type");
    if (cp.get("game") && gameSel) gameSel.value = cp.get("game");
  }

  $$("form[data-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = $(".form-status", form), btn = $("[type=submit]", form);
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = v; });
      if (data._gotcha) { showStatus(status, "ok", "Thanks, your message was sent."); form.reset(); return; }
      delete data._gotcha;
      if (!data.message || !String(data.message).trim()) { showStatus(status, "err", "Write a short message first, so we know what happened."); return; }
      data.page = location.href; data.browser = navigator.userAgent; data.screen = screen.width + "x" + screen.height;
      if (data.game && bySlug[data.game]) data.game = bySlug[data.game].title + " (" + data.game + ")";
      var subject = (data.type === "report" ? "Broken game report" : data.type === "suggest" ? "Game suggestion" : "Message") + (data.game ? ": " + data.game : "") + " | CLANKO100";
      if (CFG.formspreeId) {
        btn.disabled = true; btn.textContent = "Sending...";
        data._subject = subject;
        fetch("https://formspree.io/f/" + encodeURIComponent(CFG.formspreeId), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) })
          .then(function (r) { if (!r.ok) throw new Error(r.status); showStatus(status, "ok", data.type === "report" ? "Thanks! Your report was sent and the game will be checked." : "Thanks! Your message was sent."); form.reset(); })
          .catch(function () { showStatus(status, "err", "Your message couldn't be sent. Check your connection and try again."); })
          .then(function () { btn.disabled = false; btn.textContent = form.getAttribute("data-submit-label") || "Send"; });
      } else if (CFG.contactEmail) {
        var body = Object.keys(data).filter(function (k) { return data[k]; }).map(function (k) { return k + ": " + data[k]; }).join("\n");
        location.href = "mailto:" + CFG.contactEmail + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
        showStatus(status, "ok", "Your email app should open with the message ready to send.");
      } else {
        showStatus(status, "err", "Sending isn't switched on for this site yet. Please try again later.");
        if (window.console) console.warn("CLANKO100: set formspreeId or contactEmail in assets/js/config.js to enable the contact and report forms.");
      }
    });
  });
  function showStatus(el, kind, msg) { if (!el) return; el.hidden = false; el.className = "form-status " + kind; el.textContent = msg; el.setAttribute("role", kind === "err" ? "alert" : "status"); }

  renderHomeLists();
  syncFavs();
})();
