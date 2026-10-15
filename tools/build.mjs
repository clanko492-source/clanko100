#!/usr/bin/env node
/**
 * CLANKO100 page generator.
 *
 * Builds every HTML page, the sitemap and the browser catalog from tools/games.json.
 * No packages needed: run `node tools/build.mjs` from the project folder after you
 * add or edit a game. The output is plain static files, ready for GitHub Pages or
 * Cloudflare Pages.
 *
 * Made by clanko.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/site.config.json"), "utf8"));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/games.json"), "utf8"));
const SITE = cfg.siteUrl.replace(/\/$/, "");
const TODAY = new Date().toISOString().slice(0, 10);

// Load the shared card + icon templates (the same file the browser uses)
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets/js/cards.js"), "utf8"), ctx);
const Cards = ctx.C100Cards;
Cards.init(data);
const { icon, esc } = Cards;

/* ---------------- catalog ---------------- */
const games = data.games.map((g, i) => ({ ...g, order: i + 1 }));
const cats = data.categories;
const catBySlug = Object.fromEntries(cats.map((c) => [c.slug, c]));
for (const g of games) for (const c of g.cats) if (!catBySlug[c]) throw new Error(`${g.slug}: unknown category "${c}"`);
// "Featured first" order: featured games, then trending by rank, then everything else
const featured = games.filter((g) => g.featured).sort((a, b) => a.featured - b.featured);
const trending = games.filter((g) => g.trending).sort((a, b) => a.trending - b.trending);
const ranked = [...featured, ...trending.filter((g) => !g.featured), ...games.filter((g) => !g.featured && !g.trending)];
ranked.forEach((g, i) => (g.rank = i + 1));
const newest = [...games].sort((a, b) => b.order - a.order);
const inCat = (slug) => ranked.filter((g) => g.cats.includes(slug));
const ratio = (a) => { const [w, h] = String(a).split("/").map(Number); return w / h; };

