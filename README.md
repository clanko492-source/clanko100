# CLANKO100

Free browser games, play instantly. Made by clanko.

This folder is the whole website. It's plain HTML, CSS and JavaScript, so any free static host can run it without a server, a database or a build step. **To put it online, follow [DEPLOY.md](DEPLOY.md).**

## What's inside

- **20 original games** in 13 categories, each in its own folder under `embed/`. They all work with a keyboard, a mouse or touch, and save best scores in the player's browser.
- **Home page** with a search bar, game of the day, featured, trending, categories, favourites, recently played and recently added games.
- **Games library** (`/games/`) with instant search, category filters, a favourites filter and sorting.
- **A page for every game** (`/game/<name>/`) with a big player, fullscreen, favourite button, open-in-new-tab, description, controls, similar games and a "Report a problem" form.
- **Category pages**, an About page, a Contact page and a custom 404 page.
- **SEO**: page titles and descriptions, share images, structured data, `sitemap.xml` and `robots.txt`.
- Light and dark themes, a mobile layout, and nothing that tracks visitors.

| Game | Category | Folder |
| --- | --- | --- |
| Arena Survivor | Action, Shooting | `embed/arena-survivor` |
| Neon Runner | Action, Platformer | `embed/neon-runner` |
| Dungeon Dash | Adventure, Action | `embed/dungeon-dash` |
| Turbo Lanes | Racing, Arcade | `embed/turbo-lanes` |
| Neon Drift | Racing | `embed/neon-drift` |
| Shadow Maze | Horror, Adventure | `embed/shadow-maze` |
| Hoop Star | Sports | `embed/hoop-star` |
| Neon Rally | Multiplayer, Sports, Arcade | `embed/neon-rally` |
| Star Blaster | Shooting, Arcade, Action | `embed/star-blaster` |
| Pixel Peak | Platformer, Adventure | `embed/pixel-peak` |
| Neon 2048 | Puzzle | `embed/neon-2048` |
| Minefield | Puzzle, Strategy | `embed/minefield` |
| Memory Match | Puzzle | `embed/memory-match` |
| Four Up | Strategy, Multiplayer, Puzzle | `embed/four-up` |
| Crystal Clicker | Idle and Clicker | `embed/crystal-clicker` |
| Blocklands | Minecraft-style, Adventure | `embed/blocklands` |
| Neon Snake | Arcade, Puzzle | `embed/neon-snake` |
| Neon Breaker | Arcade | `embed/neon-breaker` |
| Sky Hopper | Arcade | `embed/sky-hopper` |
| Neon Defense | Strategy | `embed/neon-defense` |

Every game was written for CLANKO100, so you own them and there are no licences to worry about. The two fonts (Chakra Petch and Sora) are free under the SIL Open Font License; their licence files are in `assets/fonts/`.

## Folders

```
index.html            home page
games/                the library
game/<name>/          one page per game
category/<name>/      one page per category
categories/, about/, contact/, 404.html
embed/<name>/         the games themselves
embed/kit/            shared game code: controls, sound, menus, saving
assets/css/site.css   all site styles
assets/js/            site.js (features), cards.js (card + icon templates),
                      catalog.js (generated game list), config.js (your settings)
assets/thumbs/        card images (640x400 WebP)
assets/og/            share images (1200x630 JPG)
tools/                the page builder and game list (not needed by visitors)
```

## Turn on the contact and report forms

Open `assets/js/config.js` and follow the note at the top. The easiest way is a free [Formspree](https://formspree.io) form: paste its ID into `formspreeId` and every report arrives in your email. Until you do, the forms tell visitors that sending isn't switched on yet.

## Change the site

The pages are generated from `tools/games.json`, so you rarely edit HTML by hand.

1. Install [Node.js](https://nodejs.org) (any version from 18 up).
2. Edit `tools/games.json` (titles, descriptions, categories, which games are featured or trending) or `tools/site.config.json` (your web address).
3. In a terminal, from this folder, run:

   ```
   node tools/build.mjs
   ```

4. Upload the folder again (see DEPLOY.md).

`featured` takes a number for the order on the home page (1 is the big one). `trending` takes a number for the ranking. `aspect` is the game's shape, like `16/9` or `2/3`, and sets the player size.

### Add one of your own games

1. Make a folder `embed/my-game/` with an `index.html`. The easiest start is copying a game that's similar to yours. The shared kit (`embed/kit/kit.js`) gives you the start and game-over screens, pause, sound, touch buttons and best scores; the top of that file lists what it does.
2. Add an entry for it in `tools/games.json` with the same `slug` as the folder name.
3. Add a 640x400 `assets/thumbs/my-game.webp` and a 1200x630 `assets/og/my-game.jpg`. Or, with Python and Playwright installed, start a local server (`python -m http.server 8123`) and run `python tools/make-thumbnails.py my-game` to screenshot it for you.
4. Run `node tools/build.mjs`.

### Add a game from another website

Only add games you have permission to embed (for example, a developer on itch.io who allows embedding, or a game distribution program that gives you embed codes). In `tools/games.json`, set:

- `"embedUrl"`: the embed address they give you
- `"officialUrl"`: the game's own page
- `"noEmbed": true` if their site blocks embedding. The game page then shows a "Play on the official site" button instead of a broken window.

## Try it on your computer

From this folder run `python -m http.server 8123` (or `npx serve`) and open http://localhost:8123. Opening the HTML files by double-clicking mostly works too, but some browsers block games in frames that way.
