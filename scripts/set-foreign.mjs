// Seta dados de passaporte de OUTRA nacionalidade (Argentina) na pagina 3 pra
// passar o gate e validar o form ate o fim. Guarda os dados BR pra reverter.
// Uso: npx tsx scripts/set-foreign.mjs
import { chromium } from "playwright";
import { writeFileSync, existsSync } from "node:fs";

const AR = {
  country: "ARGENTINA",
  nationality: "ARGENTINA",
  number: "AAC123456",
  issue: "18 Jun 2023",
  expiry: "18 Jun 2033",
  place: "RENAPER",
};

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const heading = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const nextBtn = () => pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first();
async function clickNext() { const n = nextBtn(); if (await n.isVisible().catch(() => false)) { await n.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(500); return true; } return false; }

async function setSelect(label, val) {
  const sel = pg.getByLabel(label, { exact: false }).first();
  if (!(await sel.count())) return console.log("  select nao achado:", label);
  const opt = await sel.evaluate((el, v) => {
    const V = v.toUpperCase();
    const o = [...el.options].find((o) => o.text.trim().toUpperCase().startsWith(V)) || [...el.options].find((o) => o.text.trim().toUpperCase().includes(V));
    return o ? o.text.trim() : null;
  }, val);
  if (!opt) return console.log("  opcao nao achada:", label, val);
  try { await sel.selectOption({ label: opt }); await pg.waitForTimeout(600); } catch (e) { console.log("  selectOption falhou:", label, e.message.split("\n")[0]); }
}
async function setText(label, val) { const f = pg.getByLabel(label, { exact: false }).first(); if (await f.count()) await f.fill(val).catch(() => {}); }

// summary -> Edit -> pagina 3
await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(900);
if (await pg.locator("input[type=password]").first().isVisible().catch(() => false)) { console.log("NEED_LOGIN"); await b.close(); process.exit(0); }
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(800); }
for (let i = 0; i < 6; i++) { if (/passport details|primary applicant/i.test(await heading())) break; if (!(await clickNext())) break; }
console.log("pagina:", (await heading()).slice(0, 50));

// guarda BR atual (pra reverter)
const br = {
  country: await pg.getByLabel("Country of passport", { exact: false }).first().inputValue().catch(() => "?"),
  nationality: await pg.getByLabel("Nationality of passport holder", { exact: false }).first().inputValue().catch(() => "?"),
  number: await pg.getByLabel("Passport number", { exact: false }).first().inputValue().catch(() => "?"),
  issue: await pg.getByLabel("Date of issue", { exact: false }).first().inputValue().catch(() => "?"),
  expiry: await pg.getByLabel("Date of expiry", { exact: false }).first().inputValue().catch(() => "?"),
  place: await pg.getByLabel("Place of issue", { exact: false }).first().inputValue().catch(() => "?"),
};
if (!existsSync("artifacts/br-passport-backup.json")) {
  writeFileSync("artifacts/br-passport-backup.json", JSON.stringify(br, null, 2));
  console.log("BACKUP BR salvo:", JSON.stringify(br));
} else {
  console.log("backup BR ja existe (preservado). Atual lido:", JSON.stringify(br));
}

// seta Argentina
await setSelect("Country of passport", AR.country);
await setSelect("Nationality of passport holder", AR.nationality);
await setText("Passport number", AR.number);
await setText("Date of issue", AR.issue);
await setText("Date of expiry", AR.expiry);
await setText("Place of issue", AR.place);
await pg.waitForTimeout(400);
console.log("setado Argentina:", JSON.stringify(AR));

// avanca ate confirmacao -> Yes -> tenta gate
for (let i = 0; i < 4; i++) { if (/critical data confirmation/i.test(await heading())) break; if (!(await clickNext())) break; }
await pg.evaluate(() => { const n = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase(); for (const r of [...document.querySelectorAll('input[type=radio]')].filter((r) => r.offsetParent)) { let l = ""; if (r.id) { const e = document.querySelector('label[for="' + CSS.escape(r.id) + '"]'); if (e) l = e.textContent; } if (n(l) === "yes") { const fs = r.closest("fieldset"); const lg = fs && fs.querySelector("legend"); if (lg && n(lg.textContent).includes("is the above information correct")) { if (!r.checked) r.click(); return; } } } });
await clickNext();
await pg.waitForTimeout(800);
const h = await heading();
const noVac = await pg.getByText(/lodgement is currently closed|not be able to continue|annual visa quota|currently closed/i).first().isVisible().catch(() => false);
const fmtErr = await pg.getByText(/does not match|invalid|not valid|format/i).first().isVisible().catch(() => false);
console.log("\nheading apos gate:", h.slice(0, 60));
console.log("GATE:", noVac ? "FECHADO (Argentina tambem sem vaga?)" : "ABERTO/passou");
console.log("erro de formato de passaporte?", fmtErr);
await pg.screenshot({ path: "artifacts/after-gate-ar.png", fullPage: true }).catch(() => {});
await b.close();
