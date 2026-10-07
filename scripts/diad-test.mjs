// ENSAIO DO DIA D contra um portal FALSO no proprio dominio do INZ (interceptado -
// nenhuma requisicao sai pra internet). Chrome isolado na porta 9333 (nao toca o seu).
//
// Cenario: aba comeca na pagina do CANADA (aberta, com APPLY NOW - o bot NUNCA pode
// clicar). Brasil fechado ate T (7s). Bot tem que: voltar pra grade -> Brasil ->
// refresh -> clicar APPLY NOW do Brasil quando abrir. Depois voce (o teste) resolve o
// captcha, MEXE na tela 2 e o bot tem que respeitar.
// Uso: npm run diad-test
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { assist } from "../dist/src/assist.js";

const BASE = "https://onlineservices.immigration.govt.nz";
const T = Date.now() + 7000; // "17:00" do teste
const APP = "ApplicationId=777&IndividualType=Primary&IndividualIndex=1";
const html = (title, body) =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
const status = (pais, aberto, cid) =>
  html(pais.toUpperCase(),
    `<p>Working Holiday Scheme status for ${pais}: ${aberto ? "Scheme is available" : "There is no scheme open for this country."}</p>` +
    (aberto
      ? `<p>By clicking the Apply Now button you confirm that you have read and accepted the Terms and Conditions.</p>
         <form method="post" action="./Create.aspx?CountryId=${cid}&OffShore=1&STZ=0">
           <input type="submit" id="ContentPlaceHolder1_applyNowButton" value="APPLY NOW"></form>`
      : "") +
    `<p>To return to the Working Holiday Homepage click <a href="../">here</a>.</p>`);

const PAGES = {
  "/WorkingHoliday/": () =>
    html("Working Holiday", `<p>Only passport holders from the countries below can use this service:</p>
      <a href="${BASE}/WorkingHoliday/Application/Create.aspx?CountryId=4&OffShore=1&STZ=0">ARGENTINA<br>CLOSED</a>
      <a href="${BASE}/WorkingHoliday/Application/Create.aspx?CountryId=40&OffShore=1&STZ=0">CANADA<br>OPEN</a>
      <a href="${BASE}/WorkingHoliday/Application/Create.aspx?CountryId=29&OffShore=1&STZ=0">BRAZIL<br>${Date.now() >= T ? "OPEN" : "CLOSED"}</a>`),
  "/rs-captcha": () =>
    html("Please complete the CAPTCHA",
      `<p>This section must be completed before you can submit the application.</p>
       <form action="${BASE}/WorkingHoliday/Wizard/Personal1.aspx" method="get">
         <input type="hidden" name="ApplicationId" value="777">
         <input name="captcha" id="cap"> <input type="submit" value="SUBMIT"></form>`),
  "/WorkingHoliday/Wizard/Personal1.aspx": () =>
    html("Personal details",
      `<form action="${BASE}/WorkingHoliday/Wizard/Personal2.aspx" method="get"><input type="hidden" name="ApplicationId" value="777">
        <label for="fam">Family name (as in passport)</label><input id="fam" name="fam" value="Lima">
        <label for="giv">Given name 1 (as in passport)</label><input id="giv" name="giv">
        <label for="dob">Date of birth</label><input id="dob" name="dob">
        <label for="cob">Country of birth</label><select id="cob" name="cob"><option></option><option>Brazil</option><option>Peru</option></select>
        <input type="submit" value="SAVE"> <input type="submit" value="Next"></form>`),
  "/WorkingHoliday/Wizard/Personal2.aspx": () =>
    html("Identification",
      `<p>Citizenship of Passport Brazil</p>
       <form action="${BASE}/WorkingHoliday/Wizard/Medical1.aspx" method="get"><input type="hidden" name="ApplicationId" value="777">
        <label for="pn">Passport Number</label><input id="pn" name="pn">
        <label for="mm">Mother's maiden name *</label><input id="mm" name="mm" required>
        <input type="checkbox" id="rev" onclick="document.getElementById('extra').style.display='block'"><label for="rev">Show more</label>
        <div id="extra" style="display:none"><label for="ex">Extra notes</label><input id="ex" name="ex"></div>
        <input type="submit" value="Next"></form>`),
  "/WorkingHoliday/Wizard/Medical1.aspx": () =>
    html("Health",
      `<form action="${BASE}/WorkingHoliday/Wizard/Declaration.aspx" method="get"><input type="hidden" name="ApplicationId" value="777">
        <label for="tb">Do you have active tuberculosis (TB)?</label><select id="tb" name="tb"><option></option><option>No</option><option>Yes</option></select>
        <label for="tbr">In the five years prior to this application, have you spent (lived in and/or visited) a combined total of 3 months in any country or countries NOT considered to be low risk for TB .</label>
        <select id="tbr" name="tbr"><option></option><option>No</option><option>Yes</option></select>
        <input type="submit" value="Next"></form>`),
  "/WorkingHoliday/Wizard/Declaration.aspx": () =>
    html("Declaration",
      `<form action="https://sec.windcave.com/pxmi3/pay" method="get">
        <input type="checkbox" id="d1" name="d1"><label for="d1">I declare that the information given is true and correct</label>
        <input type="submit" value="Submit application"></form>`),
};
const PAY = html("Payment",
  `<label for="cn">Card number</label><input id="cn"><label for="ch">Cardholder name</label><input id="ch">
   <label for="cv">CVV</label><input id="cv"><button>Pay now</button>`);

