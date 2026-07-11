// Valida ensureDocumentsAttached na pagina real "Attach documents". Sobe os 4 docs
// disponiveis nos slots certos e VERIFICA (nome do arquivo + tipo por slot). PARA
// aqui: nao clica Next, nao vai pro pagamento, nao submete.
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode } from "../dist/src/locators.js";
import { ensureDocumentsAttached } from "../dist/src/documents.js";

const cfg = await loadConfig();
setFillMode(true);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 70);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1000); return true; };

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
if (await pg.locator("input[type=password]").first().isVisible().catch(() => false)) { console.log("NEED_LOGIN"); await b.close(); process.exit(0); }
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 20; i++) { const h = await H(); if (/attach documents/i.test(h)) break; if (/review page/i.test(h)) { await clickNext(); continue; } const m = PAGE_MATCHERS.find((x) => x.re.test(h)); if (m) { try { await m.page.handle({ page: pg, cfg }); } catch {} } await pg.waitForTimeout(200); if (!(await clickNext())) break; }
console.log("em:", tt(await H()));
if (!/attach documents/i.test(await H())) { console.log("nao cheguei em Attach documents -> abortando (sem risco)"); await b.close(); process.exit(0); }

await ensureDocumentsAttached(pg, cfg);
await pg.waitForTimeout(1000);

// verifica: por slot, tipo selecionado + arquivo anexado (nome aparece na linha)
const state = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const sels = [...document.querySelectorAll("select")].filter((s) => /document type/i.test((s.getAttribute("aria-label") || "") + (s.labels?.[0]?.textContent || "")) || [...s.options].some((o) => /passport|photograph|bank statement/i.test(o.text)));
  const types = sels.map((s) => txt(s.options[s.selectedIndex]?.text || ""));
  // nomes de arquivo anexados (aparecem como texto/links apos upload)
  const names = [...document.querySelectorAll("a,span,td")].map((e) => txt(e.textContent)).filter((t) => /\.(jpg|jpeg|png|pdf)$/i.test(t)).slice(0, 10);
  const errs = [...new Set([...document.querySelectorAll('.error,.field-error,[role=alert],.validation-message,.error-message,span.error')].filter(vis).map((e) => txt(e.textContent)).filter((t) => t && t.length < 120))].slice(0, 8);
  const anyErrHeading = [...document.querySelectorAll("h1,h2,h3")].some((h) => /error has occurred/i.test(h.textContent));
  return { types, names, errs, anyErrHeading };
});
console.log("\ntipos por slot:", JSON.stringify(state.types));
console.log("arquivos anexados:", JSON.stringify(state.names));
console.log("erros:", JSON.stringify(state.errs), "| errHeading:", state.anyErrHeading);
await pg.screenshot({ path: "artifacts/docs-attach.png", fullPage: true }).catch(() => {});
console.log("\n>> PARADO em Attach documents. NAO cliquei Next, NAO fui pro pagamento.");
await b.close();
