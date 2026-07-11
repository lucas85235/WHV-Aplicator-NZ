import type { Page } from "playwright";
import type { AppConfig } from "./types.js";
import { openSession } from "./browser.js";
import { PAGE_MATCHERS, GATE_AFTER } from "./pages/index.js";
import { clickNext, setFillMode } from "./locators.js";
import { gateRetryLoop } from "./slot-gate.js";
import { ensureDocumentsAttached, fillMissingDocJustification } from "./documents.js";
import { fillPayment } from "./payment.js";
import { startApplication, reviewAndConfirm, submitNow } from "./flow.js";
import { ensureLoggedIn } from "./login.js";
import { startAlarm, stopAlarm } from "./alarm.js";
import { screenshot, waitEnter, writeStatus } from "./util.js";
import { log } from "./log.js";

async function heading(page: Page): Promise<string> {
  return (await page.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ");
}

type FormResult = "paid" | "closed" | "broken";

/**
 * Uma passada pelo formulario: loga -> abre app -> preenche/avanca -> gate.
 * Em live, ao passar o gate, segue ate o pagamento + alarme. rehearsal para no gate.
 */
async function runForm(page: Page, cfg: AppConfig, rehearsal: boolean): Promise<FormResult> {
  const shots = cfg.runtime.flow.screenshotEachPage ? cfg.runtime.artifactsDir : null;
  const dir = cfg.runtime.artifactsDir;
  const t0 = Date.now();

  writeStatus(dir, "login");
  if (!(await ensureLoggedIn(page, cfg))) {
    log.error("Sem sessao logada (configure secrets.login ou logue manual).");
    writeStatus(dir, "error", { detail: "sem sessao logada" });
    return "broken";
  }
  await startApplication(page, cfg);
  writeStatus(dir, "walking");

  let prev = "";
  let stuck = 0;
  let reachedSubmit = false;
  let pastGate = false;

  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const h = await heading(page);
    if (shots) await screenshot(page, `p${String(i).padStart(2, "0")}`, shots);

    if (/close all open browsers|unexpected error occurred/i.test(h)) {
      if (pastGate) { log.error("Erro pos-gate -> entregando pra voce (alarme ligado)."); break; }
      log.error("Erro de sessao no meio do formulario -> re-login.");
      return "broken";
    }
    // sessao expirou (voltou pro login)?
    if (await page.locator("#password, input[type=password]").first().isVisible().catch(() => false)) {
      if (pastGate) { log.error("Sessao caiu pos-gate -> entregando pra voce (alarme ligado)."); break; }
      log.warn("Sessao expirou no formulario -> re-login e recomeco.");
      return "broken";
    }
    if (h === prev && i > 0) {
      if (++stuck >= 2) {
        log.error({ heading: h.slice(0, 60) }, "travou na mesma pagina.");
        if (pastGate) break; // pos-gate: entrega pro humano (nao re-loga)
        return "broken";
      }
    } else stuck = 0;
    prev = h;

    if (/terms and conditions/i.test(h)) { await clickNext(page).catch(() => {}); continue; }
    if (/provide documents|attach documents|document checklist|upload|attachments/i.test(h)) {
      await ensureDocumentsAttached(page, cfg);
      await clickNext(page).catch(() => {});
      // se o site abriu caixa de justificativa (doc faltante, ex: ingles), preenche e segue
      if (await fillMissingDocJustification(page, cfg)) await clickNext(page).catch(() => {});
      continue;
    }
    if (/review|check your answers|summary of your|confirm your answers/i.test(h)) {
      await reviewAndConfirm(page, cfg);
      await clickNext(page).catch(() => {});
      continue;
    }
    if (/submit now|ready to submit|application charge|payment|pay for/i.test(h)) { reachedSubmit = true; break; }

    const m = PAGE_MATCHERS.find((x) => x.re.test(h));
    if (m) {
      log.info({ page: m.page.id }, m.page.title);
      await m.page.handle({ page, cfg });
      if (m.page.id === GATE_AFTER) {
        const g = await gateRetryLoop(page, cfg.runtime, { rehearsal });
        if (g === "broken") return "broken";
        if (g === "closed") return "closed";
        // 'open' -> VAGA! acorda o usuario JA (mesmo que trave nos docs depois)
        pastGate = true;
        writeStatus(dir, "PAST-GATE", { detail: "VAGA ABRIU - preenchendo 6-17" });
        if (!rehearsal && cfg.runtime.payment.alarm) startAlarm("VAGA ABRIU! Bot preenchendo - acorda, confere e paga (OTP).");
        continue;
      }
      await clickNext(page).catch((e) => log.warn({ err: String(e).split("\n")[0] }, "clickNext falhou"));
      continue;
    }
    log.warn({ heading: h.slice(0, 60) }, "pagina nao reconhecida -> Next");
    await clickNext(page).catch(() => {});
  }

  if (rehearsal) {
    log.info({ ms: Date.now() - t0 }, "rehearsal concluido");
    return "closed";
  }

  // ---- pagamento (so live, e so se chegou) ----
  if (!reachedSubmit) log.warn("nao cheguei explicitamente no submit, tentando mesmo assim...");
  await submitNow(page).catch((e) => log.warn({ err: String(e).split("\n")[0] }, "submit now - verifique a tela"));
  await fillPayment(page, cfg);
  log.warn({ ms: Date.now() - t0 }, ">>>>> CHEGOU NO PAGAMENTO <<<<<");
  writeStatus(dir, "PAYMENT", { detail: "cartao preenchido - aguardando voce pagar+OTP" });
  if (cfg.runtime.payment.alarm) startAlarm();
  await waitEnter("PAGUE na tela (confira cartao, clique Pagar, faca o OTP do banco). ENTER aqui quando terminar.");
  stopAlarm();
  writeStatus(dir, "PAID", { detail: "voce confirmou o pagamento" });
  return "paid";
}

/** Ensaio: navega ate o gate, NAO submete. */
export async function rehearsal(cfg: AppConfig): Promise<void> {
  log.info("== REHEARSAL == navega ate o gate, NAO submete");
  setFillMode(cfg.runtime.flow.fillOnlyEmpty);
  const s = await openSession(cfg.runtime);
  try {
    await runForm(s.page, cfg, true);
  } finally {
    await s.close();
  }
}

/** Dia D / overnight: loga sozinho, corre o form, INSISTE no gate ate abrir, paga. */
export async function live(cfg: AppConfig): Promise<void> {
  log.warn("== LIVE == overnight. Loga sozinho, insiste no gate, alarme no pagamento. NAO paga sozinho.");
  setFillMode(cfg.runtime.flow.fillOnlyEmpty);
  const s = await openSession(cfg.runtime);
  try {
    for (let round = 1; round <= 100; round++) {
      const r = await runForm(s.page, cfg, false);
      if (r === "paid") { log.warn("== CONCLUIDO =="); break; }
      if (r === "broken") { log.warn({ round }, "sessao quebrou -> re-logando e recomecando"); await s.page.waitForTimeout(2000); continue; }
      log.warn({ round }, "gate nao abriu no tempo -> recomecando"); // 'closed'
    }
  } finally {
    stopAlarm();
    log.info("Fim do live. O Chrome continua com voce.");
  }
}