// ---------------------------------------------------------------------------
const log = []; // [msRelativoAT, metodo, caminho, query]
const VAZOU = [];
const browser = await chromium.launch({ args: ["--remote-debugging-port=9333"] });
const ctx = await browser.newContext();
await ctx.route("**/*", async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  const t = Date.now() - T;
  if (u.hostname === "sec.windcave.com") {
    log.push([t, "GET", "PAY", u.search]);
    return route.fulfill({ contentType: "text/html", body: PAY, headers: { "x-whv-fake": "1" } });
  }
  if (u.hostname !== "onlineservices.immigration.govt.nz") return route.abort();
  log.push([t, req.method(), u.pathname, u.search]);
  if (u.pathname.endsWith("/Create.aspx")) {
    const cid = u.searchParams.get("CountryId");
    if (req.method() === "POST") {
      if (cid === "29" && Date.now() >= T) {
        // NAO usar 302: o Playwright nao intercepta o pedido redirecionado e ele iria pro INZ REAL.
        const alvo = `${BASE}/rs-captcha?redirect=%2FWorkingHoliday%2FWizard%2FPersonal1.aspx%3F${encodeURIComponent(APP)}`;
        return route.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(alvo)})</script>`, headers: { "x-whv-fake": "1" } });
      }
      return route.fulfill({ contentType: "text/html", body: html("ERRO", "<p>apply indevido</p>"), headers: { "x-whv-fake": "1" } });
    }
    const pais = cid === "29" ? "Brazil" : cid === "40" ? "Canada" : "Argentina";
    const aberto = cid === "40" || (cid === "29" && Date.now() >= T);
    return route.fulfill({ contentType: "text/html", body: status(pais, aberto, cid), headers: { "x-whv-fake": "1" } });
  }
  const fn = PAGES[u.pathname];
  return fn ? route.fulfill({ contentType: "text/html", body: fn(), headers: { "x-whv-fake": "1" } }) : route.fulfill({ status: 404, body: "nf", headers: { "x-whv-fake": "1" } });
});
// trava: nenhuma resposta pode vir da internet real
ctx.on("response", (r) => { if (!r.fromServiceWorker() && r.status() !== 0 && !r.request().url().startsWith("data:") && r.headers()["x-whv-fake"] !== "1" && /immigration\.govt\.nz|windcave/.test(r.url())) VAZOU.push(r.url()); });
const p = await ctx.newPage();
await p.goto(`${BASE}/WorkingHoliday/Application/Create.aspx?CountryId=40&OffShore=1&STZ=0`); // CANADA aberto

const cfg = await loadConfig();
cfg.runtime.browser.mode = "attach-cdp";
cfg.runtime.browser.cdp.port = 9333;
cfg.runtime.opening.isoUtc = new Date(T).toISOString();
cfg.runtime.payment.alarm = false;
cfg.runtime.flow.screenshotMode = "off";
cfg.runtime.artifactsDir = "./artifacts/diad-test";
cfg.secrets = { ...(cfg.secrets ?? {}), card: { holderName: "TEST USER", number: "4111111111111111", expiry: "12/30", cvv: "123" }, notify: undefined, login: {} };
assist(cfg, { entrada: true }).catch((e) => console.log("assist morreu:", String(e).split("\n")[0]));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await fn().catch(() => false)) return true; await wait(50); } return false; };

// 1) bot sai do Canada, vai pro Brasil e espera abrir
const chegouCaptcha = await until(async () => p.url().includes("rs-captcha"), 25000);
await wait(2500); // bot nao pode mexer no captcha
const applyBrasil = log.find(([, m, path, q]) => m === "POST" && path.endsWith("Create.aspx") && q.includes("CountryId=29"));
const applyCanada = log.some(([, m, path, q]) => m === "POST" && q.includes("CountryId=40"));
const refreshesBrasil = log.filter(([, m, path, q]) => m === "GET" && path.endsWith("Create.aspx") && q.includes("CountryId=29")).length;
const botNoCaptcha = log.some(([, , path]) => path.includes("Personal1"));

// 2) VOCE resolve o captcha
await p.fill("#cap", "HUMANO");
await p.click("input[value=SUBMIT]");

// 3) bot preenche Personal1 e avanca; Personal2 tem campo sem regra -> nao avanca
const naP2 = await until(async () => p.url().includes("Personal2"), 15000);
await wait(1200);
// VOCE mexe: rola, clica, corrige o passaporte e abre um campo extra (muda a tela)
await p.mouse.wheel(0, 300);
await p.click("#pn");
await p.keyboard.press("Control+A");
await p.keyboard.type("X0000000");
await p.click("#rev");
await wait(2500); // o bot NAO pode reescrever nem avancar
const pnDepois = await p.inputValue("#pn");
const exDepois = await p.inputValue("#ex");
const avancouSozinhoP2 = log.some(([, , path]) => path.includes("Medical1"));
await p.click("#mm");
await p.keyboard.type("Silva");
const tNextHumano = Date.now() - T;
await p.click("input[value=Next]");

// 4) Health: bot preenche e avanca sozinho; para na declaracao
const naDecl = await until(async () => p.url().includes("Declaration"), 15000);
await wait(2500);
const declMarcada = await p.isChecked("#d1").catch(() => null);
const botSubmeteu = log.some(([, , path]) => path === "PAY");
await p.check("#d1");
await p.click("input[value='Submit application']");
await until(async () => (await p.inputValue("#cn")) !== "", 10000);
const cartao = await p.inputValue("#cn").catch(() => "");

// ---- resultado ----
const q = (path) => new URLSearchParams((log.find(([, , pp]) => pp.includes(path)) ?? [, , , ""])[3]);
const p2 = q("Personal2"), med = q("Medical1"), decl = q("Declaration");
const reqMedical = log.find(([, , path]) => path.includes("Medical1"));
const checks = [
  ["NENHUMA requisicao chegou no INZ real", VAZOU.length === 0],
  ["NUNCA clicou Apply Now do Canada", !applyCanada],
  ["clicou Apply Now do Brasil", !!applyBrasil],
  ["...e so DEPOIS de abrir", !!applyBrasil && applyBrasil[0] >= 0],
  ["chegou no captcha", chegouCaptcha],
  ["bot nao mexeu no captcha", !botNoCaptcha],
  ["sobrenome corrigido pro do passaporte (force)", p2.get("fam") === "De Souza Lima"],
  ["data no formato do INZ", p2.get("dob") === "8 May, 2000"],
  ["pais de nascimento", p2.get("cob") === "Brazil"],
  ["tela 2: NAO avancou com campo sem resposta", naP2 && !avancouSozinhoP2],
  ["tela 2: NAO reescreveu o que VOCE digitou", pnDepois === "X0000000"],
  ["tela 2: NAO preencheu campo depois que voce mexeu", exDepois === ""],
  ["tela 2: avancou so quando VOCE clicou Next", !!reqMedical && reqMedical[0] >= tNextHumano],
  ["seu valor foi enviado", med.get("pn") === "X0000000"],
  ["TB ativa -> No", decl.get("tb") === "No"],
  ["TB 5 anos pais nao-baixo-risco -> Yes", decl.get("tbr") === "Yes"],
  ["parou na declaracao", naDecl],
  ["bot NAO marcou declaracao", declMarcada === false],
  ["bot NAO submeteu", !botSubmeteu],
  ["cartao preenchido no checkout", cartao === "4111111111111111"],
];
console.log("\n--- linha do tempo (ms em relacao a abertura) ---");
for (const [t, m, path, qs] of log) console.log(`  ${String(t).padStart(7)}  ${m.padEnd(4)} ${path}${qs ? "  " + qs.slice(0, 80) : ""}`);
console.log("\n--- checagens ---");
for (const [n, ok] of checks) console.log(`  [${ok ? "OK " : "FALHOU"}] ${n}`);
console.log(`\nrefreshes da pagina do Brasil: ${refreshesBrasil}`);
console.log(`APPLY NOW do Brasil: ${applyBrasil ? applyBrasil[0] + "ms depois da abertura" : "nunca"}`);
const falhas = checks.filter(([, ok]) => !ok).length;
console.log(`${checks.length - falhas}/${checks.length} passaram`);
await browser.close();
process.exit(falhas ? 1 : 0);
