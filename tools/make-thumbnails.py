#!/usr/bin/env python3
"""
CLANKO100 thumbnail maker (optional tool).

Opens every game in a headless browser in "thumbnail mode" (?thumb=1), takes a screenshot and
writes:
  assets/thumbs/<slug>.webp   640x400 card images
  assets/og/<slug>.jpg        1200x630 social share images
plus the favicon PNGs and the site share image.

Needs Python 3 with Playwright and Pillow:
  pip install playwright pillow && python -m playwright install chromium
Run from the project folder while a local server is running:
  python -m http.server 8123
  python tools/make-thumbnails.py            (all games)
  python tools/make-thumbnails.py neon-snake (just one)
"""
import json, sys, time, io
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SERVER = "http://127.0.0.1:8123"
data = json.loads((ROOT / "tools/games.json").read_text())
only = set(sys.argv[1:])

def compose(shot: Image.Image, W: int, H: int) -> Image.Image:
    sw, sh = shot.size
    r, R = sw / sh, W / H
    if abs(r - R) < 0.22:  # close enough: crop to fill
        scale = max(W / sw, H / sh)
        im = shot.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
        x, y = (im.width - W) // 2, (im.height - H) // 2
        return im.crop((x, y, x + W, y + H))
    # different shape: the full game in front of a blurred, darkened copy of itself
    scale = max(W / sw, H / sh)
    bg = shot.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    x, y = (bg.width - W) // 2, (bg.height - H) // 2
    bg = bg.crop((x, y, x + W, y + H)).filter(ImageFilter.GaussianBlur(28))
    bg = ImageEnhance.Brightness(bg).enhance(0.45)
    fscale = min(W / sw, H / sh)
    fg = shot.resize((round(sw * fscale), round(sh * fscale)), Image.LANCZOS)
    bg.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2))
    return bg

def ratio(a):
    w, h = [float(x) for x in a.split("/")]
    return w / h

(ROOT / "assets/thumbs").mkdir(parents=True, exist_ok=True)
(ROOT / "assets/og").mkdir(parents=True, exist_ok=True)
(ROOT / "assets/img").mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    for g in data["games"]:
        if only and g["slug"] not in only:
            continue
        r = ratio(g["aspect"])
        if r >= 1.6:
            vw, vh = 1280, round(1280 / r)
        else:
            vh = 800
            vw = round(800 * r)
        page = browser.new_page(viewport={"width": vw, "height": vh}, device_scale_factor=1)
        page.goto(f"{SERVER}/embed/{g['slug']}/?thumb=1", wait_until="load")
        page.evaluate("document.fonts && document.fonts.ready")
        time.sleep(1.6)
        png = page.screenshot(type="png")
        page.close()
        shot = Image.open(io.BytesIO(png)).convert("RGB")
        compose(shot, 640, 400).save(ROOT / f"assets/thumbs/{g['slug']}.webp", "WEBP", quality=80, method=6)
        compose(shot, 1200, 630).save(ROOT / f"assets/og/{g['slug']}.jpg", "JPEG", quality=84, optimize=True, progressive=True)
        print("thumb", g["slug"], f"{vw}x{vh}")

    if not only:
        # favicons from favicon.svg
        svg = (ROOT / "favicon.svg").read_text()
        for size, name in [(32, "favicon-32.png"), (180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
            page = browser.new_page(viewport={"width": size, "height": size})
            pad = 0 if size <= 32 else round(size * 0.1)
            bg = "transparent" if size <= 32 else "#080a1f"
            page.set_content(f'<html><body style="margin:0;background:{bg};display:grid;place-items:center;width:{size}px;height:{size}px">'
                             f'<div style="width:{size - 2 * pad}px;height:{size - 2 * pad}px">{svg.replace("<svg ", "<svg width=\"100%\" height=\"100%\" ", 1)}</div></body></html>')
            page.screenshot(path=str(ROOT / name), omit_background=size <= 32)
            page.close()
            print("icon", name)
        # site share image
        page = browser.new_page(viewport={"width": 1200, "height": 630})
        page.goto(f"{SERVER}/tools/og-template.html", wait_until="load")
        page.evaluate("document.fonts.ready")
        time.sleep(0.8)
        page.screenshot(path=str(ROOT / "assets/img/og-image.png"))
        page.close()
        print("og-image")
    browser.close()
