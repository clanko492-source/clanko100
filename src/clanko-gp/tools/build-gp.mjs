// Build CLANKO GP: bundle and minify the modules (three.js included) into embed/clanko-gp/.
// node tools/build-gp.mjs [--dev]   (--dev writes dev.html that loads the source modules directly)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");
const out = join(src, "..", "..", "embed", "clanko-gp");
const dev = process.argv.includes("--dev");
const html = readFileSync(join(src, "index.html"), "utf8");
if (dev) {
  const im = `<script type="importmap">{"imports":{"three":"./vendor/three-build/three.module.js","three/addons/":"./vendor/three-addons/"}}</script>`;
  writeFileSync(join(src, "dev.html"), html.replace("<!--IMPORTMAP-->", im).replace("<!--ENTRY-->", `<script type="module" src="main.js"></script>`));
  console.log("wrote dev.html");
} else {
  mkdirSync(out, { recursive: true });
  const esbuild = process.env.ESBUILD || "/opt/npm-tools/node_modules/esbuild/bin/esbuild";
  const version = Date.now().toString(36);
  execFileSync(esbuild, [join(src, "main.js"), "--bundle", "--format=esm", "--minify", "--target=es2020", "--legal-comments=eof",
    `--alias:three=${join(src, "vendor/three-build/three.module.js")}`, `--alias:three/addons=${join(src, "vendor/three-addons")}`,
    "--outfile=" + join(out, "game.js")], { stdio: "inherit" });
  copyFileSync(join(src, "style.css"), join(out, "style.css"));
  writeFileSync(join(out, "index.html"), html.replace("<!--IMPORTMAP-->", "").replace('href="style.css"', `href="style.css?v=${version}"`).replace("<!--ENTRY-->", `<script type="module" src="game.js?v=${version}"></script>`));
  const kb = (f) => Math.round(statSync(join(out, f)).size / 1024);
  console.log(`built embed/clanko-gp: game.js ${kb("game.js")} KB, style.css ${kb("style.css")} KB`);
}
