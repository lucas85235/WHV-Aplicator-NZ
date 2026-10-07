// Grava as credenciais do portal WHS do INZ em config/secrets.local.json.
// A senha e digitada AQUI, no seu terminal, mascarada - nunca passa por chat,
// log ou git (config/*.local.json esta no .gitignore).
// Uso: npm run secrets
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const FILE = resolve(process.cwd(), "config", "secrets.local.json");
const EXAMPLE = resolve(process.cwd(), "config", "secrets.example.json");

function load() {
  const src = existsSync(FILE) ? FILE : EXAMPLE;
  if (!existsSync(src)) {
    console.error("nao achei config/secrets.example.json - rode a partir da raiz do projeto.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(src, "utf-8"));
}

function ask(prompt, { hidden = false } = {}) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = function (str) {
      if (this.stdoutMuted) this.output.write("*");
      else this.output.write(str);
    };
    rl.question(prompt, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      res(a.trim());
    });
    rl.stdoutMuted = hidden;
  });
}

const s = load();
s.login = s.login ?? {};

const estado = (v) => (v ? `preenchido (${String(v).length} chars)` : "VAZIO");
console.log(`
== Credenciais do portal Working Holiday do INZ ==
   https://onlineservices.immigration.govt.nz/secure/Login+Working+Holiday.htm

   ATENCAO: e a conta do INZ (Nova Zelandia), NAO o ImmiAccount australiano.

   estado atual:
     usuario:    ${estado(s.login.username)}
     senha:      ${estado(s.login.password)}
     2FA (TOTP): ${estado(s.login.totpSecret)}

   ENTER em branco mantem o valor atual.
`);

const u = await ask("Usuario / e-mail do INZ: ");
const p = await ask("Senha (nao aparece na tela): ", { hidden: true });
const t = await ask("Chave TOTP do 2FA em base32 (ENTER se nao tiver): ");

if (u) s.login.username = u;
if (p) s.login.password = p;
if (t) s.login.totpSecret = t.replace(/\s+/g, "").toUpperCase();

if (t && !/^[A-Z2-7]+=*$/.test(t.replace(/\s+/g, "").toUpperCase())) {
  console.log("\n!! aviso: a chave TOTP nao parece base32 (so A-Z e 2-7). Confira antes do dia D.");
}

// backup do arquivo antigo (o nome casa com config/*.local.json no .gitignore)
if (existsSync(FILE)) {
  const bak = resolve(process.cwd(), "config", `secrets.backup-${Date.now()}.local.json`);
  copyFileSync(FILE, bak);
  console.log(`\nbackup do arquivo anterior: ${bak}`);
}

writeFileSync(FILE, JSON.stringify(s, null, 2) + "\n");
console.log(`
gravado em config/secrets.local.json

   usuario:    ${estado(s.login.username)}
   senha:      ${estado(s.login.password)}
   2FA (TOTP): ${estado(s.login.totpSecret)}

Proximo passo:
   npm run open     (abre o Chrome do bot na tela de login do INZ)
   npm run login    (testa o login com o que voce acabou de gravar)
`);
