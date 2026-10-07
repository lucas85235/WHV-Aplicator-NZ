// Testa os avisos remotos configurados em secrets.local.json -> notify.
// Uso: node scripts/test-notify.mjs
import { loadConfig } from "../dist/src/config.js";
import { notify } from "../dist/src/notify.js";
const cfg = await loadConfig();
if (!cfg.secrets?.notify) {
  console.log("notify NAO configurado em secrets.local.json. Adicione o bloco 'notify' (veja COMO_RODAR / instrucoes).");
  process.exit(0);
}
console.log("canais setados:", Object.keys(cfg.secrets.notify).join(", "));
await notify(cfg, "TESTE WHV NZ bot", "Se voce recebeu isso no celular, o aviso de abertura da cota esta funcionando.");
console.log("enviado. Confere o celular.");
