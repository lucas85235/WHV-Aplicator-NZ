// SO LEITURA da pagina atual (nao navega). Mostra url/title/headings/erros/inputs/botoes.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const d = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const heads = [...document.querySelectorAll("h1,h2,h3")].map((h) => txt(h.textContent)).filter(Boolean).slice(0, 6);
  const errs = [...document.querySelectorAll(".error,.wc-error,[class*=error],[class*=Error],[role=alert],.messages,.alert")].map((e) => txt(e.textContent)).filter((t) => t && t.length < 200);
  const inputs = [...document.querySelectorAll("input")].filter(vis).map((i) => ({ type: i.getAttribute("type") || "text", id: i.id, name: i.name, val: (i.value || "").slice(0, 3) }));
  const buttons = [...document.querySelectorAll("button,input[type=submit],a.wc-button")].filter(vis).map((x) => txt(x.innerText || x.value)).filter(Boolean);
  const onSummary = /my applications/i.test(document.body.innerText) && /\/ola\/app/.test(location.href);
  return { url: location.href, title: document.title, heads, errs: [...new Set(errs)].slice(0, 6), inputs, buttons: [...new Set(buttons)], onSummary, bodyStart: txt(document.body.innerText).slice(0, 300) };
});
console.log("URL:", d.url);
console.log("TITLE:", d.title);
console.log("onSummary:", d.onSummary);
console.log("HEADINGS:", d.heads.join(" | "));
console.log("ERROS:", d.errs.join(" || ") || "(nenhum)");
console.log("INPUTS:"); d.inputs.forEach((i) => console.log("  ", JSON.stringify(i)));
console.log("BUTTONS:", d.buttons.join(" , "));
console.log("BODY:", d.bodyStart);
await b.close();
