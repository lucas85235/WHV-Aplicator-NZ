import type { AppConfig } from "./types.js";
import { log } from "./log.js";

// Avisos REMOTOS (te alertam no celular quando a vaga abrir / chegar no pagamento).
// Configuravel em secrets.local.json -> "notify". Tudo opcional; manda pros canais setados.
// Nao trava o fluxo: erro de rede so loga um warn.

async function send(name: string, p: Promise<Response>): Promise<void> {
  try {
    const r = await p;
    if (!r.ok) log.warn({ canal: name, status: r.status }, "notify: resposta nao-ok");
  } catch (e) {
    log.warn({ canal: name, err: String(e).split("\n")[0] }, "notify: falhou (sem rede?)");
  }
}

/** Dispara um aviso remoto pros canais configurados. Best-effort, nunca lanca. */
export async function notify(cfg: AppConfig, title: string, message: string): Promise<void> {
  const n = cfg.secrets?.notify;
  if (!n) return; // nada configurado -> silencioso
  const text = `${title}\n${message}`;
  const opts = { signal: AbortSignal.timeout(8000) };
  const tasks: Array<Promise<void>> = [];

  if (n.telegram?.botToken && n.telegram?.chatId) {
    tasks.push(
      send(
        "telegram",
        fetch(`https://api.telegram.org/bot${n.telegram.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: n.telegram.chatId, text }),
          ...opts,
        }),
      ),
    );
  }
  if (n.ntfyTopic) {
    tasks.push(
      send(
        "ntfy",
        fetch(`https://ntfy.sh/${n.ntfyTopic}`, {
          method: "POST",
          headers: { Title: title, Priority: "urgent", Tags: "rotating_light" },
          body: message,
          ...opts,
        }),
      ),
    );
  }
  if (n.webhookUrl) {
    tasks.push(
      send(
        "webhook",
        fetch(n.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, message }),
          ...opts,
        }),
      ),
    );
  }

  if (tasks.length === 0) return;
  await Promise.allSettled(tasks);
  log.info({ canais: tasks.length }, "notify: aviso remoto enviado");
}
