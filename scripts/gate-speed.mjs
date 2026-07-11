// Mede a velocidade REAL do retry no gate (Next -> checa sem-vaga -> re-tenta).
// Faz ~6 ciclos e mostra o tempo de cada. NAO submete nada.
import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const NV = /lodgement is currently closed|not be able to continue|annual visa quota|currently closed/i;

const heading = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const noVac = async () => pg.getByText(NV).first().isVisible().catch(() => false);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (await n.isVisible().catch(() => false)) { await n.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); return true; } return false; };
const clickPrev = async () => { const p = pg.locator('button:has-text("Previous"), a:has-text("Previous")').filter({ hasNot: pg.locator("[disabled]") }).first(); if (await p.isVisible().catch(() => false)) { await p.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); return true; } return false; };

// sessao viva?
await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1000);
if (await pg.locator("input[type=password]").first().isVisible().catch(() => false)) { console.log("NEED_LOGIN - logue e rode de novo"); await b.close(); process.exit(0); }

// abrir Edit e ir ate a confirmacao
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(800); }
for (let i = 0; i < 8; i++) { if (/critical data confirmation/i.test(await heading())) break; if (!(await clickNext())) break; await pg.waitForTimeout(300); }
console.log("pagina atual:", (await heading()).slice(0, 70));

// garantir "Is the above information correct?" = Yes p/ conseguir clicar Next
await pg.evaluate(() => { const n = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase(); for (const r of [...document.querySelectorAll('input[type=radio]')].filter((r) => r.offsetParent)) { let l = ""; if (r.id) { const e = document.querySelector('label[for="' + CSS.escape(r.id) + '"]'); if (e) l = e.textContent; } if (n(l) === "yes") { const fs = r.closest("fieldset"); const lg = fs && fs.querySelector("legend"); if (lg && n(lg.textContent).includes("is the above information correct")) { if (!r.checked) r.click(); return; } } } });

console.log("\n=== MEDINDO CICLOS DE RETRY ===");
let t = Date.now(); await clickNext(); await pg.waitForTimeout(150);
console.log(`Next inicial: ${Date.now() - t}ms | sem-vaga detectado: ${await noVac()}`);
const times = [];
for (let k = 1; k <= 6; k++) {
  const t0 = Date.now();
  if (!(await clickNext())) { await clickPrev(); await clickNext(); } // re-tenta (Next direto, ou Previous+Next)
  await pg.waitForTimeout(150);
  const nv = await noVac();
  const dt = Date.now() - t0;
  times.push(dt);
  console.log(`ciclo ${k}: ${dt}ms | ainda fechado: ${nv}`);
}
const avg = Math.round(times.reduce((a, c) => a + c, 0) / times.length);
console.log(`\nMEDIA por ciclo: ${avg}ms  (+ intervalMs de pausa configurado)`);
console.log(`Ou seja: ~${(1000 / (avg + 1000)).toFixed(2)} tentativas/segundo com intervalMs=1000`);
await b.close();
