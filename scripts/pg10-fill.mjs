// Testa a pg10 com esperas GENEROSAS entre campos e antes do Confirm, p/ ver se o
// "An error has occurred" e so timing dos widgets custom (postback AJAX).
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode, selectDropdown, fillLabel, setDate, setRadioInGroup, clickButton } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(false);
const s = cfg.applicant.page10_education;
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const t = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 60);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1000); return true; };
const errNow = async () => (await H()).match(/error has occurred/i) ? "ERRO" : "ok";

// nav -> Education
await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 14; i++) { const h = await H(); if (/education/i.test(t(h))) break; const m = PAGE_MATCHERS.find((x) => x.re.test(h)); if (m && m.page.id !== "page10_education") { try { await m.page.handle({ page: pg, cfg }); } catch {} } await pg.waitForTimeout(200); if (!(await clickNext())) break; }
console.log("em:", t(await H()));

await setRadioInGroup(pg, "meet the education requirements", "Yes").catch((e) => console.log("radio:", e.message.slice(0, 50)));
await pg.waitForTimeout(1500);
// se ja tem linha, remove pra testar limpo? Nao -> so Add se vazio
const hasRow = await pg.evaluate(() => { const tb = [...document.querySelectorAll("table")].find((x) => /qualification/i.test(x.textContent || "")); return tb ? [...tb.querySelectorAll("tbody tr")].some((tr) => tr.querySelectorAll("td").length > 1 && (tr.textContent || "").trim().length > 8) : false; });
console.log("hasRow:", hasRow);
if (!hasRow) {
  await clickButton(pg, "Add"); await pg.waitForTimeout(1300);
  console.log("subpage:", t(await H()), "| err:", await errNow());
  await selectDropdown(pg, "Qualification", s.qualification).catch((e) => console.log("qual:", e.message.slice(0, 40))); await pg.waitForTimeout(600);
  await fillLabel(pg, "Course name", s.courseName).catch(() => {}); await pg.waitForTimeout(500);
  await fillLabel(pg, "Institution name", s.institutionName).catch(() => {}); await pg.waitForTimeout(500);
  await selectDropdown(pg, "Country of institution", s.institutionCountry).catch((e) => console.log("ctry:", e.message.slice(0, 40))); await pg.waitForTimeout(600);
  await setDate(pg, "Date from", s.startDate).catch(() => {}); await pg.waitForTimeout(600);
  await setDate(pg, "Date to", s.endDate).catch(() => {}); await pg.waitForTimeout(600);
  await selectDropdown(pg, "Status", s.status).catch((e) => console.log("stat:", e.message.slice(0, 40))); await pg.waitForTimeout(600);
  console.log("preenchido | err antes do Confirm:", await errNow());
  await pg.waitForTimeout(1500);
  await clickButton(pg, "Confirm").catch((e) => console.log("confirm:", e.message.slice(0, 40)));
  await pg.waitForTimeout(1500);
  console.log("apos Confirm:", t(await H()), "| err:", await errNow());
}
await pg.screenshot({ path: "artifacts/pg10-fill.png", fullPage: true }).catch(() => {});
await b.close();
