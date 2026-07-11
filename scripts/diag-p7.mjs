// Da pagina 6 (gate passado c/ Argentina), responde pg6=No, avanca pra pg7,
// dumpa FATOS exatos dos selects (id/name/visible/valor/isCountry) e TESTA o fix
// (native selectOption por id) no usual-country + residential-country.
import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const heading = async () => (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
const clickNext = async () => { const n = pg.getByRole("button", { name: /^next$/i }).filter({ hasNot: pg.locator("[disabled]") }).first(); if (await n.isVisible().catch(() => false)) { await n.click(); await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(700); return true; } return false; };

// --- pg6: responde "travelled/applied before" = No, e qualquer Yes/No visivel = No ---
let h = await heading();
console.log("inicio:", h.slice(0, 70));
if (/additional identity|previous travel|movements/i.test(h)) {
  await pg.evaluate(() => {
    const n = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    for (const g of Object.values([...document.querySelectorAll('input[type=radio]')].filter((r) => r.offsetParent).reduce((a, r) => ((a[r.name] = a[r.name] || []).push(r), a), {}))) {
      if (g.some((x) => x.checked)) continue;
      const no = g.find((r) => r.value === "2") || g.find((r) => { let l = ""; if (r.id) { const e = document.querySelector('label[for="' + CSS.escape(r.id) + '"]'); if (e) l = e.textContent; } return n(l) === "no"; });
      if (no) no.click();
    }
  });
  await pg.waitForTimeout(300);
  await clickNext();
  h = await heading();
  console.log("apos pg6->Next:", h.slice(0, 70));
}

// --- pg7: dump completo dos selects ---
const facts = await pg.evaluate(() => {
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
  const labelFor = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && txt(l.textContent)) return txt(l.textContent); } return ""; };
  const isCountry = (s) => [...s.options].some((o) => /^AUSTRALIA$/i.test(txt(o.text))) && [...s.options].some((o) => /^AFGHANISTAN$/i.test(txt(o.text)));
  return [...document.querySelectorAll("select")].map((s, i) => ({
    i, id: s.id || "", name: (s.name || "").slice(0, 40), aria: s.getAttribute("aria-label") || "", labelFor: labelFor(s),
    visible: vis(s), country: isCountry(s), val: txt(s.options[s.selectedIndex]?.text || ""), nOpts: s.options.length,
  }));
});
console.log("\n=== SELECTS na pg7 ===");
facts.forEach((f) => console.log(JSON.stringify(f)));

// getByLabel counts (exato e nao-exato)
for (const [lbl, ex] of [["Usual country of residence", true], ["Country", true], ["Country", false]]) {
  const c = await pg.getByLabel(lbl, { exact: ex }).count();
  console.log(`getByLabel("${lbl}", exact:${ex}) -> ${c}`);
}

// --- TESTA fix: seta usual-country e residential-country por id, native selectOption ---
async function trySet(order, label, value) {
  const countrySel = facts.filter((f) => f.country && f.visible);
  const f = countrySel[order];
  if (!f) { console.log(`\n[order ${order}] nenhum select de pais visivel`); return; }
  const loc = f.id ? pg.locator('[id="' + f.id + '"]') : pg.locator('select[name="' + f.name + '"]');
  const opt = await loc.evaluate((el, v) => { const V = String(v).toUpperCase(); return [...el.options].map((o) => o.text.replace(/\s+/g, " ").trim()).find((t) => t.toUpperCase() === V) || null; }, value);
  console.log(`\n[order ${order}] alvo=${label} id="${f.id}" name="${f.name}" opt="${opt}"`);
  let ok = false, how = "";
  try { await loc.selectOption({ label: opt }, { timeout: 2500 }); how = "native"; ok = true; } catch (e) { how = "native-FAIL:" + e.message.split("\n")[0].slice(0, 60); }
  await pg.waitForTimeout(400);
  let now = await loc.evaluate((el) => el.options[el.selectedIndex]?.text.trim() || "");
  if (now !== opt) {
    // fallback evaluate multi-evento
    await loc.evaluate((el, m) => { const o = [...el.options].find((x) => x.text.replace(/\s+/g, " ").trim() === m); if (o) { el.value = o.value; for (const ev of ["input", "change", "blur"]) el.dispatchEvent(new Event(ev, { bubbles: true })); } }, opt);
    await pg.waitForTimeout(400);
    now = await loc.evaluate((el) => el.options[el.selectedIndex]?.text.trim() || "");
    how += " + evalFallback";
  }
  console.log(`   -> how=${how} | valorAgora="${now}" | STICK=${now === opt ? "SIM" : "NAO"}`);
}
await trySet(0, "Usual country of residence", "BRAZIL");
await trySet(1, "Residential country", "BRAZIL");

await pg.screenshot({ path: "artifacts/diag-p7.png", fullPage: true }).catch(() => {});
console.log("\nheading final:", (await heading()).slice(0, 70));
await b.close();
