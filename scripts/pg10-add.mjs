// Na pg10 (Education, Yes marcado), clica "Add" e dumpa a estrutura do modal/subform
// de estudo (Qualification/Institution/Course/Datas).
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
console.log("antes:", (await H()).replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 50));
// clica Add
const add = pg.locator('button:has-text("Add"), a:has-text("Add"), input[value="Add"]').filter({ hasNot: pg.locator("[disabled]") }).first();
if (await add.isVisible().catch(() => false)) { await add.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1200); console.log("cliquei Add"); }
else console.log("Add nao visivel");
const d = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const labelFor = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : (el.getAttribute("aria-label") || ""); };
  const qOf = (r) => { const fs = r.closest("fieldset"); const lg = fs && fs.querySelector("legend"); return lg ? txt(lg.textContent).slice(0, 100) : ""; };
  const o = { headings: [], groups: {}, selects: [], inputs: [], buttons: [] };
  document.querySelectorAll("h1,h2,h3,h4,legend").forEach((h) => { const t = txt(h.textContent); if (t) o.headings.push(t.slice(0, 60)); });
  document.querySelectorAll("input,select,textarea").forEach((el) => {
    if (!vis(el)) return; const t = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (t === "radio") { const q = qOf(el) || el.name; (o.groups[q] = o.groups[q] || []).push(labelFor(el).slice(0, 40)); }
    else if (el.tagName === "SELECT") o.selects.push({ label: labelFor(el), n: el.options.length, sample: [...el.options].slice(0, 14).map((x) => txt(x.text)).filter(Boolean) });
    else if (["text", "tel", "email", "number", "textarea"].includes(t)) o.inputs.push({ label: labelFor(el), type: t });
  });
  o.buttons = [...document.querySelectorAll("button,a.wc-button,input[type=submit]")].filter(vis).map((x) => txt(x.textContent) || x.value).filter(Boolean).slice(0, 12);
  return o;
});
console.log(JSON.stringify(d, null, 1));
await pg.screenshot({ path: "artifacts/pg10-add.png", fullPage: true }).catch(() => {});
await b.close();
