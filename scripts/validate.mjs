// SO LEITURA. Navega pras paginas Application context / Applicant e reporta os
// valores atuais (radios marcados, selects, inputs). Confirma que os seletores
// resolvem e mostra os dados pre-salvos. NAO altera nada.
import { chromium } from "playwright";

const readVals = () => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const qOf = (r) => {
    const fs = r.closest("fieldset");
    if (fs) { const lg = fs.querySelector("legend"); if (lg && txt(lg.textContent)) return txt(lg.textContent); }
    let node = r;
    for (let up = 0; up < 8 && node; up++) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (/^(H1|H2|H3|H4|LEGEND|LABEL)$/.test(sib.tagName) && txt(sib.textContent)) return txt(sib.textContent);
        const h = sib.querySelector && sib.querySelector("h1,h2,h3,h4,legend");
        if (h && txt(h.textContent)) return txt(h.textContent);
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  };
  const labelOf = (el) => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && txt(l.textContent)) return txt(l.textContent); }
    const wl = el.closest("label"); return wl ? txt(wl.textContent) : "";
  };
  const heads = [...document.querySelectorAll("h2,h3")].map((h) => txt(h.textContent)).filter(Boolean);
  const out = { heading: heads.slice(0, 3).join(" | "), radios: [], selects: [], inputs: [] };
  const groups = {};
  document.querySelectorAll('input[type="radio"]').forEach((r) => {
    if (!groups[r.name]) groups[r.name] = { q: qOf(r), checked: null };
    if (r.checked) groups[r.name].checked = labelOf(r);
    if (!groups[r.name].q) groups[r.name].q = qOf(r);
  });
  Object.values(groups).forEach((g) => { if (g.q) out.radios.push({ q: g.q.slice(0, 90), checked: g.checked }); });
  document.querySelectorAll("select").forEach((s) => { if (s.offsetParent) out.selects.push({ label: labelOf(s), value: s.options[s.selectedIndex]?.text.trim() || "" }); });
  document.querySelectorAll('input[type="text"]').forEach((i) => { if (i.offsetParent) out.inputs.push({ label: labelOf(i), value: i.value }); });
  return out;
};

const show = (tag, d) => {
  console.log(`\n===== ${tag} :: ${d.heading} =====`);
  console.log("INPUTS:");
  d.inputs.forEach((x) => console.log(`   ${x.label} = "${x.value}"`));
  console.log("SELECTS:");
  d.selects.forEach((x) => console.log(`   ${x.label} = "${x.value}"`));
  console.log("RADIOS (marcado):");
  d.radios.forEach((x) => console.log(`   [${x.checked ?? "-- VAZIO --"}]  ${x.q}`));
};

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];

async function gotoHeading(match, dir) {
  for (let i = 0; i < 8; i++) {
    const h = (await pg.locator("h2,h3").allTextContents()).join(" | ");
    if (h.includes(match)) return true;
    const btn = pg.getByRole("button", { name: new RegExp(`^${dir}$`, "i") }).filter({ hasNot: pg.locator("[disabled]") }).first();
    if (!(await btn.isVisible().catch(() => false))) return false;
    await btn.click().catch(() => {});
    await pg.waitForLoadState("networkidle").catch(() => {});
    await pg.waitForTimeout(500);
  }
  return false;
}

// voltar ate Application context
await gotoHeading("Application context", "Previous");
await pg.waitForTimeout(400);
show("PAGE 2 (context)", await pg.evaluate(readVals));

// avancar pra Applicant (passaporte)
await gotoHeading("Applicant", "Next");
await pg.waitForTimeout(400);
show("PAGE 3 (passport)", await pg.evaluate(readVals));

console.log("\n(read-only, nada alterado)");
await b.close();
