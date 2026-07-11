// Reverte a pagina 3 do app pra dados BR reais (desfaz o teste com Argentina).
import { chromium } from "playwright";
const BR = { country: "BRAZIL", nationality: "BRAZIL", number: "GI914400", issue: "01 Mar 2024", expiry: "28 Feb 2034", place: "SR/PF/AM" };
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const heading = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (await n.isVisible().catch(() => false)) { await n.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(500); return true; } return false; };
async function setSel(label, val) { const s = pg.getByLabel(label, { exact: false }).first(); if (!(await s.count())) return; const opt = await s.evaluate((el, v) => { const V = v.toUpperCase(); const o = [...el.options].find((o) => o.text.trim().toUpperCase().startsWith(V)) || [...el.options].find((o) => o.text.trim().toUpperCase().includes(V)); return o ? o.text.trim() : null; }, val); if (opt) await s.selectOption({ label: opt }).catch(() => {}); }
async function setTxt(label, val) { const f = pg.getByLabel(label, { exact: false }).first(); if (await f.count()) await f.fill(val).catch(() => {}); }

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(900);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(800); }
for (let i = 0; i < 6; i++) { if (/passport details|primary applicant/i.test(await heading())) break; if (!(await clickNext())) break; }
console.log("pagina:", (await heading()).slice(0, 50));
await setSel("Country of passport", BR.country);
await setSel("Nationality of passport holder", BR.nationality);
await setTxt("Passport number", BR.number);
await setTxt("Date of issue", BR.issue);
await setTxt("Date of expiry", BR.expiry);
await setTxt("Place of issue", BR.place);
await pg.waitForTimeout(500);
// Save
const save = pg.locator('button:has-text("Save"), a:has-text("Save")').first();
if (await save.isVisible().catch(() => false)) { await save.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); }
await pg.waitForTimeout(800);
const chk = { number: await pg.getByLabel("Passport number", { exact: false }).first().inputValue().catch(() => "?"), country: await pg.getByLabel("Country of passport", { exact: false }).first().inputValue().catch(() => "?") };
console.log("RESTAURADO ->", JSON.stringify(chk), "(esperado GI914400 / BRA)");
await b.close();
