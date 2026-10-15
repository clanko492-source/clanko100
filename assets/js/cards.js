/*!
 * CLANKO100 shared templates: icons and game cards.
 * Used by the browser (site.js) and by the page generator (tools/build.mjs), so both render identical markup.
 */
(function (root) {
  "use strict";
  var P = {
    bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    gauge: '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="m12 17 4.2-5.2"/><circle cx="12" cy="17" r="1.3"/><path d="M6.2 11.5l1.2.9M12 6.5V8M17.8 11.5l-1.2.9"/>',
    ghost: '<path d="M12 3c4.2 0 7 3.1 7 7.5V21l-2.3-1.8L14.3 21 12 19.2 9.7 21l-2.4-1.8L5 21V10.5C5 6.1 7.8 3 12 3z"/><path d="M9.5 10v1.2M14.5 10v1.2"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 5.6c2.6 3.4 2.6 9.4 0 12.8M18 5.6c-2.6 3.4-2.6 9.4 0 12.8"/>',
    crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
    jump: '<path d="M3 20h6M15 14h6"/><path d="M6 17c.4-6.2 4.4-10 10.5-10.2"/><path d="m14 4 3 2.8-3 2.9"/>',
    puzzle: '<path d="M10 4.5a2 2 0 1 1 4 0V6h4v4h-1.5a2 2 0 1 0 0 4H18v4h-4v-1.5a2 2 0 1 0-4 0V18H6v-4h1.5a2 2 0 1 0 0-4H6V6h4z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.7a3.4 3.4 0 0 1 0 6.6M17.5 14.7c2.2.6 3.6 2.4 4 5.3"/>',
    cursor: '<path d="m6 4 12.5 7.8-5.6 1.3 3 5.9-2.2 1.1-3-5.9L6 18z"/><path d="M19 3.5 17.7 5M21 8h-2M15.5 2.5V4.5"/>',
    cube: '<path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="m4 7.4 8 4.6 8-4.6M12 12v9.2"/>',
    joystick: '<path d="M4.5 16.5h15l1 4h-17z"/><path d="M12 16.5V10"/><circle cx="12" cy="7" r="3.2"/><path d="M7.5 14v2.5"/>',
    rook: '<path d="M6 3h3v2.2h2V3h2v2.2h2V3h3v4.5l-2.2 2H8.2L6 7.5z"/><path d="m8.5 9.5-.8 8.5h8.6l-.8-8.5M5.5 21h13"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
    shuffle: '<path d="M3 7h3.5c4.5 0 6.5 10 11 10H21M18 14l3 3-3 3M3 17h3.5c1.6 0 2.8-1.3 3.8-3M13.7 10C14.7 8.2 16 7 17.5 7H21M18 4l3 3-3 3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    flag: '<path d="M5 21V4M5 4h11.5l-2.2 4 2.2 4H5"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    play: '<path d="M7.5 4.8 19 12 7.5 19.2z" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17v4M17 19h4"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    star: '<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'
  };
  function icon(name, cls) {
    return '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (P[name] || "") + "</svg>";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var cats = {};
  function init(catalog) { (catalog.categories || []).forEach(function (c) { cats[c.slug] = c; }); }
  function catName(slug) { return cats[slug] ? cats[slug].name : slug; }
  function catIcon(slug) { return cats[slug] ? cats[slug].icon : "grid"; }

  /**
   * card(game, base, opts) -> HTML string
   * opts.size: "md" (default) | "lg" (featured, shows the summary) | "sm"
   * opts.rank: number shown beside the card
   * opts.headingLevel: 2 or 3 (default 3)
   */
  function card(g, base, opts) {
    opts = opts || {};
    var size = opts.size || "md", h = "h" + (opts.headingLevel || 3), primary = g.cats[0];
    var searchText = (g.title + " " + g.tags.join(" ") + " " + g.cats.map(catName).join(" ")).toLowerCase();
    return '<article class="card card-' + size + '" data-slug="' + esc(g.slug) + '" data-cats="' + esc(g.cats.join(" ")) + '" data-search="' + esc(searchText) + '" data-order="' + (g.order || 0) + '">' +
      '<div class="card-media">' +
        '<img src="' + base + "assets/thumbs/" + esc(g.slug) + '.webp" alt="" width="640" height="400" loading="' + (opts.eager ? "eager" : "lazy") + '" decoding="async">' +
        '<span class="card-play" aria-hidden="true">' + icon("play") + "Play</span>" +
      "</div>" +
      '<div class="card-body">' +
        "<" + h + ' class="card-title"><a class="card-link" href="' + base + "game/" + esc(g.slug) + '/">' + esc(g.title) + "</a></" + h + ">" +
        '<p class="card-cat">' + icon(catIcon(primary)) + esc(catName(primary)) + "</p>" +
        (size === "lg" ? '<p class="card-summary">' + esc(g.summary) + "</p>" : "") +
      "</div>" +
      '<button type="button" class="fav-btn" data-fav="' + esc(g.slug) + '" aria-pressed="false" aria-label="Save ' + esc(g.title) + ' to favourites">' + icon("heart") + "</button>" +
    "</article>";
  }
  function rankItem(g, base, n) {
    return '<li class="rank-item"><span class="rank-num" aria-hidden="true">' + n + "</span>" + card(g, base, { size: "md" }) + "</li>";
  }

  var api = { icon: icon, esc: esc, init: init, catName: catName, catIcon: catIcon, card: card, rankItem: rankItem, ICONS: P };
  root.C100Cards = api;
})(typeof window !== "undefined" ? window : globalThis);
