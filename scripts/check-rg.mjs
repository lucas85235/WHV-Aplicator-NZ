// Dumpa os campos de NOME da pagina 3: passaporte vs RG (national identity card),
// pra ver se o nome do RG esta trocado no app salvo.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const H = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
console.log("pagina:", (await H()).replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 60));
const d = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const lf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } const wl = el.closest("label"); return wl ? txt(wl.textContent) : ""; };
  // acha a secao (heading mais proximo acima) pra distinguir passaporte vs RG
  const sectionOf = (el) => {
    let n = el;
    for (let up = 0; up < 12 && n; up++) {
      let sib = n.previousElementSibling;
      while (sib) { if (/H2|H3|H4|LEGEND/.test(sib.tagName) && txt(sib.textContent)) return txt(sib.textContent).slice(0, 40); const h = sib.querySelector && sib.querySelector("h2,h3,h4,legend"); if (h && txt(h.textContent)) return txt(h.textContent).slice(0, 40); sib = sib.previousElementSibling; }
      n = n.parentElement;
    }
    return "?";
  };
  return [...document.querySelectorAll("input[type=text]")].filter(vis).map((el) => ({ label: lf(el), val: el.value, section: sectionOf(el) })).filter((x) => /name|number|nome/i.test(x.label));
});
d.forEach((x) => console.log(`  [${x.section}] ${x.label} = "${x.val}"`));
await b.close();
