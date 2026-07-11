// Inspeciona o estado atual da pagina viva (heading, erros, page, next habilitado).
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const info = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const headings = [...document.querySelectorAll("h1,h2,h3")].map((h) => txt(h.textContent)).filter(Boolean).slice(0, 6);
  // mensagens de erro visiveis (classes comuns do ImmiAccount + role=alert)
  const errs = [...document.querySelectorAll('.error, .field-error, [role=alert], .validation-message, .alert-error, .has-error, .invalid-feedback, .error-message, span.error, li.error')]
    .filter(vis).map((e) => txt(e.textContent)).filter(Boolean).slice(0, 15);
  // qualquer texto contendo "error"/"invalid"/"required"/"format" visivel
  const anyErr = [...document.querySelectorAll("*")].filter((e) => vis(e) && e.children.length === 0 && /invalid|does not match|is required|must be|not valid|format|error/i.test(txt(e.textContent))).map((e) => txt(e.textContent)).filter((t) => t.length < 140).slice(0, 12);
  const next = document.querySelector("button");
  const nextBtns = [...document.querySelectorAll("button,a")].filter((x) => /^next$/i.test(txt(x.textContent))).map((x) => ({ text: txt(x.textContent), disabled: x.disabled || x.getAttribute("aria-disabled") === "true" || x.classList.contains("disabled") }));
  return { url: location.href, headings, errs: [...new Set(errs)], anyErr: [...new Set(anyErr)], nextBtns };
});
console.log(JSON.stringify(info, null, 2));
await pg.screenshot({ path: "artifacts/inspect.png", fullPage: true }).catch(() => {});
await b.close();
