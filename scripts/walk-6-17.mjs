// Com Argentina setada (gate aberto), caminha de 6 a 17 dumpando o DOM real
// (labels/radios/selects exatos) pra calibrar os seletores. Respostas genericas
// so pra atravessar. NAO submete.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("artifacts/dom6", { recursive: true });

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const heading = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (await n.isVisible().catch(() => false)) { await n.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(500); return true; } return false; };

const dumpFn = () => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const labelFor = (el) => { if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && txt(l.textContent)) return txt(l.textContent); } if (el.getAttribute("aria-label")) return txt(el.getAttribute("aria-label")); const wl = el.closest("label"); if (wl && txt(wl.textContent)) return txt(wl.textContent); return ""; };
  const qOf = (r) => { const fs = r.closest("fieldset"); if (fs) { const lg = fs.querySelector("legend"); if (lg && txt(lg.textContent)) return txt(lg.textContent).slice(0, 160); } return ""; };
  const o = { url: location.href, headings: [], inputs: [], radios: [], selects: [] };
  document.querySelectorAll("h2,h3,legend").forEach((h) => { const t = txt(h.textContent); if (t) o.headings.push(t); });
  document.querySelectorAll("input,select,textarea").forEach((el) => { if (!vis(el)) return; const type = (el.getAttribute("type") || el.tagName).toLowerCase(); if (el.tagName === "SELECT") o.selects.push({ label: labelFor(el), options: [...el.options].map((x) => txt(x.text)).filter(Boolean).slice(0, 12) }); else if (type === "radio" || type === "checkbox") { const q = qOf(el); o.radios.push({ type, q, label: labelFor(el) }); } else if (type === "text" || type === "textarea" || type === "tel") o.inputs.push({ type, label: labelFor(el) }); });
  return o;
};

// preencher generico pra avancar (respostas throwaway). No ImmiAccount, No = value "2".
const advanceFill = () => {
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const byName = {};
  [...document.querySelectorAll('input[type=radio]')].filter(vis).forEach((r) => { (byName[r.name] = byName[r.name] || []).push(r); });
  // forca "No" (value 2) em todo grupo Yes/No -> evita revelar sub-perguntas
  Object.values(byName).forEach((grp) => { const no = grp.find((r) => r.value === "2"); if (no && !no.checked) no.click(); });
  // depois de colapsar reveals, preenche texto vazio visivel -> CALIB
  [...document.querySelectorAll('input[type=text], input[type=tel], textarea')].filter(vis).forEach((i) => { if (!i.value) { i.value = "CALIB"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); } });
  // select vazio -> 2a opcao (1a costuma ser placeholder)
  [...document.querySelectorAll('select')].filter(vis).forEach((s) => { if (!s.value || s.selectedIndex <= 0) { if (s.options.length > 1) { s.selectedIndex = 1; s.dispatchEvent(new Event("change", { bubbles: true })); } } });
};

console.log("start:", (await heading()).slice(0, 50));
for (let step = 0; step < 16; step++) {
  await pg.waitForTimeout(400);
  const d = await pg.evaluate(dumpFn);
  const tag = d.headings.slice(0, 3).join(" | ");
  writeFileSync(`artifacts/dom6/p${String(step).padStart(2, "0")}.json`, JSON.stringify(d, null, 2));
  await pg.screenshot({ path: `artifacts/dom6/p${String(step).padStart(2, "0")}.png`, fullPage: true }).catch(() => {});
  console.log(`\n=== ${step} :: ${tag.slice(0, 70)} ===`);
  const rq = [...new Set(d.radios.map((r) => r.q).filter(Boolean))];
  if (d.inputs.length) console.log("  inputs:", d.inputs.map((x) => x.label).filter(Boolean).join(" ; ").slice(0, 200));
  if (d.selects.length) console.log("  selects:", d.selects.map((x) => x.label).filter(Boolean).join(" ; ").slice(0, 200));
  if (rq.length) console.log("  radioQs:", rq.map((q) => q.slice(0, 65)).join(" ;; ").slice(0, 400));
  if (/provide documents|attach|payment|charge|submit now|declaration of|review|check your answers/i.test(tag)) { console.log(">> chegou em docs/review/submit. Parando."); break; }
  await pg.evaluate(advanceFill);
  await pg.waitForTimeout(400);
  if (!(await clickNext())) { console.log(">> sem Next. Parando."); break; }
}
console.log("\nDONE. Dumps em artifacts/dom6/");
await b.close();
