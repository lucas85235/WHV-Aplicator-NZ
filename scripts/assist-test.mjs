// Teste ponta-a-ponta do `assist` contra um portal FALSO servido no proprio
// dominio do INZ (interceptado - nenhuma requisicao sai pra internet).
// Simula voce: resolve o captcha, marca a declaracao, clica Submit.
// Chrome isolado na porta 9333 - nao toca no Chrome do bot (9222).
// Uso: npm run assist-test
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { assist } from "../dist/src/assist.js";

const BASE = "https://onlineservices.immigration.govt.nz";
const opt = (xs) => xs.map((x) => `<option>${x}</option>`).join("");
const dias = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
const meses = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const anos = Array.from({ length: 61 }, (_, i) => String(1950 + i));
const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

const PAGES = {
  "/WorkingHoliday/": page("Working Holiday Visa Application Forms",
    `<p>Existing Applications</p><a href="${BASE}/rs-captcha?redirect=%2FWorkingHoliday%2FWizard%2FPersonal1.aspx">Edit</a> <a href="#">Delete</a>`),
  "/rs-captcha": page("Please complete the CAPTCHA",
    `<p>This section must be completed before you can submit the application.</p>
     <form action="${BASE}/WorkingHoliday/Wizard/Personal1.aspx" method="get">
       <input name="captcha" id="cap"> <input type="submit" value="SUBMIT"></form>`),
  "/WorkingHoliday/Wizard/Personal1.aspx": page("Personal details",
    `<form action="${BASE}/WorkingHoliday/Wizard/Personal2.aspx" method="get">
      <label for="fam">Family name *</label><input id="fam" name="fam">
      <label for="giv">Given name(s) *</label><input id="giv" name="giv">
      <fieldset><legend>Date of birth *</legend>
        <label for="dd">Date of birth day</label><select id="dd" name="dd"><option>--</option>${opt(dias)}</select>
        <label for="mm">Date of birth month</label><select id="mm" name="mm"><option>--</option>${opt(meses)}</select>
        <label for="yy">Date of birth year</label><select id="yy" name="yy"><option>--</option>${opt(anos)}</select>
      </fieldset>
      <fieldset><legend>Gender</legend>
        <input type="radio" name="sex" id="sm" value="M"><label for="sm">Male</label>
        <input type="radio" name="sex" id="sf" value="F"><label for="sf">Female</label></fieldset>
      <fieldset><legend>Are you paying by credit card?</legend>
        <select name="paycc" id="paycc"><option>--</option><option>Yes</option><option>No</option></select></fieldset>
      <input type="submit" value="Submit application" style="float:right">
      <input type="submit" value="Next"></form>`),
  "/WorkingHoliday/Wizard/Personal2.aspx": page("Identification",
    `<form action="${BASE}/WorkingHoliday/Wizard/Health.aspx" method="get">
      <label for="pn">Passport number *</label><input id="pn" name="pn">
      <label for="em">Email address *</label><input id="em" name="em">
      <input type="submit" value="Next"></form>`),
  "/WorkingHoliday/Wizard/Health.aspx": page("Health",
    `<form action="${BASE}/WorkingHoliday/Wizard/Declaration.aspx" method="get">
      <fieldset><legend>Have you ever had tuberculosis?</legend>
        <select name="tb" id="tb"><option>--</option><option>Yes</option><option>No</option></select></fieldset>
      <fieldset><legend>Have you spent more than 3 months in a country where tuberculosis is common?</legend>
        <select name="tbc" id="tbc"><option>--</option><option>Yes</option><option>No</option></select></fieldset>
      <fieldset><legend>Have you ever been convicted of any offence?</legend>
        <select name="conv" id="conv"><option>--</option><option>Yes</option><option>No</option></select></fieldset>
      <input type="submit" value="Next"></form>`),
  "/WorkingHoliday/Wizard/Declaration.aspx": page("Declaration",
    `<form action="https://sec.windcave.com/pxmi3/pay" method="get">
      <input type="checkbox" id="d1" name="d1"><label for="d1">I declare that the information given is true and correct</label>
      <label for="note">Additional notes</label><input id="note" name="note">
      <input type="submit" value="Submit application"></form>`),
};
const PAY = page("Payment",
  `<label for="cn">Card number</label><input id="cn"><label for="ch">Cardholder name</label><input id="ch">
   <label for="ex">Expiry date (MM/YY)</label><input id="ex"><label for="cv">CVV</label><input id="cv"><button>Pay now</button>`);

