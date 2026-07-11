import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const heading = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(900);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(800); }
for (let i = 0; i < 6; i++) { if (/application context/i.test(await heading())) break; const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) break; await n.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(500); }
const arr = await pg.getByLabel("Proposed arrival date", { exact: false }).first().inputValue().catch(() => "?");
console.log("heading:", (await heading()).slice(0, 50));
console.log("Proposed arrival date AGORA:", arr, "(config=19 Dec 2026, antes=01 Nov 2026)");
await b.close();
