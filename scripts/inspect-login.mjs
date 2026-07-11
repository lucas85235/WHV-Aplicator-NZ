// Inspeciona a tela de login do ImmiAccount (campos usuario/senha/botao).
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
await pg.goto("https://online.immi.gov.au/lusc/login", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1500);
const d = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const labelFor = (el) => { if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && txt(l.textContent)) return txt(l.textContent); } if (el.getAttribute("aria-label")) return el.getAttribute("aria-label"); if (el.placeholder) return el.placeholder; return ""; };
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const inputs = [...document.querySelectorAll("input")].filter(vis).map((i) => ({ type: (i.getAttribute("type") || "text"), label: labelFor(i), id: i.id, name: i.name }));
  const buttons = [...document.querySelectorAll("button,input[type=submit],a.wc-button")].filter(vis).map((x) => txt(x.innerText || x.value)).filter(Boolean);
  return { url: location.href, title: document.title, headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => txt(h.textContent)).filter(Boolean).slice(0, 5), inputs, buttons };
});
console.log("URL:", d.url);
console.log("TITLE:", d.title);
console.log("HEADINGS:", d.headings.join(" | "));
console.log("INPUTS:"); d.inputs.forEach((i) => console.log("  ", JSON.stringify(i)));
console.log("BUTTONS:", [...new Set(d.buttons)].join(" , "));
await pg.screenshot({ path: "artifacts/login.png", fullPage: true }).catch(() => {});
await b.close();
