// CLANKO GP — entry point.
import { App } from "./game/app.js";

function fail(msg) {
  const el = document.getElementById("boot");
  if (el) el.innerHTML = `<div class="boot-err"><h2>CLANKO GP can't start here</h2><p>${msg}</p><p>Try an up-to-date Chrome, Edge, Firefox or Safari on a computer with graphics acceleration turned on.</p></div>`;
}

(function boot() {
  const c = document.createElement("canvas");
  if (!c.getContext("webgl2")) { fail("This browser does not support WebGL 2, which the 3D graphics need."); return; }
  try {
    const app = new App(document.getElementById("app"));
    window.__app = app;
    app.init().then(() => { const b = document.getElementById("boot"); if (b) b.remove(); window.__ready = true; });
  } catch (e) {
    console.error(e);
    fail(e.message);
  }
})();
