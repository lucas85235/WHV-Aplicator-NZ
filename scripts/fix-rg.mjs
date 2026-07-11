// Corrige o nome trocado do RG (national identity card): Family=Lucas / Given=De Souza Lima
// -> Family=De Souza Lima / Given=Lucas. Clica Edit na linha, corrige, Confirm, Save.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
if (!/passport details|applicant/i.test(await H())) { console.log("nao esta na pag 3 -> abortando"); await b.close(); process.exit(0); }

// clica Edit da linha do RG (dentro da secao national identity card)
const edit = pg.locator('a:has-text("Edit"), button:has-text("Edit")').first();
if (!(await edit.isVisible().catch(() => false))) { console.log("Edit do RG nao achado"); await b.close(); process.exit(0); }
await edit.click().catch(() => {});
await pg.waitForLoadState("domcontentloaded").catch(() => {});
await pg.waitForTimeout(1200);
console.log("subpage:", (await H()).replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 50));

// dump campos visiveis do subform
const before = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } return ""; };
  return [...document.querySelectorAll("input[type=text],select")].filter(vis).map((el) => ({ label: lf(el), val: el.tagName === "SELECT" ? txt(el.options[el.selectedIndex]?.text || "") : el.value }));
});
console.log("campos antes:", JSON.stringify(before));

// corrige nomes (fill direto nos campos visiveis do subform)
async function setField(label, val) {
  const f = pg.getByLabel(label, { exact: false }).filter({ visible: true }).first();
  if (await f.count()) { await f.fill(val).catch(() => {}); return true; }
  return false;
}
await setField("Family name", "De Souza Lima");
await setField("Given names", "Lucas");
await pg.waitForTimeout(500);
const after = await pg.evaluate(() => { const vis = (el) => !!(el.offsetParent || el.getClientRects().length); const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return (l.textContent || "").replace(/\s+/g, " ").trim(); } return ""; }; return [...document.querySelectorAll("input[type=text]")].filter(vis).map((el) => lf(el) + "=" + el.value).filter((x) => /name/i.test(x)); });
console.log("campos depois:", JSON.stringify(after));

// Confirm
const conf = pg.locator('button:has-text("Confirm"), a:has-text("Confirm")').filter({ hasNot: pg.locator("[disabled]") }).first();
if (await conf.isVisible().catch(() => false)) { await conf.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(1200); console.log("Confirm clicado"); }
// Save pagina
const save = pg.locator('button:has-text("Save"), a:has-text("Save")').first();
if (await save.isVisible().catch(() => false)) { await save.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(800); console.log("Save clicado"); }

// verifica a linha da tabela do RG
const row = await pg.evaluate(() => { const t = [...document.querySelectorAll("table")].find((x) => /identification number/i.test(x.textContent || "")); const tr = t && [...t.querySelectorAll("tbody tr")].find((r) => r.querySelectorAll("td").length > 1); return tr ? tr.textContent.replace(/\s+/g, " ").trim().slice(0, 100) : "(sem linha)"; });
console.log("\nlinha RG agora:", row);
await pg.screenshot({ path: "artifacts/fix-rg.png", fullPage: true }).catch(() => {});
await b.close();
