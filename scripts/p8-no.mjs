// pg8: marca "No" (nao autoriza outro recebedor), re-dumpa p/ ver se revela
// sub-pergunta (electronic communication) e se o erro sai. NAO clica Next ainda.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const res = await pg.evaluate(() => {
  const n = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const r = [...document.querySelectorAll('input[type=radio]')].find((x) => x.value === "NO" && x.offsetParent);
  if (!r) return "radio NO nao achado";
  if (!r.checked) r.click();
  return "NO marcado";
});
console.log(res);
await pg.waitForTimeout(700);
const d = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const labelFor = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : ""; };
  const groups = {}; const selects = []; const inputs = [];
  document.querySelectorAll("input,select,textarea").forEach((el) => {
    if (!vis(el)) return; const t = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (t === "radio") { const fs = el.closest("fieldset"); const lg = fs && fs.querySelector("legend"); const q = lg ? txt(lg.textContent).slice(0, 80) : el.name; (groups[q] = groups[q] || []).push({ label: labelFor(el), checked: el.checked }); }
    else if (el.tagName === "SELECT") selects.push({ label: labelFor(el), val: txt(el.options[el.selectedIndex]?.text || "") });
    else if (["text", "email", "tel", "textarea", "number"].includes(t)) inputs.push({ label: labelFor(el), val: el.value });
  });
  const err = !!document.querySelector("h1,h2,h3") && [...document.querySelectorAll("h1,h2,h3")].some((h) => /error has occurred/i.test(h.textContent));
  return { err, groups, selects, inputs };
});
console.log(JSON.stringify(d, null, 2));
await b.close();
