// pg12 English: passport=No -> functional=Yes -> dumpa a secao de PROVA revelada.
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(true);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 55);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); return true; };
const setRadioByVal = (val) => pg.evaluate((v) => { const first = [...document.querySelectorAll('input[type=radio]')].filter((x) => x.offsetParent); const groups = {}; first.forEach((r) => (groups[r.name] = groups[r.name] || []).push(r)); return Object.values(groups); }, val);
const clickGroupOption = (groupIdx, optVal) => pg.evaluate(({ gi, ov }) => {
  const first = [...document.querySelectorAll('input[type=radio]')].filter((x) => x.offsetParent);
  const order = []; const seen = {}; first.forEach((r) => { if (!seen[r.name]) { seen[r.name] = 1; order.push(r.name); } });
  const name = order[gi]; const grp = first.filter((r) => r.name === name);
  const t = grp.find((r) => r.value === ov) || grp.find((r) => { let l = ""; if (r.id) { const e = document.querySelector('label[for="' + CSS.escape(r.id) + '"]'); if (e) l = e.textContent; } return (l || "").trim().toLowerCase() === (ov === "1" ? "yes" : "no"); });
  if (t) { if (!t.checked) t.click(); return "clicou grupo " + gi + " -> " + t.value; }
  return "grupo " + gi + " opt " + ov + " nao achado";
}, { gi: groupIdx, ov: optVal });
const full = () => pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : ""; };
  const qOf = (r) => { const fs = r.closest("fieldset"); const lg = fs && fs.querySelector("legend"); return lg ? txt(lg.textContent).slice(0, 90) : ""; };
  const groups = {}; const selects = []; const inputs = []; const checks = [];
  document.querySelectorAll("input,select,textarea").forEach((el) => {
    if (!vis(el)) return; const t = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (t === "radio") { const q = qOf(el) || el.name; (groups[q] = groups[q] || []).push(lf(el).slice(0, 55) + (el.checked ? "[x]" : "")); }
    else if (t === "checkbox") checks.push(lf(el).slice(0, 70) + (el.checked ? "[x]" : ""));
    else if (el.tagName === "SELECT") selects.push({ label: lf(el), n: el.options.length });
    else inputs.push({ label: lf(el), type: t });
  });
  return { groups, selects, inputs, checks };
});

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
if (await pg.locator("input[type=password]").first().isVisible().catch(() => false)) { console.log("NEED_LOGIN"); await b.close(); process.exit(0); }
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 16; i++) { const h = await H(); if (/language|english/i.test(tt(h))) break; const m = PAGE_MATCHERS.find((x) => x.re.test(h)); if (m && !/english/i.test(m.page.title)) { try { await m.page.handle({ page: pg, cfg }); } catch {} } await pg.waitForTimeout(200); if (!(await clickNext())) break; }
console.log("em:", tt(await H()));
console.log("g0 passport No:", await clickGroupOption(0, "2")); await pg.waitForTimeout(1500);
console.log("g1 functional Yes:", await clickGroupOption(1, "1")); await pg.waitForTimeout(1800);
console.log("\n[revelado apos functional=Yes]:");
console.log(JSON.stringify(await full(), null, 1));
await pg.screenshot({ path: "artifacts/pg12-deep.png", fullPage: true }).catch(() => {});
await b.close();
