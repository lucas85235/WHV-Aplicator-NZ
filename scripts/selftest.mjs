// Auto-teste do motor generico: monta um formulario FAKE parecido com o do INZ,
// roda scan + livro de respostas + preenchimento, compara os modos fast/safe e
// mede o tempo de cada um. Uso: npm run selftest
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { scanPage } from "../dist/src/form/scan.js";
import { resolveFields, applyValue, haystack } from "../dist/src/form/answer.js";
import { toBatch, fastApply } from "../dist/src/form/fastfill.js";
import { settle, waitForChange, pageSig, armNavigation } from "../dist/src/form/wait.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { classify } from "../dist/src/form/walk.js";

const HTML = `<!doctype html><html><body>
<h1>Personal details</h1>
<form>
  <label for="fam">Family name *</label><input id="fam" name="familyName">
  <label for="giv">Given names *</label><input id="giv" name="givenNames">
  <label for="dob">Date of birth (DD/MM/YYYY) *</label><input id="dob" name="dob">
  <fieldset><legend>Sex</legend>
    <input type="radio" id="m" name="sex" value="M"><label for="m">Male</label>
    <input type="radio" id="f" name="sex" value="F"><label for="f">Female</label>
  </fieldset>
  <label for="cob">Country of birth *</label>
  <select id="cob" name="cob"><option>Please select</option><option>Brazil</option><option>New Zealand</option></select>
  <label for="pno">Passport number *</label><input id="pno" name="passportNumber">
  <label for="pexp">Passport expiry date *</label><input id="pexp" name="passportExpiry">
  <label for="em">Email address *</label><input id="em" name="email" type="email">
  <label for="mob">Mobile phone</label><input id="mob" name="mobile">
  <label for="addr">Address line 1 *</label><input id="addr" name="address1">
  <label for="city">City/Town *</label><input id="city" name="city">
  <label for="pc">Postcode</label><input id="pc" name="postcode">
  <label for="ctry">Country *</label>
  <select id="ctry" name="country"><option>Please select</option><option>Brazil</option><option>Australia</option></select>

  <h2>Health</h2>
  <fieldset><legend>Have you ever had tuberculosis?</legend>
    <select id="h1" name="h1"><option>Please select</option><option>Yes</option><option>No</option></select>
  </fieldset>
  <fieldset><legend>Have you in the last 5 years spent more than 3 months in a country where tuberculosis is common?</legend>
    <select id="h3" name="h3"><option>Please select</option><option>Yes</option><option>No</option></select>
  </fieldset>
  <!-- reveal: so aparece quando h3 = Yes (simula postback do INZ) -->
  <div id="tbwrap" style="display:none">
    <label for="tbc">Which countries have you lived in?</label><input id="tbc" name="tbc">
  </div>
  <fieldset><legend>Do you intend to receive medical treatment in New Zealand?</legend>
    <select id="h2" name="h2"><option>Please select</option><option>Yes</option><option>No</option></select>
  </fieldset>

  <h2>Character</h2>
  <fieldset><legend>Have you ever been convicted of any offence?</legend>
    <input type="radio" id="c1y" name="c1"><label for="c1y">Yes</label>
    <input type="radio" id="c1n" name="c1"><label for="c1n">No</label>
  </fieldset>
  <fieldset><legend>Have you ever been deported or removed from any country?</legend>
    <input type="radio" id="c2y" name="c2"><label for="c2y">Yes</label>
    <input type="radio" id="c2n" name="c2"><label for="c2n">No</label>
  </fieldset>

  <h2>Working holiday specific</h2>
  <fieldset><legend>Do you have at least NZ$4,200 available for your stay?</legend>
    <input type="radio" id="f1y" name="f1"><label for="f1y">Yes</label>
    <input type="radio" id="f1n" name="f1"><label for="f1n">No</label>
  </fieldset>
  <fieldset><legend>Will you hold medical insurance for the whole of your stay?</legend>
    <input type="radio" id="i1y" name="i1"><label for="i1y">Yes</label>
    <input type="radio" id="i1n" name="i1"><label for="i1n">No</label>
  </fieldset>
  <fieldset><legend>Have you previously been granted a New Zealand working holiday visa?</legend>
    <input type="radio" id="w1y" name="w1"><label for="w1y">Yes</label>
    <input type="radio" id="w1n" name="w1"><label for="w1n">No</label>
  </fieldset>
  <label for="arr">Intended date of arrival in New Zealand *</label><input id="arr" name="arrival">
  <label for="adv">Are you using a licensed immigration adviser?</label>
  <select id="adv" name="adviser"><option>Please select</option><option>Yes</option><option>No</option></select>

  <h2>Declaration</h2>
  <input type="checkbox" id="d1"><label for="d1">I declare that the information given is true and correct</label>
  <input type="checkbox" id="d2"><label for="d2">I have read and understand the privacy statement</label>

  <button type="button">Save and continue</button>
</form>
<script>
  document.getElementById("h3").addEventListener("change", function () {
    document.getElementById("tbwrap").style.display = this.value === "Yes" ? "block" : "none";
  });
</script>
</body></html>`;

const cfg = await loadConfig();
const browser = await chromium.launch();
const page = await browser.newPage();

