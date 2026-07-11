// Navega ate a pag 12 (gate ja aberto por Argentina) e le o maxlength da caixa
// "Give details" (textarea do "Other" do ingles). READ-ONLY.
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(true);
const PROOF = cfg.applicant.page12_english.proofOtherText || "";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 55);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); return true; };

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
if (await pg.locator("input[type=password]").first().isVisible().catch(() => false)) { console.log("NEED_LOGIN"); await b.close(); process.exit(0); }
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 16; i++) { const h = await H(); if (/language|english/i.test(tt(h))) break; const m = PAGE_MATCHERS.find((x) => x.re.test(h)); if (m && !/english/i.test(m.page.title)) { try { await m.page.handle({ page: pg, cfg }); } catch {} } await pg.waitForTimeout(200); if (!(await clickNext())) break; }
console.log("em:", tt(await H()));
if (!/language|english/i.test(tt(await H()))) { console.log("nao cheguei na pag 12 (gate fechado? rode set-foreign antes)"); await b.close(); process.exit(0); }

// le a textarea "Give details" (revelada pelo Other). Se nao visivel, dumpa todas as textareas.
const info = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } return el.getAttribute("aria-label") || ""; };
  return [...document.querySelectorAll("textarea")].map((t) => ({ label: lf(t), visible: vis(t), maxLength: t.maxLength, curLen: (t.value || "").length }));
});
console.log("\ntextareas na pag 12:");
info.forEach((t) => console.log("  ", JSON.stringify(t)));
console.log("\ntamanho do proofOtherText no config:", PROOF.length, "caracteres");
const give = info.find((t) => /give details|other/i.test(t.label)) || info.find((t) => t.visible);
if (give) {
  const max = give.maxLength;
  if (max === -1 || max === 524288 || max == null) console.log(`>> caixa SEM limite pratico (maxLength=${max}) -> texto de ${PROOF.length} CABE.`);
  else console.log(`>> maxLength=${max} | texto=${PROOF.length} -> ${PROOF.length <= max ? "CABE ✓" : "NAO CABE (corta " + (PROOF.length - max) + ")"}`);
}
await b.close();
