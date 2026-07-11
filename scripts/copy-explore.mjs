// Cria uma COPIA da app do usuario, troca o pais na copia para um com vaga
// aberta, passa o gate e dumpa as paginas 6-17. Depois DELETA a copia.
// A app original NAO e alterada. Rode: npx tsx scripts/copy-explore.mjs [PAIS]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const ORIGINAL_TRN = "EGPD8SJMRL";
const COUNTRY = (process.argv[2] || "ARGENTINA").toUpperCase();
const PASSPORT_NO = "AAB123456"; // formato plausivel p/ passar validacao
mkdirSync("artifacts/dom6", { recursive: true });

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
pg.on("dialog", (d) => d.accept().catch(() => {})); // aceita confirm() nativos

const log = (...a) => console.log(...a);
const heading = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
async function toSummary() {
  await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
  await pg.waitForTimeout(800);
}
async function trns() {
  return pg.evaluate(() => [...document.body.innerText.matchAll(/\b([A-Z0-9]{10})\b/g)].map((m) => m[1]));
}

// 1) COPIA
await toSummary();
const before = new Set(await trns());
log("TRNs antes:", [...before]);
const copyLink = pg.locator('a:has-text("Copy"), button:has-text("Copy")').first();
if (!(await copyLink.isVisible().catch(() => false))) { log("botao Copy nao achado"); await b.close(); process.exit(1); }
await copyLink.click();
await pg.waitForTimeout(1500);
await toSummary();
const after = await trns();
const copyTRN = after.find((t) => !before.has(t) && t !== ORIGINAL_TRN);
log("TRNs depois:", after, "-> COPIA:", copyTRN);
if (!copyTRN) { log("copia nao criada; abortando"); await b.close(); process.exit(1); }

// 2) abrir a COPIA (Edit na linha da copia)
const row = pg.locator("tr, .actionable, div").filter({ hasText: copyTRN }).first();
const editInRow = row.locator('button:has-text("Edit"), a:has-text("Edit")').first();
await (await editInRow.isVisible().catch(() => false) ? editInRow : pg.locator('button:has-text("Edit"), a:has-text("Edit")').last()).click();
await pg.waitForLoadState("domcontentloaded").catch(() => {});
await pg.waitForTimeout(1000);

// 3) navegar ate Passport / Applicant
async function next() { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (await n.isVisible().catch(() => false)) { await n.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(500); return true; } return false; }
for (let i = 0; i < 6; i++) { const h = await heading(); if (/passport details|primary applicant/i.test(h)) break; await next(); }
log("na pagina:", (await heading()).slice(0, 60));

// 4) trocar pais + nacionalidade + passaporte na COPIA
async function setSelect(label, val) {
  const sel = pg.getByLabel(label, { exact: false }).first();
  if (!(await sel.count())) return log("select nao achado:", label);
  await sel.evaluate((el, v) => {
    const s = el; const V = v.toUpperCase();
    const o = [...s.options].find((o) => o.text.trim().toUpperCase().startsWith(V)) || [...s.options].find((o) => o.text.trim().toUpperCase().includes(V));
    if (o) { s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); }
  }, val);
}
await setSelect("Country of passport", COUNTRY);
await setSelect("Nationality of passport holder", COUNTRY);
const pnum = pg.getByLabel("Passport number", { exact: false }).first();
if (await pnum.count()) await pnum.fill(PASSPORT_NO);
await pg.waitForTimeout(500);
log(`setado pais=${COUNTRY}, passaporte=${PASSPORT_NO}`);

// 5) avancar ate confirmacao e tentar o gate
for (let i = 0; i < 4; i++) { const h = await heading(); if (/critical data confirmation/i.test(h)) break; await next(); }
// marcar "Is the above information correct?" = Yes
await pg.evaluate(() => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const radios = [...document.querySelectorAll('input[type=radio]')].filter((r) => r.offsetParent);
  for (const r of radios) { let l = ""; if (r.id) { const lab = document.querySelector('label[for="' + CSS.escape(r.id) + '"]'); if (lab) l = lab.textContent; } if (norm(l) === "yes") { const fs = r.closest("fieldset"); const lg = fs && fs.querySelector("legend"); if (lg && norm(lg.textContent).includes("is the above information correct")) { r.click(); return; } } }
});
await next();
await pg.waitForTimeout(800);
const gateTxt = await pg.getByText(/lodgement is currently closed|not be able to continue|annual visa quota/i).first().isVisible().catch(() => false);
log(`\n>>> GATE para ${COUNTRY}: ${gateTxt ? "FECHADO (sem vaga)" : "ABERTO! passou"}`);

// 6) se abriu, walk 6-17 dumpando
if (!gateTxt) {
  const dump = () => {
    const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
    const labelOf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : ""; };
    const qOf = (r) => { const fs = r.closest("fieldset"); if (fs) { const lg = fs.querySelector("legend"); if (lg && txt(lg.textContent)) return txt(lg.textContent).slice(0, 160); } return ""; };
    const o = { url: location.href, headings: [], inputs: [], radios: [], selects: [] };
    document.querySelectorAll("h2,h3,legend").forEach((h) => { const t = txt(h.textContent); if (t) o.headings.push(t); });
    document.querySelectorAll("input,select,textarea").forEach((el) => { if (!vis(el)) return; const type = (el.getAttribute("type") || el.tagName).toLowerCase(); if (el.tagName === "SELECT") o.selects.push({ label: labelOf(el), options: [...el.options].map((x) => txt(x.text)).filter(Boolean).slice(0, 12) }); else if (type === "radio") { const q = qOf(el); if (q) o.radios.push({ q, label: labelOf(el) }); } else if (type !== "hidden") o.inputs.push({ type, label: labelOf(el) }); });
    return o;
  };
  for (let step = 6; step <= 20; step++) {
    await pg.waitForTimeout(400);
    const d = await pg.evaluate(dump);
    writeFileSync(`artifacts/dom6/page${step}.json`, JSON.stringify(d, null, 2));
    await pg.screenshot({ path: `artifacts/dom6/page${step}.png`, fullPage: true }).catch(() => {});
    log(`\n=== PAGE ${step} :: ${d.headings.slice(0, 3).join(" | ")} ===`);
    if (d.inputs.length) log("  inputs:", d.inputs.map((x) => x.label).filter(Boolean).join(" ; "));
    if (d.selects.length) log("  selects:", d.selects.map((x) => `${x.label}=[${x.options.slice(0, 4).join("/")}]`).join(" ; "));
    const rq = [...new Set(d.radios.map((r) => r.q))];
    if (rq.length) log("  radioQs:", rq.map((q) => q.slice(0, 70)).join(" ;; "));
    if (/submit|payment|provide documents|attach/i.test(d.headings.join(" "))) { log(">> chegou em docs/submit. Parando walk."); break; }
    if (!(await next())) break;
  }
}

// 7) DELETAR a copia
await toSummary();
const delRow = pg.locator("tr, div").filter({ hasText: copyTRN }).first();
const delLink = delRow.locator('a:has-text("Delete"), button:has-text("Delete")').first();
if (await delLink.isVisible().catch(() => false)) { await delLink.click(); await pg.waitForTimeout(1500); log("\ncopia DELETADA:", copyTRN); }
else log("\n!! nao consegui deletar a copia automaticamente:", copyTRN, "- delete manual");
await toSummary();
log("TRNs finais:", await trns());
await b.close();