/** Preenche a tela com re-varreduras, como o walk faz. Retorna {ms, campos}. */
async function run(mode) {
  await page.setContent(HTML);
  const t0 = Date.now();
  let snap = await scanPage(page);
  let escritos = 0;
  const problemas = [];
  for (let pass = 0; pass < cfg.runtime.flow.maxFillPasses; pass++) {
    const res = resolveFields(snap.fields, cfg.answers);
    if (mode === "fast") {
      const { items, problems } = toBatch(res, true);
      problemas.push(...problems);
      if (!items.length) break;
      const out = await fastApply(page, items);
      escritos += out.applied;
      problemas.push(...out.problems);
    } else {
      let did = 0;
      for (const r of res) {
        if (r.value == null) continue;
        const out = await applyValue(page, r, { onlyIfEmpty: true });
        if (out.ok) {
          did += 1;
          escritos += 1;
        } else if (!/^ja /.test(out.why)) problemas.push(`${r.ruleId}: ${out.why}`);
      }
      if (!did) break;
    }
    await settle(page, 300);
    snap = await scanPage(page);
  }
  const ms = Date.now() - t0;
  const estado = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter((e) => e.type !== "hidden")
      .map((e) => {
        const id = e.id || e.name;
        if (e.type === "radio" || e.type === "checkbox") return e.checked ? `${id}=on` : null;
        return e.value ? `${id}=${e.value}` : null;
      })
      .filter(Boolean)
      .sort()
      .join(" | "),
  );
  const semResposta = resolveFields(snap.fields, cfg.answers)
    .filter((r) => r.value == null)
    .map((r) => haystack(r.field).slice(0, 80));
  return { ms, escritos, estado, semResposta, problemas };
}

const fast = await run("fast");
const safe = await run("safe");

console.log(`\nfast: ${fast.ms}ms | ${fast.escritos} campos escritos`);
console.log(`safe: ${safe.ms}ms | ${safe.escritos} campos escritos`);
console.log(`ganho: ${(safe.ms / Math.max(fast.ms, 1)).toFixed(1)}x mais rapido (${safe.ms - fast.ms}ms por tela)`);
console.log(`\nmesmo resultado nos dois modos: ${fast.estado === safe.estado ? "SIM" : "NAO <-- PROBLEMA"}`);
if (fast.estado !== safe.estado) {
  console.log("  fast:", fast.estado);
  console.log("  safe:", safe.estado);
}
console.log("\n--- estado final do formulario ---");
for (const kv of fast.estado.split(" | ")) console.log("  " + kv);
if (fast.semResposta.length) {
  console.log("\n--- SEM RESPOSTA (ajustar answers.json) ---");
  fast.semResposta.forEach((s) => console.log("  " + s));
}
if (fast.problemas.length) {
  console.log("\n--- PROBLEMAS (fast) ---");
  [...new Set(fast.problemas)].forEach((s) => console.log("  " + s));
}
// ---- regressoes de classificacao de tela ----
const casos = [];
async function caso(nome, html, esperado) {
  await page.setContent(html);
  const snap = await scanPage(page);
  const got = classify(snap);
  casos.push({ nome, esperado, got, ok: got === esperado });
}

// Bug real: a secao Personal do INZ pergunta "are you paying by credit card?".
// Classificar por texto fazia o bot achar que ja estava no pagamento na 1a tela.
await caso(
  "tela Personal com pergunta sobre cartao NAO e pagamento",
  `<h1>Personal details</h1><form>
    <label for="a">Family name</label><input id="a">
    <fieldset><legend>Are you paying by credit card?</legend>
      <input type="radio" id="py" name="pay"><label for="py">Yes</label>
      <input type="radio" id="pn" name="pay"><label for="pn">No</label>
    </fieldset></form>`,
  null,
);
await caso(
  "checkout de verdade E pagamento",
  `<h1>Payment</h1><form>
    <label for="cn">Card number</label><input id="cn">
    <label for="ch">Cardholder name</label><input id="ch">
    <label for="cv">CVV</label><input id="cv"></form>`,
  "payment",
);
await caso(
  "tela de cota cheia e closed",
  `<h1>Working holiday</h1><p>The quota is full. The scheme will reopen in 2027.</p>`,
  "closed",
);

// Bug real: postback recarrega a MESMA tela -> assinatura identica -> o bot
// esperava o teto inteiro (15s). Tem que voltar em menos de 1s.
const fixture = resolve(tmpdir(), "whv-postback.html");
writeFileSync(fixture, `<h1>Form</h1><input id="x"><button id="b">Save</button>`);
await page.goto(pathToFileURL(fixture).href);
const sigAntes = await pageSig(page);
const nav = armNavigation(page);
await page.evaluate(() => setTimeout(() => location.reload(), 50));
const msPostback = await waitForChange(page, sigAntes, 15000, nav);
casos.push({
  nome: "postback na mesma tela nao trava a espera",
  esperado: "< 3000ms",
  got: `${msPostback}ms`,
  ok: msPostback < 3000,
});

// Clique num botao que nao faz nada: tem que devolver rapido, nao esperar o teto.
await page.setContent(`<h1>Form</h1><input id="x"><button id="b">Save</button>`);
const sigParado = await pageSig(page);
const navParado = armNavigation(page);
const msParado = await waitForChange(page, sigParado, 15000, navParado);
casos.push({
  nome: "clique sem efeito devolve rapido (nao espera o teto)",
  esperado: "< 4000ms",
  got: `${msParado}ms`,
  ok: msParado < 4000,
});

console.log("\n--- regressoes ---");
for (const c of casos) console.log(`  [${c.ok ? "OK " : "FALHOU"}] ${c.nome} (esperado: ${c.esperado}, veio: ${c.got})`);
const falhas = casos.filter((c) => !c.ok).length;
console.log(`\n${casos.length - falhas}/${casos.length} regressoes passaram`);

await browser.close();
if (falhas) process.exitCode = 1;
