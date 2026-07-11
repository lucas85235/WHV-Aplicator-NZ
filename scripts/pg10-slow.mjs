// Explora a subpagina Education history campo-a-campo, dumpando entre cada acao,
// p/ achar exatamente o que causa "An error has occurred" no Confirm.
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode, selectDropdown, fillLabel, setDate, setRadioInGroup, clickButton } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(true); // NAO tocar pg3 (Argentina) na navegacao
const s = cfg.applicant.page10_education;
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 55);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); return true; };
const snap = async (tag) => {
  const d = await pg.evaluate(() => {
    const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
    const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : ""; };
    const fields = []; const groups = {};
    document.querySelectorAll("input,select,textarea").forEach((el) => { if (!vis(el)) return; const t = (el.getAttribute("type") || el.tagName).toLowerCase(); if (t === "radio") { const fs = el.closest("fieldset"); const lg = fs && fs.querySelector("legend"); const q = lg ? txt(lg.textContent).slice(0, 60) : el.name; (groups[q] = groups[q] || []).push(lf(el) + (el.checked ? "[x]" : "")); } else if (el.tagName === "SELECT") fields.push(lf(el) + "=[" + txt(el.options[el.selectedIndex]?.text || "") + "]"); else if (["text", "tel", "number", "textarea"].includes(t)) fields.push(lf(el) + "=" + el.value); });
    const err = [...document.querySelectorAll("h1,h2,h3")].some((h) => /error has occurred/i.test(h.textContent));
    return { fields, groups, err };
  });
  console.log(`  [${tag}] err=${d.err} | ${d.fields.join(" | ").slice(0, 260)}`);
  if (Object.keys(d.groups).length) console.log(`        groups: ${JSON.stringify(d.groups)}`);
};

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 14; i++) { const h = await H(); if (/education/i.test(tt(h))) break; const m = PAGE_MATCHERS.find((x) => x.re.test(h)); if (m && m.page.id !== "page10_education") { try { await m.page.handle({ page: pg, cfg }); } catch {} } await pg.waitForTimeout(200); if (!(await clickNext())) break; }
console.log("em:", tt(await H()));
await setRadioInGroup(pg, "meet the education requirements", "Yes").catch(() => {});
await pg.waitForTimeout(1300);
const hasRow = await pg.evaluate(() => { const tb = [...document.querySelectorAll("table")].find((x) => /qualification/i.test(x.textContent || "")); return tb ? [...tb.querySelectorAll("tbody tr")].some((tr) => tr.querySelectorAll("td").length > 1 && (tr.textContent || "").trim().length > 8) : false; });
console.log("hasRow:", hasRow);
if (hasRow) { console.log("ja tem linha -> nada a testar"); await b.close(); process.exit(0); }
await clickButton(pg, "Add"); await pg.waitForTimeout(1300);
console.log("subpage:", tt(await H()));
await snap("0-inicial");
await selectDropdown(pg, "Qualification", s.qualification).catch((e) => console.log("  qual ERR", e.message.slice(0, 40)));
await pg.waitForTimeout(2000); await snap("1-apos-qualification");
await fillLabel(pg, "Course name", s.courseName).catch(() => {});
await fillLabel(pg, "Institution name", s.institutionName).catch(() => {});
await pg.waitForTimeout(600); await snap("2-apos-textos");
await selectDropdown(pg, "Country of institution", s.institutionCountry).catch((e) => console.log("  ctry ERR", e.message.slice(0, 40)));
await pg.waitForTimeout(2000); await snap("3-apos-country");
await setDate(pg, "Date from", s.startDate).catch(() => {});
await setDate(pg, "Date to", s.endDate).catch(() => {});
await pg.waitForTimeout(800); await snap("4-apos-datas");
await selectDropdown(pg, "Status", s.status).catch((e) => console.log("  stat ERR", e.message.slice(0, 40)));
await pg.waitForTimeout(2000); await snap("5-apos-status");
await pg.screenshot({ path: "artifacts/pg10-slow-preconfirm.png", fullPage: true }).catch(() => {});
await clickButton(pg, "Confirm").catch((e) => console.log("  confirm ERR", e.message.slice(0, 40)));
await pg.waitForTimeout(1500); await snap("6-apos-confirm");
console.log("heading final:", tt(await H()));
await pg.screenshot({ path: "artifacts/pg10-slow-postconfirm.png", fullPage: true }).catch(() => {});
await b.close();
