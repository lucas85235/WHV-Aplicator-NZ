// Navega ate "Attach documents", faz "Expand all" e dumpa a estrutura de anexo
// (file inputs, botoes Attach, dropdowns de tipo, secoes). READ-ONLY: nao sobe
// arquivo, nao clica Next, nao vai pro pagamento.
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(true);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 70);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1000); return true; };

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
if (await pg.locator("input[type=password]").first().isVisible().catch(() => false)) { console.log("NEED_LOGIN"); await b.close(); process.exit(0); }
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
// walk ate Review, aplicando handlers (fillMode true -> pula preenchidos)
for (let i = 0; i < 20; i++) {
  const h = await H();
  if (/review page|check your answers/i.test(h)) break;
  if (/attach documents|provide documents/i.test(h)) break;
  const m = PAGE_MATCHERS.find((x) => x.re.test(h));
  if (m) { try { await m.page.handle({ page: pg, cfg }); } catch {} }
  await pg.waitForTimeout(200);
  if (!(await clickNext())) break;
}
console.log("parou em:", tt(await H()));
// se em Review, 1 Next -> Attach documents
if (/review page/i.test(await H())) { await clickNext(); console.log("apos Next:", tt(await H())); }
// Expand all
const exp = pg.locator('button:has-text("Expand all"), a:has-text("Expand all")').first();
if (await exp.isVisible().catch(() => false)) { await exp.click().catch(() => {}); await pg.waitForTimeout(1200); console.log("Expand all clicado"); }

const d = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : (el.getAttribute("aria-label") || ""); };
  const o = { docSections: [], fileInputs: 0, selects: [], attachButtons: [], allButtons: [] };
  // secoes de documento (headings dentro do accordion)
  document.querySelectorAll("h2,h3,h4,legend,.accordion-title,[role=button]").forEach((h) => { const t = txt(h.textContent); if (t && t.length < 80 && /document|passport|photo|evidence|funds|health|character|certificate|identity|english|birth/i.test(t)) o.docSections.push(t); });
  o.fileInputs = [...document.querySelectorAll("input[type=file]")].length;
  document.querySelectorAll("select").forEach((el) => { if (vis(el)) o.selects.push({ label: lf(el), sample: [...el.options].slice(0, 8).map((x) => txt(x.text)).filter(Boolean) }); });
  o.allButtons = [...new Set([...document.querySelectorAll("button,a.wc-button,a[role=button],input[type=submit],input[type=button]")].filter(vis).map((x) => txt(x.textContent) || x.value).filter(Boolean))].slice(0, 30);
  o.attachButtons = o.allButtons.filter((t) => /attach|add|upload|browse|choose/i.test(t));
  return o;
});
console.log("\n=== Attach documents (expandido) ===");
console.log(JSON.stringify(d, null, 1));
await pg.screenshot({ path: "artifacts/docs-inspect.png", fullPage: true }).catch(() => {});
console.log("\nheading final:", tt(await H()));
await b.close();
