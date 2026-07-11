// deep.mjs "<targetHeadingRegex>" "<revealOptionLabel?>"
// Navega limpo ate a pagina alvo (handlers reais fillMode true no caminho, pulando
// o alvo), dumpa a estrutura COMPLETA. Se revealOptionLabel dado, clica essa opcao
// no 1o grupo de radio, espera o postback e re-dumpa (p/ ver campos revelados).
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode } from "../dist/src/locators.js";

const TARGET = new RegExp(process.argv[2] || "education", "i");
const REVEAL = process.argv[3] || "";
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
  const qOf = (r) => { const fs = r.closest("fieldset"); const lg = fs && fs.querySelector("legend"); return lg ? txt(lg.textContent).slice(0, 100) : ""; };
  const groups = {}; const selects = []; const inputs = []; const checks = [];
  document.querySelectorAll("input,select,textarea").forEach((el) => {
    if (!vis(el)) return; const t = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (t === "radio") { const q = qOf(el) || el.name; (groups[q] = groups[q] || []).push(labelFor(el).slice(0, 45) + (el.checked ? "[x]" : "")); }
    else if (t === "checkbox") checks.push(labelFor(el).slice(0, 70) + (el.checked ? "[x]" : ""));
    else if (el.tagName === "SELECT") selects.push({ label: labelFor(el), val: txt(el.options[el.selectedIndex]?.text || ""), n: el.options.length, sample: [...el.options].slice(0, 8).map((x) => txt(x.text)).filter(Boolean) });
    else inputs.push({ label: labelFor(el), val: el.value.slice(0, 30), type: t });
  });
  const errs = [...new Set([...document.querySelectorAll('.error,.field-error,[role=alert],.validation-message,.invalid-feedback,.error-message,span.error,li.error')].filter(vis).map((e) => txt(e.textContent)).filter((t) => t && t.length < 140))].slice(0, 10);
  return { groups, selects, inputs, checks, errs };
});

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 16; i++) {
  const h = await H();
  if (TARGET.test(h.replace(/Online Lodgement.*visa \|?/i, ""))) break;
  const m = PAGE_MATCHERS.find((x) => x.re.test(h));
  if (m && !TARGET.test(m.page.title)) { try { await m.page.handle({ page: pg, cfg }); } catch {} }
  await pg.waitForTimeout(200);
  if (!(await clickNext())) break;
}
console.log("ALVO:", (await H()).replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 70), "\n");
console.log("[A] estrutura inicial:");
console.log(JSON.stringify(await full(), null, 1));

if (REVEAL) {
  const r = await pg.evaluate((rev) => {
    const n = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const map = { yes: "1", no: "2" };
    const first = [...document.querySelectorAll('input[type=radio]')].filter((x) => x.offsetParent);
    const name0 = first[0]?.name;
    const grp = first.filter((x) => x.name === name0);
    const target = grp.find((x) => n(x.value) === n(rev) || x.value === map[n(rev)]) || grp.find((x) => { let l = ""; if (x.id) { const e = document.querySelector('label[for="' + CSS.escape(x.id) + '"]'); if (e) l = e.textContent; } return n(l) === n(rev); });
    if (target) { if (!target.checked) target.click(); return "clicou val=" + target.value; }
    return "nao achou opcao " + rev + " (vals: " + grp.map((x) => x.value).join(",") + ")";
  }, REVEAL);
  console.log("\nreveal:", r);
  await pg.waitForTimeout(1800);
  console.log("\n[B] apos revelar (" + REVEAL + "):");
  console.log(JSON.stringify(await full(), null, 1));
}
await pg.screenshot({ path: "artifacts/deep.png", fullPage: true }).catch(() => {});
await b.close();
