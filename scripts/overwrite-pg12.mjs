// Chrome esta na pag 12 (Argentina). Sobrescreve a caixa "Give details" com o
// proofOtherText NOVO (o antigo esta salvo e fillOnlyEmpty pularia no dia). Salva via Next.
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
const cfg = await loadConfig();
const TXT = cfg.applicant.page12_english.proofOtherText || "";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
if (!/language|english/i.test((await H()).replace(/Online Lodgement.*visa \|?/i, ""))) { console.log("nao esta na pag 12:", (await H()).slice(0, 50)); await b.close(); process.exit(0); }
const ta = pg.locator("textarea").filter({ visible: true }).first();
if (!(await ta.count())) { console.log("textarea nao achada"); await b.close(); process.exit(0); }
await ta.fill(TXT);
await pg.waitForTimeout(500);
const len = await ta.inputValue().then((v) => v.length).catch(() => -1);
console.log("texto novo aplicado, len:", len, "(esperado", TXT.length + ")");
// salva avancando
const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first();
if (await n.isVisible().catch(() => false)) { await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1200); }
console.log("apos Next:", (await H()).replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 50));
await b.close();
