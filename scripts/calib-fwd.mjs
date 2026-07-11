// Caminha PRA FRENTE a partir da pagina atual (pg7, gate ja passado c/ Argentina)
// usando os HANDLERS REAIS (dist). fillMode(false) = forca preencher (limpa junk
// e prova os seletores). Dumpa o que cada pagina preencheu + erros de validacao.
// NAO submete, NAO paga. NAO toca a pagina 3 (so vai pra frente).
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(false); // FORCA overwrite na calibracao (limpa CALIB e valida seletores)
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const heading = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(700); return true; };

const dump = () => pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const labelFor = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } if (el.getAttribute("aria-label")) return txt(el.getAttribute("aria-label")); const wl = el.closest("label"); return wl ? txt(wl.textContent) : ""; };
  const qOf = (r) => { const fs = r.closest("fieldset"); const lg = fs && fs.querySelector("legend"); return lg ? txt(lg.textContent).slice(0, 90) : ""; };
  const filled = [], selects = [], radios = [];
  document.querySelectorAll("input,textarea").forEach((el) => { if (!vis(el)) return; const t = (el.getAttribute("type") || "text").toLowerCase(); if (t === "radio" || t === "checkbox") { if (el.checked) radios.push({ q: qOf(el), label: labelFor(el), t }); } else if (el.value) filled.push({ label: labelFor(el), val: el.value.slice(0, 40) }); });
  document.querySelectorAll("select").forEach((el) => { if (!vis(el)) return; const v = txt(el.options[el.selectedIndex]?.text || ""); if (v) selects.push({ label: labelFor(el), val: v }); });
  // erros de validacao visiveis
  const errs = [...new Set([...document.querySelectorAll('.error,.field-error,[role=alert],.validation-message,.invalid-feedback,.error-message,span.error,li.error')].filter(vis).map((e) => txt(e.textContent)).filter((t) => t && t.length < 120))].slice(0, 10);
  return { filled, selects, radios, errs };
});

console.log("== CALIB FWD (handlers reais, fillMode=false) ==\n");
let prev = "", stuck = 0;
for (let step = 0; step < 20; step++) {
  const h = await heading();
  const tag = h.replace(/Online Lodgement \| Application for a Work and Holiday visa \|/i, "").trim().slice(0, 75);
  console.log(`\n=== step ${step} :: ${tag} ===`);

  if (/provide documents|attach documents|document checklist|upload|attachments|review|check your answers|summary of your|confirm your answers|submit now|ready to submit|application charge|payment|pay for/i.test(h)) {
    console.log(">> chegou em DOCS/REVIEW/SUBMIT/PAYMENT. Parando ANTES de submeter/pagar.");
    break;
  }
  if (h === prev) { if (++stuck >= 2) { console.log(">> TRAVOU 2x na mesma pagina. Erros abaixo."); const d = await dump(); console.log("   errs:", JSON.stringify(d.errs)); break; } } else stuck = 0;
  prev = h;

  const m = PAGE_MATCHERS.find((x) => x.re.test(h));
  if (!m) { console.log("   !! pagina NAO reconhecida por PAGE_MATCHERS -> tentando Next"); }
  else {
    console.log(`   handler: ${m.page.id} (${m.page.title})`);
    try { await m.page.handle({ page: pg, cfg }); } catch (e) { console.log("   HANDLER ERRO:", String(e).split("\n")[0].slice(0, 100)); }
    await pg.waitForTimeout(400);
    const d = await dump();
    if (d.selects.length) console.log("   selects:", d.selects.map((x) => `${x.label}=${x.val}`).join(" | ").slice(0, 240));
    if (d.filled.length) console.log("   inputs :", d.filled.map((x) => `${x.label}=${x.val}`).join(" | ").slice(0, 240));
    if (d.radios.length) console.log("   radios :", d.radios.map((x) => `${x.q?.slice(0, 40)}:${x.label}`).join(" | ").slice(0, 240));
    if (d.errs.length) console.log("   ERROS  :", JSON.stringify(d.errs));
  }
  await pg.screenshot({ path: `artifacts/calib-${String(step).padStart(2, "0")}.png`, fullPage: true }).catch(() => {});
  if (!(await clickNext())) { console.log(">> sem Next -> parando"); break; }
}
console.log("\nheading final:", (await heading()).slice(0, 80));
await b.close();
