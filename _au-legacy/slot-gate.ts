import type { Page } from "playwright";
import type { RuntimeConfig } from "./types.js";
import { clickNext, clickButton } from "./locators.js";
import { writeStatus } from "./util.js";
import { log } from "./log.js";

// Aviso REAL de sem-vaga (calibrado no site).
const NO_VACANCY = /lodgement is currently closed|not be able to continue|annual visa quota|currently closed for new applications|no places/i;
// Erro fatal de sessao do ImmiAccount.
const BROKEN = /close all open browsers|unexpected error occurred/i;

async function textVisible(page: Page, rx: RegExp): Promise<boolean> {
  return page.getByText(rx).first().isVisible().catch(() => false);
}
async function loginPageVisible(page: Page): Promise<boolean> {
  return page.locator("#password, input[type=password]").first().isVisible().catch(() => false);
}

type Cls = "open" | "closed" | "expired" | "broken";

// Pagina REAL pos-gate (pagina 6). So declara "open" com esta evidencia POSITIVA.
const POST_GATE = /additional identity questions|previous travel to australia|previous passports|movements|been to australia/i;

/** Classifica o estado apos tentar avancar do gate.
 * IMPORTANTE: so retorna "open" com evidencia POSITIVA da pagina 6. Estado
 * transitorio/desconhecido = "closed" (insiste) -> evita FALSO POSITIVO de vaga. */
async function classify(page: Page): Promise<Cls> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(350); // settle: nao ler estado transitorio pos-clique
  if (await loginPageVisible(page)) return "expired"; // sessao caiu -> foi pro login
  if (await textVisible(page, BROKEN)) return "broken";
  if (await textVisible(page, NO_VACANCY)) return "closed";
  // SO headings VISIVEIS: paginas com erro (ex: pais que exige pre-registro, como China)
  // podem ter legends OCULTAS de sub-secoes futuras (ex: "Previous travel to Australia")
  // no mesmo DOM da pagina 3 -> allTextContents() pegaria isso e daria falso positivo.
  const h = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)]
      .filter((el) => (el as HTMLElement).offsetParent || el.getClientRects().length)
      .map((el) => el.textContent || "")
      .join(" | ");
  }, "h1,h2,h3").catch(() => "");
  if (POST_GATE.test(h)) return "open"; // chegou na pagina 6 de verdade = passou (heading VISIVEL)
  return "closed"; // confirmacao, transitorio ou desconhecido = ainda no gate, insiste
}

/** Re-tenta avancar do gate: clica Next; se nao houver Next, volta (Previous) e Next. */
async function reattempt(page: Page): Promise<void> {
  try {
    await clickNext(page);
  } catch {
    await clickButton(page, "Previous").catch(() => {});
    await clickNext(page).catch(() => {});
  }
}

export type GateResult = "open" | "closed" | "broken";

/**
 * Gate de vaga (pagina 5 -> 6). Em live, insiste em loop RAPIDO ate a vaga abrir.
 * Se a sessao expirar (volta pro login) ou quebrar, retorna "broken" -> o live()
 * re-loga e re-navega, voltando ao loop. rehearsal = 1 tentativa.
 */
export async function gateRetryLoop(page: Page, rt: RuntimeConfig, opts: { rehearsal: boolean }): Promise<GateResult> {
  await clickNext(page).catch(() => {});
  await page.waitForTimeout(250);
  let c = await classify(page);
  if (c === "open") return "open";
  if (c === "broken" || c === "expired") return "broken";
  if (opts.rehearsal || !rt.gateRetry.enabled) return "closed";

  const start = Date.now();
  const maxMs = (rt.gateRetry.maxMinutes || 600) * 60_000;
  let i = 0;
  log.warn("GATE FECHADO -> modo INSISTENTE (retry rapido ate abrir). Deixe rodando.");
  while (Date.now() - start < maxMs) {
    i += 1;
    await page.waitForTimeout(rt.gateRetry.intervalMs);
    await reattempt(page);
    await page.waitForTimeout(200);
    c = await classify(page);
    if (c === "open") {
      log.warn({ tentativas: i }, ">>>>> GATE ABRIU! Passou. <<<<<");
      return "open";
    }
    if (c === "expired" || c === "broken") {
      log.warn({ tentativas: i, estado: c }, "sessao caiu/quebrou durante o retry -> re-login e volta ao loop");
      return "broken";
    }
    // heartbeat TODO ciclo (ciclos podem ficar lentos c/ servidor lento -> nao deixa envelhecer > staleSec)
    const min = Math.round((Date.now() - start) / 60_000);
    writeStatus(rt.artifactsDir, "gate-insisting", { tentativas: i, minutos: min });
    if (i % 30 === 0) log.info({ tentativas: i, min }, "gate ainda fechado, insistindo...");
  }
  return "closed";
}