/* ---------------- helpers ---------------- */
function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function hashOf(...files) {
  const h = crypto.createHash("sha1");
  for (const f of files) h.update(fs.readFileSync(path.join(ROOT, f)));
  return h.digest("hex").slice(0, 8);
}
const url = (p) => SITE + cfg.basePath.replace(/\/$/, "") + "/" + p.replace(/^\//, "");

function logoMark(id) {
  return `<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fdcff"/><stop offset=".45" stop-color="#2fb8ff"/><stop offset="1" stop-color="#a65bff"/></linearGradient></defs><path d="M9 0h31v31l-9 9H0V9z" fill="url(#${id})"/><path d="M27.8 13.2A10 10 0 1 0 27.8 26.8" fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round"/><path d="M18 15.2 25.4 20 18 24.8z" fill="#fff"/></svg>`;
}

/* ---------------- layout ---------------- */
let VER = "";
function page({ base, file, title, desc, canonical, nav, bodyGame = "", main, jsonld = [], image = "assets/img/og-image.png", noindex = false, baseTag = "" }) {
  const full = title.includes("CLANKO100") ? title : `${title} | CLANKO100`;
  const navLink = (href, label, key) => `<a href="${base}${href}"${nav === key ? ' aria-current="page"' : ""}>${label}</a>`;
  const ld = jsonld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n");
  const html = `<!doctype html>
<html lang="en" data-base="${base}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${baseTag}<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${canonical}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="CLANKO100">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(desc)}">
${noindex ? "" : `<meta property="og:url" content="${canonical}">\n`}<meta property="og:image" content="${url(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#080a1f">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<link rel="icon" href="${base}favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">
<link rel="manifest" href="${base}site.webmanifest">
<link rel="preload" href="${base}assets/fonts/chakra-petch-700.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="${base}assets/css/site.css?v=${VER}">
<script>(function(){try{var t=JSON.parse(localStorage.getItem("c100:theme"));if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();</script>
${ld}
</head>
<body${bodyGame ? ` data-game="${bodyGame}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="${base}" aria-label="CLANKO100 home">${logoMark("lg-h")}<span>CLANKO<span class="logo-num">100</span></span></a>
    <nav class="nav" id="site-nav" aria-label="Main">
      ${navLink("", "Home", "home")}
      ${navLink("games/", "Games", "games")}
      ${navLink("categories/", "Categories", "categories")}
      ${navLink("about/", "About", "about")}
    </nav>
    <div class="header-tools">
      <button class="search-trigger" type="button" data-search-open aria-label="Search games">${icon("search")}<span>Search games</span><kbd>/</kbd></button>
      <button class="icon-btn theme-btn" type="button" data-theme-toggle aria-label="Switch to light theme">${icon("sun", "ico-sun")}${icon("moon", "ico-moon")}</button>
      <button class="icon-btn menu-btn" type="button" data-menu aria-controls="site-nav" aria-expanded="false" aria-label="Menu">${icon("menu")}</button>
    </div>
  </div>
</header>
<main id="main">
${main}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="logo" href="${base}" aria-label="CLANKO100 home">${logoMark("lg-f")}<span>CLANKO<span class="logo-num">100</span></span></a>
      <p style="margin-top:14px">Free games you can play in your browser, made by clanko. Every game here is a CLANKO100 original, so it loads fast and works on computers, tablets and phones.</p>
    </div>
    <div>
      <h2>Explore</h2>
      <ul>
        <li><a href="${base}games/">All games</a></li>
        <li><a href="${base}categories/">Categories</a></li>
        <li><a href="${base}games/?cat=favs">Your favourites</a></li>
        <li><a href="${base}" data-random>Random game</a></li>
        <li><a href="${base}about/">About</a></li>
        <li><a href="${base}contact/">Contact and reports</a></li>
      </ul>
    </div>
    <div>
      <h2>Categories</h2>
      <ul class="cols-2" style="display:grid">
        ${cats.map((c) => `<li><a href="${base}category/${c.slug}/">${esc(c.name)}</a></li>`).join("\n        ")}
      </ul>
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>&copy; ${cfg.year} CLANKO100. Made by ${esc(cfg.author)}.</span>
    <span>Your favourites and saves stay in this browser. No accounts, no tracking.</span>
  </div>
</footer>
<dialog id="search-dialog" class="palette" aria-label="Search games">
  <div class="dialog-card">
    <div class="searchbox" data-search>
      <label class="field">${icon("search")}<span class="sr-only">Search games</span><input type="search" placeholder="Search games by name or type" autocomplete="off" spellcheck="false" role="combobox" aria-controls="pal-results" aria-expanded="false" aria-autocomplete="list"></label>
      <div class="results" id="pal-results" role="listbox" hidden></div>
    </div>
  </div>
</dialog>
<script src="${base}assets/js/config.js?v=${VER}" defer></script>
<script src="${base}assets/js/catalog.js?v=${VER}" defer></script>
<script src="${base}assets/js/cards.js?v=${VER}" defer></script>
<script src="${base}assets/js/site.js?v=${VER}" defer></script>
</body>
</html>
`;
  write(file, html);
  return file;
}

const sectionHead = (ico, title, more = "", sub = "") =>
  `<div class="section-head"><div><h2>${ico ? icon(ico) : ""}${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${more}</div>`;
const catTile = (c, base) => `<a class="cat-tile" href="${base}category/${c.slug}/"><span class="cat-icon">${icon(c.icon)}</span><span><b>${esc(c.name)}</b><span>${inCat(c.slug).length} ${inCat(c.slug).length === 1 ? "game" : "games"}</span></span></a>`;
const searchBox = (id, placeholder) => `<div class="searchbox" data-search>
        <label class="field">${icon("search")}<span class="sr-only">Search games</span><input type="search" id="${id}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" role="combobox" aria-controls="${id}-results" aria-expanded="false" aria-autocomplete="list"></label>
        <div class="results" id="${id}-results" role="listbox" hidden></div>
      </div>`;

/* ---------------- browser catalog ---------------- */
const slim = {
  categories: cats,
  games: ranked.slice().sort((a, b) => a.order - b.order).map((g) => ({ slug: g.slug, title: g.title, cats: g.cats, summary: g.summary, tags: g.tags, rank: g.rank, order: g.order, aspect: g.aspect }))
};
write("assets/js/catalog.js", `/* Generated by tools/build.mjs from tools/games.json. Edit that file, not this one. */\nwindow.C100 = ${JSON.stringify(slim)};\n`);
VER = hashOf("assets/css/site.css", "assets/js/site.js", "assets/js/cards.js", "assets/js/catalog.js", "assets/js/config.js");

/* ---------------- home ---------------- */
{
  const base = "";
  const gotd = featured[0] || games[0];
  const main = `<section class="hero">
  <div class="hero-bg" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="wrap hero-grid">
    <div>
      <h1 class="power-on"><span class="line neon">Your next</span> <span class="line neon">game starts</span> <span class="line neon">here.</span></h1>
      <p class="hero-lede">${games.length} free games that run right in your browser. No downloads and no sign-up: pick one and press play.</p>
      ${searchBox("hero-q", `Search ${games.length} games`)}
      <div class="hero-actions">
        <a class="btn" href="games/">${icon("grid")}Browse all games</a>
        <a class="btn btn-ghost" href="games/" data-random>${icon("shuffle")}Random game</a>
      </div>
    </div>
    <a class="gotd" data-gotd href="game/${gotd.slug}/" aria-label="Game of the day: ${esc(gotd.title)}">
      <div class="gotd-frame"><div class="gotd-inner">
        <img src="assets/thumbs/${gotd.slug}.webp" alt="" width="640" height="400" fetchpriority="high">
        <div class="gotd-body"><div><p class="gotd-tag">${icon("calendar")}Game of the day</p><h2 data-gotd-title>${esc(gotd.title)}</h2><p data-gotd-summary>${esc(gotd.summary)}</p></div><span class="play-round">${icon("play")}</span></div>
      </div></div>
    </a>
  </div>
</section>

<section class="section" data-recent-section hidden aria-labelledby="recent-h">
  <div class="wrap">
    <div class="section-head"><div><h2 id="recent-h">${icon("clock")}Jump back in</h2><p>Games you played recently on this device.</p></div></div>
    <div class="cards" data-recent-list></div>
  </div>
</section>

<section class="section" aria-labelledby="feat-h">
  <div class="wrap">
    <div class="section-head"><div><h2 id="feat-h">${icon("star")}Featured</h2></div><a class="more" href="games/">All games</a></div>
    <div class="featured">
      ${featured.map((g, i) => Cards.card(g, base, { size: i === 0 ? "lg" : "md", eager: true })).join("\n      ")}
    </div>
  </div>
</section>

<section class="section" aria-labelledby="trend-h">
  <div class="wrap">
    <div class="section-head"><div><h2 id="trend-h">${icon("trend")}Trending now</h2></div><a class="more" href="games/">See more</a></div>
    <ol class="rank">
      ${trending.slice(0, 7).map((g, i) => Cards.rankItem(g, base, i + 1)).join("\n      ")}
    </ol>
  </div>
</section>

<section class="section" aria-labelledby="cat-h">
  <div class="wrap">
    <div class="section-head"><div><h2 id="cat-h">${icon("grid")}Categories</h2></div><a class="more" href="categories/">All categories</a></div>
    <div class="cat-grid">
      ${cats.map((c) => catTile(c, base)).join("\n      ")}
    </div>
  </div>
</section>

<section class="section" aria-labelledby="fav-h">
  <div class="wrap">
    <div class="section-head"><div><h2 id="fav-h">${icon("heart")}Your favourites</h2></div><a class="more" href="games/?cat=favs">Open in library</a></div>
    <div class="cards" data-favs-list hidden></div>
    <p class="empty" data-favs-empty>${icon("heart")}<span>Tap the heart on any game to save it here. Favourites stay on this device.</span></p>
  </div>
</section>

<section class="section" aria-labelledby="new-h">
  <div class="wrap">
    <div class="section-head"><div><h2 id="new-h">${icon("spark")}Recently added</h2></div><a class="more" href="games/?sort=new">Newest first</a></div>
    <div class="cards">
      ${newest.slice(0, 8).map((g) => Cards.card(g, base)).join("\n      ")}
    </div>
  </div>
</section>`;
  page({
    base, file: "index.html", nav: "home", canonical: url(""),
    title: "CLANKO100 | Free browser games, play instantly",
    desc: `Play ${games.length} free browser games instantly on CLANKO100. Racing, action, puzzle, horror, sports, strategy and more. No downloads, no sign-up, works on phones and computers.`,
    main,
    jsonld: [{ "@context": "https://schema.org", "@type": "WebSite", name: "CLANKO100", url: url(""), potentialAction: { "@type": "SearchAction", target: url("games/") + "?q={search_term_string}", "query-input": "required name=search_term_string" } }]
  });
}

/* ---------------- library ---------------- */
{
  const base = "../";
  const main = `<div class="wrap page-head">
  <h1>All games</h1>
  <p>Every game on CLANKO100, free to play in your browser. Search by name, or filter by category.</p>
</div>
<div class="filters">
  <div class="wrap">
    <div class="filters-row">
      <div class="searchbox"><label class="field">${icon("search")}<span class="sr-only">Search games</span><input id="lib-q" type="search" placeholder="Search by name or type" autocomplete="off" spellcheck="false"></label></div>
      <label class="sr-only" for="lib-sort">Sort games</label>
      <select id="lib-sort"><option value="featured">Featured first</option><option value="az">A to Z</option><option value="new">Newest</option></select>
      <span class="count" id="lib-count" aria-live="polite">${games.length} games</span>
    </div>
    <div class="chips" role="group" aria-label="Filter by category">
      <button class="chip" type="button" data-cat="all" aria-pressed="true">All games</button>
      <button class="chip" type="button" data-cat="favs" aria-pressed="false">${icon("heart")}Favourites</button>
      ${cats.map((c) => `<button class="chip" type="button" data-cat="${c.slug}" aria-pressed="false">${icon(c.icon)}${esc(c.name)}</button>`).join("\n      ")}
    </div>
  </div>
</div>
<div class="wrap">
  <div class="cards" id="library-grid">
    ${ranked.map((g) => Cards.card(g, base, { headingLevel: 2 })).join("\n    ")}
  </div>
  <div class="empty" id="lib-empty" hidden>${icon("search")}<span data-empty-text></span><button class="btn btn-ghost btn-sm" type="button" data-clear style="margin-left:auto">Show all games</button></div>
</div>`;
  page({ base, file: "games/index.html", nav: "games", canonical: url("games/"), title: "All free games",
    desc: `Browse all ${games.length} free games on CLANKO100. Search by name or filter by racing, action, puzzle, horror, sports, strategy and more. Play instantly in your browser.`, main });
}

/* ---------------- categories ---------------- */
{
  const base = "../";
  const main = `<div class="wrap page-head">
  <h1>Categories</h1>
  <p>Find your kind of game. Some games fit more than one category, so you'll see them in each.</p>
</div>
<div class="wrap" style="padding-top:26px;padding-bottom:30px">
  <div class="cat-big">
    ${cats.map((c) => {
      const list = inCat(c.slug);
      return `<a class="cat-card" href="${base}category/${c.slug}/">
      <span class="top"><span class="cat-icon">${icon(c.icon)}</span><span><h2>${esc(c.name)}</h2><span class="card-cat" style="margin:2px 0 0">${list.length} ${list.length === 1 ? "game" : "games"}</span></span></span>
      <p>${esc(c.blurb)}</p>
      <span class="cat-thumbs">${list.slice(0, 3).map((g) => `<img src="${base}assets/thumbs/${g.slug}.webp" alt="" width="640" height="400" loading="lazy" decoding="async">`).join("")}</span>
    </a>`;
    }).join("\n    ")}
  </div>
</div>`;
  page({ base, file: "categories/index.html", nav: "categories", canonical: url("categories/"), title: "Game categories",
    desc: `Free browser games by category: ${cats.map((c) => c.name).join(", ")}.`, main });
}

/* ---------------- each category ---------------- */
for (const c of cats) {
  const base = "../../";
  const list = inCat(c.slug);
  const main = `<div class="wrap page-head">
  <a class="crumb" href="${base}categories/">${icon("back")}All categories</a>
  <div class="cat-head"><span class="cat-icon">${icon(c.icon)}</span><div><h1>${esc(c.name)} games</h1></div></div>
  <p>${esc(c.blurb)} ${list.length} free ${list.length === 1 ? "game" : "games"} to play right now.</p>
</div>
<div class="wrap" style="padding-top:26px">
  <div class="cards">
    ${list.map((g) => Cards.card(g, base, { headingLevel: 2 })).join("\n    ")}
  </div>
</div>
<section class="section" aria-labelledby="other-h">
  <div class="wrap">
    <div class="section-head"><div><h2 id="other-h">Other categories</h2></div><a class="more" href="${base}games/">All games</a></div>
    <div class="cat-grid">
      ${cats.filter((o) => o.slug !== c.slug).map((o) => catTile(o, base)).join("\n      ")}
    </div>
  </div>
</section>`;
  page({ base, file: `category/${c.slug}/index.html`, nav: "categories", canonical: url(`category/${c.slug}/`), title: `${c.name} games, free to play`,
    desc: `Play free ${c.name.toLowerCase()} games online on CLANKO100: ${list.map((g) => g.title).join(", ")}. ${c.blurb}`, main,
    jsonld: [{ "@context": "https://schema.org", "@type": "CollectionPage", name: `${c.name} games`, url: url(`category/${c.slug}/`),
      mainEntity: { "@type": "ItemList", itemListElement: list.map((g, i) => ({ "@type": "ListItem", position: i + 1, url: url(`game/${g.slug}/`), name: g.title })) } }] });
}

/* ---------------- each game ---------------- */
function similar(g) {
  const score = (o) => (o.cats[0] === g.cats[0] ? 10 : 0) + o.cats.filter((c) => g.cats.includes(c)).length * 4 + o.tags.filter((t) => g.tags.includes(t)).length * 2 - o.rank * 0.01;
  return ranked.filter((o) => o.slug !== g.slug).map((o) => ({ o, s: score(o) })).sort((a, b) => b.s - a.s).slice(0, 4).map((x) => x.o);
}
for (const g of games) {
  const base = "../../";
  const r = ratio(g.aspect);
  const primary = catBySlug[g.cats[0]];
  const orientation = r < 0.95 ? "Turn your phone upright for this one." : r > 1.2 ? "Turn your phone sideways for this one." : "";
  // Self-hosted games live in embed/<slug>/. A game hosted elsewhere (with the owner's permission) can set
  // "embedUrl" to its embed address, and "officialUrl" to its home page. If the other site blocks embedding,
  // set "noEmbed": true and the page shows a button to play it on the official site instead.
  const src = g.embedUrl || `${base}embed/${g.slug}/`;
  const outUrl = g.officialUrl || src;
  const playerHtml = g.noEmbed
    ? `<div class="player launch" style="--ar:${g.aspect};--arn:${r.toFixed(4)}">
      <img src="${base}assets/thumbs/${g.slug}.webp" alt="" width="640" height="400">
      <div class="launch-box"><p>This game runs on its official website.</p><a class="btn" href="${esc(outUrl)}" target="_blank" rel="noopener">${icon("external")}Play on the official site</a></div>
    </div>`
    : `<div class="player" data-player data-slug="${g.slug}" style="--ar:${g.aspect};--arn:${r.toFixed(4)}">
      <iframe src="${esc(src)}" title="${esc(g.title)}" allow="fullscreen; autoplay; gamepad"></iframe>
      <div class="loader" aria-hidden="true"><div class="loader-ring"></div><p>Loading ${esc(g.title)}</p><div class="bar"><i></i></div></div>
      <button class="icon-btn theater-close" type="button" aria-label="Exit fullscreen">${icon("close")}</button>
    </div>`;
  const main = `<div class="wrap game-top">
  <a class="crumb" href="${base}games/">${icon("back")}Back to all games</a>
  <div class="player-wrap">
    ${playerHtml}
  </div>
  <div class="game-bar">
    <h1>${esc(g.title)}</h1>
    ${g.noEmbed ? "" : `<button class="btn btn-sm" type="button" data-fullscreen>${icon("expand")}<span data-fs-label>Fullscreen</span></button>`}
    <button class="btn btn-ghost btn-sm fav-big" type="button" data-fav="${g.slug}" aria-pressed="false" aria-label="Save ${esc(g.title)} to favourites">${icon("heart")}<span data-fav-label>Favourite</span></button>
    <a class="btn btn-ghost btn-sm" href="${esc(outUrl)}" target="_blank" rel="noopener">${icon("external")}${g.officialUrl ? "Official site" : "New tab"}</a>
    <div class="cats">${g.cats.map((c) => `<a class="tag" href="${base}category/${c}/">${icon(catBySlug[c].icon)}${esc(catBySlug[c].name)}</a>`).join("")}</div>
  </div>
  <p class="mobile-tip">Tap Fullscreen for the biggest view. ${orientation}</p>
</div>
<div class="wrap info-grid">
  <section aria-labelledby="about-h">
    <h2 id="about-h">About ${esc(g.title)}</h2>
    <div class="prose"><p>${esc(g.summary)}</p><p>${esc(g.about)}</p></div>
    <div class="facts">
      <span class="tag">${icon("check")}Free, no download</span>
      ${g.mobile ? `<span class="tag">${icon("check")}Works on phones and tablets</span>` : ""}
      ${g.embedUrl || g.noEmbed ? "" : `<span class="tag">${icon("check")}Saves your best score</span>`}
    </div>
    <button class="report-link" type="button" data-report>${icon("flag")}Report a problem with this game</button>
  </section>
  <section aria-labelledby="how-h">
    <h2 id="how-h">How to play</h2>
    <ul class="controls">
      ${g.controls.map((c) => `<li>${icon("joystick")}<span>${esc(c)}</span></li>`).join("\n      ")}
    </ul>
  </section>
</div>
<section class="section" aria-labelledby="sim-h">
  <div class="wrap">
    <div class="section-head"><div><h2 id="sim-h">More games like ${esc(g.title)}</h2></div><a class="more" href="${base}category/${primary.slug}/">More ${esc(primary.name.toLowerCase())} games</a></div>
    <div class="cards">
      ${similar(g).map((o) => Cards.card(o, base)).join("\n      ")}
    </div>
  </div>
</section>
<dialog id="report-dialog" aria-labelledby="report-h">
  <div class="dialog-card">
    <div class="dialog-head"><h2 id="report-h">Report a problem</h2><button class="icon-btn" type="button" data-close-dialog aria-label="Close">${icon("close")}</button></div>
    <form class="form" data-form data-submit-label="Send report" novalidate>
      <input type="hidden" name="type" value="report">
      <input type="hidden" name="game" value="${g.slug}">
      <label><span>What went wrong with ${esc(g.title)}?</span>
        <select name="problem">
          <option>The game won't load</option>
          <option>The controls don't work</option>
          <option>It's slow or laggy</option>
          <option>Something looks broken</option>
          <option>Something else</option>
        </select>
      </label>
      <label><span>Tell us more <small>(optional)</small></span><textarea name="message" placeholder="What were you doing when it happened?"></textarea></label>
      <label><span>Your email <small>(optional, only if you'd like a reply)</small></span><input type="email" name="email" autocomplete="email"></label>
      <input class="hp" type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="form-status" hidden></p>
      <button class="btn" type="submit">Send report</button>
    </form>
  </div>
</dialog>`;
  page({
    base, file: `game/${g.slug}/index.html`, nav: "games", canonical: url(`game/${g.slug}/`), bodyGame: g.slug,
    title: `${g.title}: play free online`, desc: `Play ${g.title} free in your browser. ${g.summary}`, image: `assets/og/${g.slug}.jpg`, main,
    jsonld: [
      { "@context": "https://schema.org", "@type": "VideoGame", name: g.title, description: g.summary, url: url(`game/${g.slug}/`), image: url(`assets/og/${g.slug}.jpg`),
        genre: g.cats.map((c) => catBySlug[c].name), gamePlatform: "Web browser", applicationCategory: "Game", operatingSystem: "Any", inLanguage: "en",
        playMode: g.cats.includes("multiplayer") ? ["SinglePlayer", "MultiPlayer"] : "SinglePlayer",
        author: { "@type": "Person", name: cfg.author }, offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" } },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Games", item: url("games/") },
        { "@type": "ListItem", position: 2, name: primary.name, item: url(`category/${primary.slug}/`) },
        { "@type": "ListItem", position: 3, name: g.title, item: url(`game/${g.slug}/`) }] }
    ]
  });
}

/* ---------------- about ---------------- */
{
  const base = "../";
  const main = `<div class="wrap page-head">
  <h1>About CLANKO100</h1>
  <p>CLANKO100 is a free browser games site made by clanko. Pick a game, press play, and you're in. Nothing to install and no account to make.</p>
</div>
<div class="wrap two-col">
  <div class="prose">
    <h2 style="margin-bottom:12px;color:var(--ink)">Every game is an original</h2>
    <p>All ${games.length} games on CLANKO100 were made for this site. That means they load fast, they don't show ads in the middle of a level, and they work on computers, tablets and phones. They're grouped into ${cats.length} categories, from racing and horror to puzzles and Minecraft-style building.</p>
    <p>Games that need a keyboard still have touch controls, and two-player games like Neon Rally and Four Up work on one shared device.</p>
    <h2 style="margin:28px 0 12px;color:var(--ink)">Your saves stay with you</h2>
    <ul class="list-check">
      <li>${icon("check")}<span>Favourites, recently played games, best scores and game saves are kept in your browser on this device.</span></li>
      <li>${icon("check")}<span>There are no accounts, no sign-ups and no tracking cookies.</span></li>
      <li>${icon("check")}<span>Clearing your browser data, or using a private window, starts you fresh.</span></li>
    </ul>
    <h2 style="margin:28px 0 12px;color:var(--ink)">More games are on the way</h2>
    <p>Got an idea for a game, or found one that isn't working? <a href="${base}contact/">Send a message</a> and it'll be looked at.</p>
  </div>
  <aside class="panel">
    <h2>Quick start</h2>
    <ul class="list-check">
      <li>${icon("search")}<span>Press <kbd>/</kbd> on any page to search.</span></li>
      <li>${icon("shuffle")}<span>Can't decide? Try a <a href="${base}" data-random>random game</a>.</span></li>
      <li>${icon("heart")}<span>Tap the heart on a game to save it to your favourites.</span></li>
      <li>${icon("expand")}<span>Use Fullscreen on a game page for the biggest view.</span></li>
      <li>${icon("flag")}<span>Spot a problem? Use “Report a problem” under any game.</span></li>
    </ul>
    <h2 style="margin-top:22px">Credits</h2>
    <p>Games, site and design by clanko. Fonts: Chakra Petch by Cadson Demak and Sora by Barbara Rodriguez, Jonathan Barnbrook and Julián Moncada, both under the SIL Open Font License.</p>
    <a class="btn btn-sm" href="${base}contact/">${icon("mail")}Contact</a>
  </aside>
</div>`;
  page({ base, file: "about/index.html", nav: "about", canonical: url("about/"), title: "About", desc: "CLANKO100 is a free browser games site made by clanko. Original games, no downloads, no accounts, saves kept in your browser.", main });
}

/* ---------------- contact ---------------- */
{
  const base = "../";
  const main = `<div class="wrap page-head">
  <h1>Contact and reports</h1>
  <p>Report a game that isn't working, suggest a new one, or just say hello.</p>
</div>
<div class="wrap two-col">
  <form class="form panel" id="contact-form" data-form data-submit-label="Send message" novalidate>
    <div class="form-row">
      <label><span>What's it about?</span>
        <select name="type">
          <option value="report">A game isn't working</option>
          <option value="suggest">Suggest a game</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <label><span>Which game? <small>(if any)</small></span><select name="game"></select></label>
    </div>
    <label><span>Message</span><textarea name="message" required placeholder="Tell us what happened, or what you'd like to see."></textarea></label>
    <div class="form-row">
      <label><span>Your name <small>(optional)</small></span><input type="text" name="name" autocomplete="nickname"></label>
      <label><span>Your email <small>(optional, for a reply)</small></span><input type="email" name="email" autocomplete="email"></label>
    </div>
    <input class="hp" type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">
    <p class="form-status" hidden></p>
    <div><button class="btn" type="submit">${icon("mail")}Send message</button></div>
  </form>
  <aside class="panel">
    <h2>Before you send a report</h2>
    <ul class="list-check">
      <li>${icon("check")}<span>Refresh the page. Most loading hiccups go away.</span></li>
      <li>${icon("check")}<span>Click inside the game once so it can hear your keyboard.</span></li>
      <li>${icon("check")}<span>Try “New tab” on the game page if your browser blocks something.</span></li>
      <li>${icon("check")}<span>Tell us which device and browser you use. It's added to the report for you.</span></li>
    </ul>
    <p style="margin-top:14px">Please don't include passwords or private details in your message.</p>
  </aside>
</div>`;
  page({ base, file: "contact/index.html", nav: "about", canonical: url("contact/"), title: "Contact and reports", desc: "Report a broken game, suggest a new game or get in touch with CLANKO100.", main });
}

/* ---------------- 404 ---------------- */
{
  const main = `<div class="wrap lost">
  <div>
    <p class="code neon">404</p>
    <h1 style="font-size:clamp(28px,4vw,40px);margin:10px 0 12px">Game over: this page doesn't exist</h1>
    <p style="color:var(--muted);max-width:44ch;margin:0 auto 24px">The link might be old or mistyped. Every game is still here, though.</p>
    <div class="hero-actions" style="justify-content:center">
      <a class="btn" href="./">Back to home</a>
      <a class="btn btn-ghost" href="games/">Browse games</a>
      <a class="btn btn-ghost" href="./" data-random>${icon("shuffle")}Random game</a>
    </div>
  </div>
</div>`;
  page({ base: "", file: "404.html", nav: "", canonical: "", noindex: true, baseTag: `<base href="${cfg.basePath}">\n`, title: "Page not found", desc: "This page doesn't exist on CLANKO100.", main });
}

/* ---------------- sitemap, robots, manifest ---------------- */
const urls = ["", "games/", "categories/", "about/", "contact/", ...cats.map((c) => `category/${c.slug}/`), ...ranked.map((g) => `game/${g.slug}/`)];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${url(u)}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>
`);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${url("sitemap.xml")}\n`);
write("site.webmanifest", JSON.stringify({ name: "CLANKO100", short_name: "CLANKO100", description: "Free browser games, play instantly.", start_url: cfg.basePath, display: "standalone",
  background_color: "#080a1f", theme_color: "#080a1f", icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png" }] }, null, 2) + "\n");
write("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${logoMark("f").replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</svg>\n`);

console.log(`Built ${urls.length + 1} pages for ${games.length} games and ${cats.length} categories (assets v${VER}).`);
