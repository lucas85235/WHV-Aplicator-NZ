// Navega limpo ate pg8 e inspeciona a fundo: seleciona No, espera reveal, dumpa
// TODOS os campos revelados, preenche o que precisar, e testa o Next.
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(true);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1000); return true; };
const full = () => pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const labelFor = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : (el.getAttribute("aria-label") || ""); };
  const req = (el) => el.required || el.getAttribute("aria-required") === "true";
  const out = { radios: [], selects: [], inputs: [], errs: [] };
  document.querySelectorAll("input,select,textarea").forEach((el) => {
    if (!vis(el)) return; const t = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (t === "radio" || t === "checkbox") out.radios.push({ label: labelFor(el).slice(0, 40), checked: el.checked, req: req(el) });
    else if (el.tagName === "SELECT") out.selects.push({ label: labelFor(el), val: txt(el.options[el.selectedIndex]?.text || ""), req: req(el) });
    else out.inputs.push({ label: labelFor(el), val: el.value, req: req(el) });
  });
  out.errs = [...new Set([...document.querySelectorAll('.error,.field-error,[role=alert],.validation-message,.invalid-feedback,.error-message,span.error,li.error')].filter(vis).map((e) => txt(e.textContent)).filter((t) => t && t.length < 140))].slice(0, 10);
  return out;
});

// nav limpo -> pg8
await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 12; i++) {
  const h = await H();
  if (/authorised recipient/i.test(h)) break;
  const m = PAGE_MATCHERS.find((x) => x.re.test(h));
  if (m && m.page.id !== "page08_correspondence") { try { await m.page.handle({ page: pg, cfg }); } catch {} }
  await pg.waitForTimeout(200);
  if (!(await clickNext())) break;
}
console.log("cheguei em:", (await H()).replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 60));

console.log("\n[A] pg8 ANTES de responder:");
console.log(JSON.stringify(await full(), null, 1));

// seleciona No, espera reveal/postback
await pg.evaluate(() => { const r = [...document.querySelectorAll('input[type=radio]')].find((x) => x.value === "NO" && x.offsetParent); if (r && !r.checked) r.click(); });
await pg.waitForTimeout(1800);
console.log("\n[B] pg8 DEPOIS de No (reveal):");
const afterNo = await full();
console.log(JSON.stringify(afterNo, null, 1));

// preenche inputs vazios revelados (email etc) com dados plausiveis
const email = cfg.applicant?.page07_contact?.email || "lucas85235@gmail.com";
for (const inp of afterNo.inputs) {
  if (!inp.val && /email/i.test(inp.label)) {
    const loc = pg.getByLabel(inp.label, { exact: false }).filter({ visible: true }).first();
    if (await loc.count()) { await loc.fill(email).catch(() => {}); console.log("preenchi:", inp.label, "=", email); }
  }
}
await pg.waitForTimeout(600);
console.log("\n[C] pg8 pos-fill:");
console.log(JSON.stringify(await full(), null, 1));

// testa Next
await clickNext();
await pg.waitForTimeout(600);
const h2 = await H();
console.log("\n[D] apos Next:", h2.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 70));
console.log("   errs:", JSON.stringify((await full()).errs));
await pg.screenshot({ path: "artifacts/pg8-deep.png", fullPage: true }).catch(() => {});
await b.close();
