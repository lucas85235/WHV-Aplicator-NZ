// DRIVER de calibracao robusto. Reabre a app (limpa estado de erro), clica Edit,
// e caminha PRA FRENTE aplicando os HANDLERS REAIS (dist). fillMode(true) protege
// a pg3 (Argentina fica -> gate aberto) e as paginas ja preenchidas. Verifica cada
// pagina: se der erro de validacao ou "An error has occurred", PARA e dumpa. Para
// tambem em docs/review/submit/payment (NAO submete, NAO paga).
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { PAGE_MATCHERS } from "../dist/src/pages/index.js";
import { setFillMode } from "../dist/src/locators.js";

const cfg = await loadConfig();
setFillMode(true); // protege pg3/paginas ja preenchidas; preenche vazias
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tag = (h) => h.replace(/Online Lodgement \| Application for a Work and Holiday visa \|?/i, "").trim().slice(0, 70);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); return true; };
const dump = () => pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const labelFor = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : (el.getAttribute("aria-label") || ""); };
  const filled = [], selects = [], radios = [];
  document.querySelectorAll("input,textarea").forEach((el) => { if (!vis(el)) return; const t = (el.getAttribute("type") || "text").toLowerCase(); if (t === "radio" || t === "checkbox") { if (el.checked) radios.push(labelFor(el).slice(0, 30)); } else if (el.value) filled.push(labelFor(el) + "=" + el.value.slice(0, 28)); });
  document.querySelectorAll("select").forEach((el) => { if (!vis(el)) return; const v = txt(el.options[el.selectedIndex]?.text || ""); if (v) selects.push(labelFor(el) + "=" + v); });
  const err = [...document.querySelectorAll("h1,h2,h3")].some((h) => /error has occurred/i.test(h.textContent));
  const verr = [...new Set([...document.querySelectorAll('.error,.field-error,[role=alert],.validation-message,.invalid-feedback,.error-message,span.error,li.error')].filter(vis).map((e) => txt(e.textContent)).filter((t) => t && t.length < 120))].slice(0, 8);
  return { filled, selects, radios, err, verr };
});

// abre summary limpo + Edit
await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
if (await pg.locator("input[type=password]").first().isVisible().catch(() => false)) { console.log("NEED_LOGIN - loga manual e roda de novo"); await b.close(); process.exit(0); }
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
console.log("abertura:", tag(await H()), "\n");

let prev = "", stuck = 0;
for (let step = 0; step < 24; step++) {
  const h = await H();
  const t = tag(h);
  console.log(`\n--- step ${step} :: ${t} ---`);
  if (/error has occurred/i.test(h)) { console.log("!! 'An error has occurred' -> PARANDO. (dump abaixo)"); console.log(JSON.stringify(await dump())); break; }
  if (/provide documents|attach documents|document checklist|upload|attachments|review|check your answers|summary of your|confirm your answers|submit now|ready to submit|application charge|payment|pay for/i.test(h)) {
    console.log(">> DOCS/REVIEW/SUBMIT/PAYMENT alcancado. Parando ANTES de submeter."); break;
  }
  if (h === prev) { if (++stuck >= 2) { console.log("!! TRAVOU 2x -> dump:"); console.log(JSON.stringify(await dump())); break; } } else stuck = 0;
  prev = h;

  const m = PAGE_MATCHERS.find((x) => x.re.test(h));
  if (m) {
    console.log(`   handler ${m.page.id}`);
    try { await m.page.handle({ page: pg, cfg }); } catch (e) { console.log("   HANDLER THROW:", String(e).split("\n")[0].slice(0, 90)); }
    await pg.waitForTimeout(300);
    const d = await dump();
    if (d.selects.length) console.log("   sel:", d.selects.join(" | ").slice(0, 220));
    if (d.filled.length) console.log("   inp:", d.filled.join(" | ").slice(0, 220));
    if (d.radios.length) console.log("   rad:", d.radios.join(", ").slice(0, 180));
    if (d.verr.length) { console.log("   VALID-ERR:", JSON.stringify(d.verr), "-> PARANDO p/ calibrar"); break; }
  } else console.log("   (sem handler - so Next)");
  await pg.screenshot({ path: `artifacts/drive-${String(step).padStart(2, "0")}.png`, fullPage: true }).catch(() => {});
  if (!(await clickNext())) { console.log(">> sem Next -> parando"); break; }
}
console.log("\nFIM. heading:", tag(await H()));
await b.close();
