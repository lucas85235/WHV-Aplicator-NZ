// Estado atual: pg12 com passport=No, functional=Yes. Marca "Other", acha textbox,
// preenche, seleciona Main language, e testa Next.
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { checkByLabel, fillFirstEmptyText, selectDropdown } from "../dist/src/locators.js";
const cfg = await loadConfig();
const s = cfg.applicant.page12_english;
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 60);
const err = async () => (await H()).match(/error has occurred/i) ? "ERRO" : "ok";
console.log("em:", tt(await H()));
await checkByLabel(pg, "Other").catch((e) => console.log("Other:", e.message.slice(0, 40)));
await pg.waitForTimeout(1400);
// dump: o que apareceu (textbox?)
const d = await pg.evaluate(() => { const vis = (el) => !!(el.offsetParent || el.getClientRects().length); const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return (l.textContent || "").replace(/\s+/g, " ").trim(); } return ""; }; return [...document.querySelectorAll("input[type=text],textarea")].filter(vis).map((el) => ({ label: lf(el), val: el.value })); });
console.log("campos texto visiveis:", JSON.stringify(d));
await fillFirstEmptyText(pg, s.proofOtherText).catch((e) => console.log("fillText:", e.message.slice(0, 40)));
await pg.waitForTimeout(500);
await selectDropdown(pg, "Main language", s.firstLanguage).catch((e) => console.log("mainlang:", e.message.slice(0, 40)));
await pg.waitForTimeout(1500);
console.log("pre-Next err:", await err());
const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first();
if (await n.isVisible().catch(() => false)) { await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1500); }
console.log("apos Next:", tt(await H()), "| err:", await err());
await pg.screenshot({ path: "artifacts/pg12-try.png", fullPage: true }).catch(() => {});
await b.close();
