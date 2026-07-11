// Reload + navega ate pag 12 (so clicando Next, dados ja salvos) e captura a
// mensagem de erro ESPECIFICA + conteudo da caixa Give details. Sem alterar nada.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const tt = (h) => h.replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 55);
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (!(await n.isVisible().catch(() => false))) return false; await n.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); return true; };

await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1200);
const edit = pg.locator('button:has-text("Edit"), a:has-text("Edit")').first();
if (await edit.isVisible().catch(() => false)) { await edit.click().catch(() => {}); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(900); }
for (let i = 0; i < 16; i++) { const h = await H(); if (/language|english/i.test(tt(h))) break; if (!(await clickNext())) break; }
console.log("em:", tt(await H()));

const info = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const ta = [...document.querySelectorAll("textarea")].filter(vis)[0];
  // mensagens especificas: qualquer texto com only/must/invalid/character/exceed/maximum
  const msgs = [...document.querySelectorAll("*")].filter((e) => vis(e) && e.children.length === 0 && /only contain|must be|invalid|cannot|maximum|exceed|character|not valid|required|no more than/i.test(txt(e.textContent))).map((e) => txt(e.textContent)).filter((t) => t.length < 160);
  return { boxLen: ta ? (ta.value || "").length : -1, boxVal: ta ? (ta.value || "").slice(0, 120) : "(sem textarea)", boxMax: ta ? ta.maxLength : "?", msgs: [...new Set(msgs)].slice(0, 10), errHeading: [...document.querySelectorAll("h1,h2,h3")].some((h) => /error has occurred/i.test(h.textContent)) };
});
console.log("errHeading:", info.errHeading);
console.log("box len:", info.boxLen, "| maxLength:", info.boxMax);
console.log("box val:", info.boxVal);
console.log("mensagens especificas:", JSON.stringify(info.msgs, null, 1));
await pg.screenshot({ path: "artifacts/pg12-diag.png", fullPage: true }).catch(() => {});
await b.close();
