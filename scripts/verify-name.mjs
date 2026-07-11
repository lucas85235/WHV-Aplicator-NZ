// SO LEITURA. Confere Family name / Given names na app salva. Se a sessao caiu
// (tela de login), avisa e para - login e SEMPRE manual (senha + Authenticator).
import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);

const needLogin = await pg.locator('input[type=password]').first().isVisible().catch(() => false);
const title = await pg.title().catch(() => "");
if (needLogin || /log ?in|sign ?in/i.test(title)) {
  console.log("NEED_LOGIN :: sessao caiu. Faca login manual (senha + codigo do Google Authenticator) e rode de novo.");
  await b.close();
  process.exit(0);
}

// abrir Edit
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) {
  await edit.click();
  await pg.waitForLoadState("domcontentloaded").catch(() => {});
  for (let i = 0; i < 20; i++) { await pg.waitForTimeout(300); if (!(await pg.getByText("My applications summary").first().isVisible().catch(() => false))) break; }
}

// navegar ate passaporte
async function next() { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (await n.isVisible().catch(() => false)) { await n.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(400); return true; } return false; }
let found = false;
for (let i = 0; i < 7; i++) {
  const h = (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
  if (/passport details|primary applicant/i.test(h)) { found = true; break; }
  if (!(await next())) break;
}
if (!found) { console.log("nao cheguei na pagina de passaporte (heading atual:", (await pg.locator("h2,h3").allTextContents()).slice(0,2).join(" | "), ")"); await b.close(); process.exit(0); }

const fam = await pg.getByLabel("Family name", { exact: false }).filter({ visible: true }).first().inputValue().catch(() => "?");
const giv = await pg.getByLabel("Given names", { exact: false }).filter({ visible: true }).first().inputValue().catch(() => "?");
const cop = await pg.getByLabel("Country of passport", { exact: false }).first().inputValue().catch(() => "?");
console.log("\n===== NOME NA APP SALVA =====");
console.log("Family name :", fam);
console.log("Given names :", giv);
console.log("Country pass:", cop);
console.log("\nEsperado -> Family: DE SOUZA LIMA | Given: LUCAS (bater com passaporte)");
await b.close();
