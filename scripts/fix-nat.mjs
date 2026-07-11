// Corrige Nationality of passport holder -> BRAZIL (o restore-br deixou ARGENTINA).
// Tambem revela/dumpa a secao National identity card (RG) pra checar nome/dados.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
if (!/passport details|applicant/i.test(await H())) { console.log("nao esta na pag 3 -> abortando"); await b.close(); process.exit(0); }

// 1) nationality -> BRAZIL via selectOption nativo por id
const info = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const sel = [...document.querySelectorAll("select")].find((s) => { const l = s.id && document.querySelector('label[for="' + CSS.escape(s.id) + '"]'); return l && /nationality of passport/i.test(l.textContent || ""); });
  if (!sel) return null;
  const opt = [...sel.options].map((o) => txt(o.text)).find((t) => /^BRAZIL/i.test(t));
  return { id: sel.id, cur: txt(sel.options[sel.selectedIndex]?.text || ""), opt };
});
console.log("nationality antes:", info?.cur, "| alvo:", info?.opt);
if (info?.id && info.opt) { await pg.locator('[id="' + info.id + '"]').selectOption({ label: info.opt }).catch((e) => console.log("selectOption err:", e.message.slice(0, 50))); await pg.waitForTimeout(800); }
const after = await pg.evaluate((id) => { const s = document.getElementById(id); return s ? s.options[s.selectedIndex]?.text.trim() : "?"; }, info?.id || "");
console.log("nationality depois:", after);

// 2) National identity card: garante radio Yes revelado e dumpa os campos do RG
const rg = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : ""; };
  // acha fieldset/secao "national identity card"
  const secs = [...document.querySelectorAll("fieldset,section,div")].filter((d) => { const h = d.querySelector("h2,h3,h4,legend"); return h && /national identity card/i.test(h.textContent || ""); });
  const out = [];
  const scope = secs[0] || document;
  scope.querySelectorAll("input[type=text],select").forEach((el) => { if (!vis(el)) return; const v = el.tagName === "SELECT" ? txt(el.options[el.selectedIndex]?.text || "") : el.value; out.push(lf(el) + " = \"" + v + "\""); });
  return { found: !!secs.length, fields: out };
});
console.log("\nRG secao encontrada:", rg.found);
rg.fields.forEach((f) => console.log("  ", f));

// 3) salva
const save = pg.locator('button:has-text("Save"), a:has-text("Save")').first();
if (await save.isVisible().catch(() => false)) { await save.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(800); console.log("\nSalvo."); }
await pg.screenshot({ path: "artifacts/fix-nat.png", fullPage: true }).catch(() => {});
await b.close();
