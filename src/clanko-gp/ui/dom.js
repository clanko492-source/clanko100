// CLANKO GP — tiny DOM helpers.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
/** set text only when it changed (cheap HUD updates) */
export function setText(el, t) { if (el._t !== t) { el._t = t; el.textContent = t; } }
export function setStyle(el, k, v) { const key = "_s_" + k; if (el[key] !== v) { el[key] = v; el.style[k] = v; } }
export function toggle(el, cls, on) { if (!!el["_c_" + cls] !== !!on) { el["_c_" + cls] = !!on; el.classList.toggle(cls, !!on); } }
