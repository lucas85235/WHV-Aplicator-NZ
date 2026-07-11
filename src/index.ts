import { loadConfig } from "./config.js";
import { rehearsal, live } from "./runner.js";
import { monitor } from "./monitor.js";
import { validateDocuments } from "./documents.js";
import { openSession } from "./browser.js";
import { autoLogin } from "./login.js";
import { log } from "./log.js";

function printHelp(): void {
  console.log(`
WHV Aplicator — bot de aplicacao WHV 462 (ImmiAccount)

Uso: npm run <comando>

  chrome       Mostra como abrir o Chrome com debugging
  login        Testa o login automatico (usuario/senha + codigo TOTP 2FA)
  rehearsal    Ensaia: navega a app salva ate o gate (NAO submete)
  live         Dia D: hot-path ate o pagamento
  monitor      Vigia abertura de vagas e alerta
  prepare:app  Checa documentos e prepara a Fase A
  codegen      playwright codegen (calibrar seletores na app real)

Antes: copie config/secrets.example.json -> config/secrets.local.json e preencha.
`);
}

function printChromeHelp(): void {
  console.log(`
1) Feche o Chrome. Abra um Chrome dedicado com debugging (PowerShell):

   & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" \`
     --remote-debugging-port=9222 \`
     --user-data-dir="C:\\Users\\lucas\\whv-chrome"

2) Nesse Chrome, faca LOGIN manual no ImmiAccount (e 2FA, se houver).
3) Deixe a aba na sua aplicacao salva.
4) Rode:  npm run rehearsal   (ou  npm run live  no dia)

O bot anexa a esse Chrome via CDP (porta 9222) e usa a sua sessao logada.
`);
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
    case "login": {
      const s = await openSession(cfg.runtime);
      await autoLogin(s.page, cfg);
      break;
    }
    case "monitor":
      await monitor(cfg);
      break;
    case "prepare":
      validateDocuments(cfg)
        ? log.info("Documentos OK. Siga a Fase A do PLANO.md.")
        : log.error("Corrija os documentos em config/documents.json.");
      break;
    case "docs":
      validateDocuments(cfg);
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
