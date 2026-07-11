// Testa Confirm com datas tratadas via teclado + Tab(blur) + Escape (fecha datepicker).
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode, selectDropdown, fillLabel, setRadioInGroup, clickButton } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(true);
const s = cfg.applicant.page10_education;
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 55);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); return true; };
const err = async () => (await H()).match(/error has occurred/i) ? "ERRO" : "ok";

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 14; i++) { const h = await H(); if (/education/i.test(tt(h))) break; const m = PAGE_MATCHERS.find((x) => x.re.test(h)); if (m && m.page.id !== "page10_education") { try { await m.page.handle({ page: pg, cfg }); } catch {} } await pg.waitForTimeout(200); if (!(await clickNext())) break; }
await setRadioInGroup(pg, "meet the education requirements", "Yes").catch(() => {});
await pg.waitForTimeout(1300);
const hasRow = await pg.evaluate(() => { const tb = [...document.querySelectorAll("table")].find((x) => /qualification/i.test(x.textContent || "")); return tb ? [...tb.querySelectorAll("tbody tr")].some((tr) => tr.querySelectorAll("td").length > 1 && (tr.textContent || "").trim().length > 8) : false; });
if (hasRow) { console.log("ja tem linha -> pulando"); await b.close(); process.exit(0); }
await clickButton(pg, "Add"); await pg.waitForTimeout(1300);
console.log("subpage:", tt(await H()));

await selectDropdown(pg, "Qualification", s.qualification).catch(() => {}); await pg.waitForTimeout(700);
await fillLabel(pg, "Course name", s.courseName).catch(() => {});
await fillLabel(pg, "Institution name", s.institutionName).catch(() => {});
await selectDropdown(pg, "Country of institution", s.institutionCountry).catch(() => {}); await pg.waitForTimeout(700);
// datas: click + type + Tab + Escape
async function typeDate(label, val) {
  const f = pg.getByLabel(label, { exact: false }).filter({ visible: true }).first();
  if (!(await f.count())) return console.log("  date field nao achado:", label);
  await f.click().catch(() => {});
  await f.fill("").catch(() => {});
  await f.type(val, { delay: 20 }).catch(() => {});
  await pg.keyboard.press("Escape").catch(() => {}); // fecha datepicker
  await pg.keyboard.press("Tab").catch(() => {}); // blur -> commit
  await pg.waitForTimeout(500);
}
await typeDate("Date from", s.startDate);
await typeDate("Date to", s.endDate);
await selectDropdown(pg, "Status", s.status).catch(() => {}); await pg.waitForTimeout(700);
// clica fora p/ garantir blur
await pg.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
await pg.waitForTimeout(1200);
console.log("pre-confirm err:", await err());
await clickButton(pg, "Confirm").catch((e) => console.log("confirm click ERR", e.message.slice(0, 40)));
await pg.waitForTimeout(1800);
console.log("apos Confirm:", tt(await H()), "| err:", await err());
// se voltou pra Education, checa a linha
const rowText = await pg.evaluate(() => { const tb = [...document.querySelectorAll("table")].find((x) => /qualification/i.test(x.textContent || "")); const tr = tb && [...tb.querySelectorAll("tbody tr")].find((r) => r.querySelectorAll("td").length > 1); return tr ? tr.textContent.replace(/\s+/g, " ").trim().slice(0, 120) : "(sem linha)"; });
console.log("linha na tabela:", rowText);
await pg.screenshot({ path: "artifacts/pg10-try.png", fullPage: true }).catch(() => {});
await b.close();
