// Inspeciona Review -> Documents (ultimo modulo nao calibrado). PARA ANTES de
// qualquer submit/payment/charge. NUNCA clica Submit now / Pay. So leitura + 1 Next.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 75);
const STOP = /submit now|application charge|payment|pay for|proceed to pay|ready to submit|declaration of|charge/i;
const dump = () => pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : (el.getAttribute("aria-label") || ""); };
  const o = { selects: [], inputs: [], checks: [], files: 0, buttons: [], tableRows: [] };
  document.querySelectorAll("input,select,textarea").forEach((el) => { if (!vis(el)) return; const t = (el.getAttribute("type") || el.tagName).toLowerCase(); if (t === "file") o.files++; else if (el.tagName === "SELECT") o.selects.push({ label: lf(el), sample: [...el.options].slice(0, 6).map((x) => txt(x.text)).filter(Boolean) }); else if (t === "checkbox") o.checks.push(lf(el).slice(0, 80) + (el.checked ? "[x]" : "")); else if (["text", "textarea", "tel", "email"].includes(t)) o.inputs.push({ label: lf(el), val: el.value.slice(0, 20) }); });
  o.buttons = [...new Set([...document.querySelectorAll("button,a.wc-button,a[role=button],input[type=submit],input[type=button]")].filter(vis).map((x) => txt(x.textContent) || x.value).filter(Boolean))].slice(0, 20);
  // linhas de tabela de documentos (se houver)
  const dt = [...document.querySelectorAll("table")].find((t) => /document|attach|type/i.test(t.textContent || ""));
  if (dt) o.tableRows = [...dt.querySelectorAll("tr")].map((tr) => txt(tr.textContent).slice(0, 90)).filter(Boolean).slice(0, 12);
  return o;
});
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1000); return true; };

for (let i = 0; i < 4; i++) {
  const h = await H();
  console.log(`\n=== [${i}] ${tt(h)} ===`);
  if (STOP.test(h)) { console.log(">> SUBMIT/PAYMENT detectado -> PARO AQUI (nao avanco, nao pago)."); break; }
  console.log(JSON.stringify(await dump(), null, 1));
  await pg.screenshot({ path: `artifacts/tail-${i}.png`, fullPage: true }).catch(() => {});
  // so avanca se a PROXIMA nao for submit (checa apos)? nao da p/ saber sem clicar.
  // Regra segura: so avanca de Review/Documents/Attach; nunca de paginas desconhecidas.
  if (!/review|check your answers|document|attach|provide/i.test(h)) { console.log(">> pagina nao e review/docs -> paro por seguranca."); break; }
  if (!(await clickNext())) { console.log(">> sem Next -> fim."); break; }
}
console.log("\nfim em:", tt(await H()));
await b.close();
