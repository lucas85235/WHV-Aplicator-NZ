// Anexa, abre a app salva (Edit) e caminha por TODAS as paginas ate o gate,
// dumpando o DOM real (labels/ids/radios/selects/botoes) pra calibrar seletores.
// NAO submete, NAO paga.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("artifacts/dom", { recursive: true });

const dumpFn = () => {
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const labelFor = (el) => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && txt(l.innerText)) return txt(l.innerText); }
    if (el.getAttribute("aria-label")) return txt(el.getAttribute("aria-label"));
    const wl = el.closest("label"); if (wl && txt(wl.innerText)) return txt(wl.innerText);
    if (el.getAttribute("placeholder")) return txt(el.getAttribute("placeholder"));
    return "";
  };
  const groupQ = (el) => {
    const fs = el.closest("fieldset"); if (fs) { const lg = fs.querySelector("legend"); if (lg && txt(lg.innerText)) return txt(lg.innerText).slice(0, 160); }
    const row = el.closest("tr, .row, .question, .wc-field"); if (row) { const c = row.querySelector("th, td, label, .questionLabel, .wc-label"); if (c) return txt(c.innerText).slice(0, 160); }
    return "";
  };
  const out = { url: location.href, title: document.title, pageInfo: "", headings: [], inputs: [], radios: [], selects: [], buttons: [] };
  const pinfo = txt(document.body.innerText).match(/Page\s+\d+\s+of\s+\d+/i); out.pageInfo = pinfo ? pinfo[0] : "";
  document.querySelectorAll("h1,h2,h3,legend").forEach((h) => { const t = txt(h.innerText); if (t) out.headings.push(t); });
  document.querySelectorAll("input,select,textarea").forEach((el) => {
    if (!vis(el)) return;
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (el.tagName === "SELECT") out.selects.push({ label: labelFor(el), id: el.id, name: el.name, options: [...el.options].map((o) => txt(o.text)).filter(Boolean).slice(0, 14) });
    else if (type === "radio" || type === "checkbox") out.radios.push({ type, question: groupQ(el), label: labelFor(el), id: el.id, name: el.name, value: el.value });
    else if (type !== "hidden") out.inputs.push({ type, label: labelFor(el), id: el.id, name: el.name });
  });
  document.querySelectorAll("button,input[type=submit],input[type=button],a.wc-button").forEach((b) => { const t = txt(b.innerText || b.value); if (t && vis(b) && !b.disabled) out.buttons.push(t); });
  return out;
};

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
console.log("start:", pg.url());

const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) {
  await edit.click();
  await pg.waitForLoadState("networkidle").catch(() => {});
  for (let i = 0; i < 20; i++) { await pg.waitForTimeout(300); if (!(await pg.getByText("My applications summary").first().isVisible().catch(() => false))) break; }
}

const nextBtn = () => pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first();
const summary = [];
let lastKey = "";
for (let step = 1; step <= 18; step++) {
  await pg.waitForTimeout(500);
  const d = await pg.evaluate(dumpFn);
  const key = d.pageInfo + "|" + d.headings.slice(0, 3).join("|");
  writeFileSync(`artifacts/dom/step${String(step).padStart(2, "0")}.json`, JSON.stringify(d, null, 2));
  await pg.screenshot({ path: `artifacts/dom/step${String(step).padStart(2, "0")}.png`, fullPage: true }).catch(() => {});
  const gate = await pg.getByText(/no places|not available|unavailable|no further|cannot be lodged/i).first().isVisible().catch(() => false);
  summary.push({ step, pageInfo: d.pageInfo, url: d.url, heads: d.headings.slice(0, 3), inputs: d.inputs.length, radios: d.radios.length, selects: d.selects.length, gate });
  console.log(`\n=== STEP ${step} ${d.pageInfo} ===`);
  console.log("heads:", d.headings.slice(0, 4).join(" | "));
  if (d.inputs.length) console.log("inputs:", d.inputs.map((x) => `${x.label || x.name}(${x.type})`).join(" ; "));
  if (d.selects.length) console.log("selects:", d.selects.map((x) => `${x.label || x.name}=[${x.options.slice(0, 5).join("/")}]`).join(" ; "));
  const rq = [...new Set(d.radios.map((r) => r.question).filter(Boolean))];
  if (rq.length) console.log("radioQs:", rq.join(" ;; "));
  console.log("buttons:", [...new Set(d.buttons)].join(" , "));
  if (gate) { console.log(">> GATE / SEM VAGA. Parando."); break; }
  if (key === lastKey && step > 1) { console.log(">> pagina nao avancou (validacao?). Parando."); break; }
  lastKey = key;
  if (!(await nextBtn().isVisible().catch(() => false))) { console.log(">> sem Next. Parando."); break; }
  await nextBtn().click({ timeout: 8000 }).catch((e) => console.log("next err:", e.message.split("\n")[0]));
  await pg.waitForLoadState("networkidle").catch(() => {});
}
writeFileSync("artifacts/dom/summary.json", JSON.stringify(summary, null, 2));
console.log("\nDONE. Dumps em artifacts/dom/");
await b.close();
