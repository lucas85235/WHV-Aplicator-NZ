// Dump COMPLETO da pagina atual (headings, radios c/ pergunta+opcoes, selects c/
// label+amostra de opcoes, inputs c/ label). Sem efeitos colaterais (nao muda nada).
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const d = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const labelFor = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } if (el.getAttribute("aria-label")) return txt(el.getAttribute("aria-label")); const wl = el.closest("label"); return wl ? txt(wl.textContent) : ""; };
  const qOf = (r) => { const fs = r.closest("fieldset"); const lg = fs && fs.querySelector("legend"); if (lg && txt(lg.textContent)) return txt(lg.textContent).slice(0, 120); const p = r.closest(".question,.field,.form-group,section,div[role=group]"); const h = p && p.querySelector("label,legend,.question-label,h3,h4"); return h ? txt(h.textContent).slice(0, 120) : ""; };
  const o = { url: location.href, headings: [], radioGroups: {}, selects: [], inputs: [], checkboxes: [] };
  document.querySelectorAll("h1,h2,h3").forEach((h) => { const t = txt(h.textContent); if (t) o.headings.push(t); });
  document.querySelectorAll("input,select,textarea").forEach((el) => {
    if (!vis(el)) return;
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (el.tagName === "SELECT") o.selects.push({ label: labelFor(el), val: txt(el.options[el.selectedIndex]?.text || ""), nOpts: el.options.length, sample: [...el.options].slice(0, 6).map((x) => txt(x.text)).filter(Boolean) });
    else if (type === "radio") { const k = qOf(el) || el.name; (o.radioGroups[k] = o.radioGroups[k] || []).push({ label: labelFor(el), val: el.value, checked: el.checked }); }
    else if (type === "checkbox") o.checkboxes.push({ label: labelFor(el).slice(0, 90), checked: el.checked });
    else if (type === "text" || type === "textarea" || type === "tel" || type === "email" || type === "number") o.inputs.push({ type, label: labelFor(el), val: el.value.slice(0, 30) });
  });
  return o;
});
console.log(JSON.stringify(d, null, 2));
await b.close();
