// Reseta a prova de ingles: desmarca "Other" (some a caixa), remarca (caixa NOVA
// vazia), preenche o texto novo, Next. Recria o cenario que funcionou (caixa fresca).
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
const cfg = await loadConfig();
const TXT = cfg.applicant.page12_english.proofOtherText || "";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 55);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1200); return true; };

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 16; i++) { const h = await H(); if (/language|english/i.test(tt(h))) break; if (!(await clickNext())) break; }
console.log("em:", tt(await H()));

// desmarca Other -> some caixa -> remarca -> caixa nova
const other = pg.getByRole("checkbox", { name: /^other$/i }).first();
if (await other.count()) {
  await other.uncheck().catch(() => {}); await pg.waitForTimeout(1500);
  await other.check().catch(() => {}); await pg.waitForTimeout(1500);
  console.log("Other re-marcado");
}
const ta = pg.locator("textarea").filter({ visible: true }).first();
const preLen = await ta.inputValue().then((v) => v.length).catch(() => -1);
console.log("box len apos reset (esperado 0):", preLen);
await ta.fill(TXT).catch(() => {});
await pg.waitForTimeout(400);
await ta.blur().catch(() => {});
await pg.waitForTimeout(1500);
console.log("box len apos fill:", await ta.inputValue().then((v) => v.length).catch(() => -1));
await clickNext();
await pg.waitForTimeout(800);
const h2 = await H();
console.log("apos Next:", tt(h2), "| ERRO:", /error has occurred/i.test(h2));
await pg.screenshot({ path: "artifacts/pg12-reset.png", fullPage: true }).catch(() => {});
await b.close();
