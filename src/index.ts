import { loadConfig } from "./config.js";
import { rehearsal, live, watch, scan, probe, assist } from "./runner.js";
import { validateDocuments } from "./documents.js";
import { openSession } from "./browser.js";
import { login } from "./nz/login.js";
import { msUntilOpening } from "./nz/gate.js";
import { log } from "./log.js";

function printHelp(): void {
  console.log(`
WHV Aplicator NZ - bot de inscricao no Working Holiday Visa da Nova Zelandia
(esquema Brasil: 300 vagas, abre 08 Out 2026 10:00 NZDT = 07 Out 17:00 Manaus)

Uso: npm run <comando>

  chrome       Como abrir o Chrome com debugging (o bot anexa nele)
  login        Testa o login no portal WHS do INZ
  rehearsal    Ensaio: loga, checa o estado da cota e varre a tela (nao aplica)
  scan         Calibracao: salva os campos da tela atual em artifacts/scan-*.json
  watch        So vigia a abertura e dispara alarme + push (nao preenche)
  assist       DIA D (recomendado): voce navega/captcha, o bot preenche cada tela na hora
  live         Automatico total (NAO usar: detecao de abertura nao calibrada)
  when         Mostra quanto falta pra abertura
  docs         Confere os arquivos de config/documents.json
  probe        TESTE ao vivo em outro esquema (so observa, nunca submete)

Antes: copie config/secrets.example.json -> config/secrets.local.json e preencha.
`);
}

function printChromeHelp(): void {
  console.log(`
1) Feche o Chrome. Abra um Chrome dedicado com debugging (PowerShell):

   & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" \`
     --remote-debugging-port=9222 \`
     --user-data-dir="C:\\Users\\lucas\\whv-nz-chrome"

   (ou simplesmente: npm run open)

2) Nesse Chrome, faca LOGIN no portal WHS do INZ:
   https://onlineservices.immigration.govt.nz/secure/Login+Working+Holiday.htm
3) Deixe a janela aberta e quieta.
4) Rode:  npm run rehearsal  (ensaio)  ou  npm run live  (dia D)

O bot anexa a esse Chrome via CDP (porta 9222) e usa a SUA sessao logada -
por isso ele nao aparece como trafego de robo pro WAF do INZ.
`);
}

function printWhen(iso: string | null, ms: number | null): void {
  if (ms == null) {
    console.log(`\nrutime.opening.isoUtc nao configurado (config/runtime.json).\n`);
    return;
  }
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const local = iso ? new Date(iso).toLocaleString() : "?";
  console.log(
    `\nAbertura (UTC):  ${iso}\nNo seu horario:  ${local}\n${ms > 0 ? "Faltam" : "Passou ha"}: ${d}d ${h}h ${m}min\n`,
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "help";
  if (cmd === "help" || cmd === "--help" || cmd === "-h") return printHelp();
  if (cmd === "chrome") return printChromeHelp();

  const cfg = await loadConfig();

  switch (cmd) {
    case "rehearsal":
      await rehearsal(cfg);
      break;
    case "live":
      await live(cfg);
      break;
    case "watch":
      await watch(cfg);
      break;
    case "assist":
      await assist(cfg);
      break;
    case "scan":
      await scan(cfg);
      break;
    case "probe": {
      // npm run probe -- --scheme=peru --at=2026-09-30T21:00:00Z
      const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
      await probe(cfg, arg("scheme") ?? "peru", arg("at") ?? "2026-09-30T21:00:00Z");
      break;
    }
    case "when":
      printWhen(cfg.runtime.opening.isoUtc, msUntilOpening(cfg));
      break;
    case "login": {
      const s = await openSession(cfg.runtime);
      try {
        await login(s.page, cfg);
      } finally {
        await s.close();
      }
      break;
    }
    case "docs":
      validateDocuments(cfg) ? log.info("Documentos OK.") : log.warn("Faltam documentos (ver acima).");
      break;
    default:
      log.error({ cmd }, "comando desconhecido");
      printHelp();
  }
}

main().catch((e: unknown) => {
  log.error({ err: e instanceof Error ? e.stack : String(e) }, "execucao falhou");
  process.exitCode = 1;
});