// ---------------------------------------------------------------------------
const log = []; // [t, path, query]
const t0 = Date.now();
const browser = await chromium.launch({ args: ["--remote-debugging-port=9333"] });
const ctx = await browser.newContext();
await ctx.route("**/*", (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === "sec.windcave.com") {
    log.push([Date.now() - t0, "PAY", u.search]);
    return route.fulfill({ contentType: "text/html", body: PAY });
  }
  if (u.hostname !== "onlineservices.immigration.govt.nz") return route.abort();
  log.push([Date.now() - t0, u.pathname, u.search]);
  const body = PAGES[u.pathname];
  return body ? route.fulfill({ contentType: "text/html", body }) : route.fulfill({ status: 404, body: "nf" });
});
const p = await ctx.newPage();
await p.goto(`${BASE}/WorkingHoliday/`);

// assist roda no mesmo processo, anexado ao Chrome de teste (9333), sem cartao real
const cfg = await loadConfig();
cfg.runtime.browser.mode = "attach-cdp";
cfg.runtime.browser.cdp.port = 9333;
cfg.runtime.payment.alarm = false;
cfg.runtime.flow.screenshotMode = "off";
cfg.runtime.artifactsDir = "./artifacts/assist-test";
cfg.secrets = { ...(cfg.secrets ?? {}), card: { holderName: "TEST USER", number: "4111111111111111", expiry: "12/30", cvv: "123" }, notify: undefined };
assist(cfg).catch((e) => console.log("assist morreu:", e));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await fn()) return true; await wait(50); } return false; };
await wait(1500);

// HUMANO: clica Edit
await p.click("text=Edit");
await until(() => p.url().includes("rs-captcha"));
// Espera 3s: o bot NAO pode clicar SUBMIT no captcha
await wait(3000);
const botMexeuNoCaptcha = log.some(([, path, q]) => path.includes("Personal1") && !q.includes("HUMANO"));
// HUMANO: resolve o captcha
await p.fill("#cap", "HUMANO");
const tCaptcha = Date.now() - t0;
await p.click("input[value=SUBMIT]");

// BOT: deve preencher e avancar sozinho ate a Declaracao
const chegouDecl = await until(() => p.url().includes("Declaration.aspx"), 20000);
const tDecl = Date.now() - t0;
await wait(3000); // o bot NAO pode marcar declaracao nem clicar Submit
const declMarcadaPeloBot = await p.isChecked("#d1").catch(() => null);
const botSubmeteu = log.some(([, path]) => path === "PAY");
// HUMANO: marca e submete
await p.check("#d1");
await p.click("input[value='Submit application']");
const chegouPay = await until(() => p.url().includes("windcave"), 10000);
await until(async () => (await p.inputValue("#cn").catch(() => "")) !== "", 8000);
const cartao = await p.inputValue("#cn").catch(() => "");

// ---- resultado ----
const q = (path) => new URLSearchParams((log.find(([, pp]) => pp.includes(path)) ?? [, , ""])[2]);
const p2 = q("Personal2"), hl = q("Declaration");
const checks = [
  ["bot nao mexeu no captcha", !botMexeuNoCaptcha],
  ["chegou na declaracao sozinho", chegouDecl],
  ["sobrenome", p2.get("fam") === "De Souza Lima"],
  ["nome", p2.get("giv") === "Lucas"],
  ["dia de nascimento (dropdown)", p2.get("dd") === "08"],
  ["mes de nascimento (dropdown)", p2.get("mm") === "May"],
  ["ano de nascimento (dropdown)", p2.get("yy") === "2000"],
  ["sexo", p2.get("sex") === "M"],
  ["'paying by credit card' NAO virou tela de pagamento", p2.get("paycc") === "Yes"],
  ["NAO clicou 'Submit application' persistente da tela 1", !log.some(([, path]) => path.includes("Declaration") && log.findIndex(([, x]) => x.includes("Personal2")) === -1)],
  ["passaporte", q("Health").get("pn") === "GI914400"],
  ["tuberculose: ja teve -> No", hl.get("tb") === "No"],
  ["tuberculose: pais de risco -> Yes", hl.get("tbc") === "Yes"],
  ["condenacao -> No", hl.get("conv") === "No"],
  ["bot NAO marcou declaracao", declMarcadaPeloBot === false],
  ["bot NAO submeteu", !botSubmeteu],
  ["humano chegou no pagamento", chegouPay],
  ["cartao preenchido no checkout", cartao === "4111111111111111"],
];
console.log("\n--- caminho percorrido ---");
for (const [t, path, qs] of log) console.log(`  ${String(t).padStart(6)}ms  ${path}${qs ? "  " + qs.slice(0, 90) : ""}`);
console.log("\n--- checagens ---");
for (const [n, ok] of checks) console.log(`  [${ok ? "OK " : "FALHOU"}] ${n}`);
console.log(`\ncaptcha resolvido -> declaracao (3 telas): ${tDecl - tCaptcha}ms`);
const falhas = checks.filter(([, ok]) => !ok).length;
console.log(`${checks.length - falhas}/${checks.length} passaram`);
await browser.close();
process.exit(falhas ? 1 : 0);
