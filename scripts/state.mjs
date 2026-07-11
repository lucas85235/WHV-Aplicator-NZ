// Cancela tela de Copy (se houver), vai pro summary e conta as aplicacoes.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
pg.on("dialog", (d) => d.accept().catch(() => {}));
const cancel = pg.locator('button:has-text("Cancel"), a:has-text("Cancel")').first();
if (await cancel.isVisible().catch(() => false)) { await cancel.click().catch(() => {}); await pg.waitForTimeout(1000); }
await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1500);
const info = await pg.evaluate(() => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  const refs = [...t.matchAll(/Reference No\s+([A-Z0-9]{8,})/gi)].map((m) => m[1]);
  const results = (t.match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+results/i) || [])[0] || "?";
  return { title: document.title, refs, results };
});
console.log("TITLE:", info.title);
console.log("RESULTS:", info.results);
console.log("REFS:", JSON.stringify(info.refs));
await b.close();
