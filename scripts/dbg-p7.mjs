import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const info = await pg.evaluate(() => {
  const isC = (s) => [...s.options].some((o) => /BRAZIL|AFGHANISTAN/i.test(o.text));
  const disp = (el) => { let n = el; while (n) { if (getComputedStyle(n).display === "none") return true; n = n.parentElement; } return false; };
  return [...document.querySelectorAll("select")].map((s, i) => ({ i, id: s.id, name: (s.name || "").slice(0, 24), country: isC(s), hidden: disp(s), val: s.options[s.selectedIndex]?.text.trim() || "" })).filter((x) => x.country);
});
console.log("SELECTS DE PAIS na pag 7 (todos):");
info.forEach((x) => console.log("  ", JSON.stringify(x)));
for (const lbl of ["Country", "Usual country of residence", "Country of residence", "residence"]) {
  const c = await pg.getByLabel(lbl, { exact: false }).count();
  console.log(`getByLabel("${lbl}") -> ${c} matches`);
}
await b.close();
