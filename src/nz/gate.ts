import type { Page } from "playwright";
import type { AppConfig } from "../types.js";
import { scanPage, type PageSnapshot } from "../form/scan.js";
import { haystack } from "../form/answer.js";
import { login } from "./login.js";
import { writeStatus } from "../util.js";
import { log } from "../log.js";

// A cota do Brasil (300 vagas) abre num horario anunciado e some em minutos.
// Diferente do 462 australiano, aqui NAO da pra deixar uma aplicacao salva:
// o botao de aplicar so existe com a cota aberta. Entao o bot: fica logado,
// vigia a tela, e no instante em que o botao aparece, entra e preenche tudo.

const CLOSED =
  /quota (is |has been )?(full|filled|reached)|currently closed|closed for (new )?application|no longer accepting|places (are |have )?(all )?(taken|filled)|not (yet )?open|opens? (on|at)/i;
const APPLY = /apply now|start (a )?new application|new application|apply for (a|this) visa|apply online/i;
const LOGGED_OUT = /sign in|log ?in to your account|forgotten your password/i;

export type GateState = "open" | "closed" | "unknown" | "loggedout";

/** Le a tela atual e decide se da pra aplicar AGORA. Evidencia POSITIVA so. */
export function classifySnap(snap: PageSnapshot): GateState {
  const hay = `${snap.heading} ${snap.text} ${snap.buttons.join(" ")}`;
  if (snap.fields.some((f) => /password/i.test(haystack(f))) && LOGGED_OUT.test(hay)) return "loggedout";
  if (snap.buttons.some((b) => APPLY.test(b)) && !CLOSED.test(hay)) return "open";
  if (CLOSED.test(hay)) return "closed";
  return "unknown";
}

export async function checkOpen(page: Page): Promise<GateState> {
  const snap = await scanPage(page).catch(() => null);
  if (!snap) return "unknown";
  const st = classifySnap(snap);
  if (st === "unknown") {
    // fallback: botao/link de aplicar que nao entrou na lista de botoes
    const l = await applyLink(page);
    if (l) return "open";
  }
  return st;
}

async function applyLink(page: Page) {
  const l = page.getByRole("link", { name: APPLY }).or(page.getByRole("button", { name: APPLY })).first();
  return (await l.count()) > 0 && (await l.isVisible().catch(() => false)) ? l : null;
}

/** Milissegundos ate a abertura oficial (negativo = ja passou). */
export function msUntilOpening(cfg: AppConfig): number | null {
  const iso = cfg.runtime.opening.isoUtc;
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    log.warn({ iso }, "runtime.opening.isoUtc invalido");
    return null;
  }
  return t - Date.now();
}

function jitter(base: number, j: number): number {
  return base + Math.floor(Math.random() * (j + 1));
}

/** Uma sondagem: 1 navegacao + 1 varredura. Tudo (aberto/fechado/deslogado) sai daqui. */
async function probe(page: Page, cfg: AppConfig): Promise<GateState> {
  const url = cfg.runtime.urls.whsLogin;
  try {
    if (page.url().startsWith(url.split("?")[0] ?? url)) {
      await page.reload({ waitUntil: "domcontentloaded" });
    } else {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
  } catch {
    return "unknown";
  }
  return checkOpen(page);
}

/**
 * Espera a cota abrir. Tres marchas:
 *   idle   - longe do horario: dorme em blocos (so mantem a sessao viva)
 *   hot    - dentro de leadSeconds: intervalo medio
 *   rajada - dentro de burstSeconds do horario oficial: intervalo curto
 * Nunca vira flood: o portal do INZ fica atras de WAF (F5) e martelar cai em
 * captcha / derruba a sessao - o que custaria MUITO mais que os segundos ganhos.
 */
export async function waitForOpening(
  page: Page,
  cfg: AppConfig,
  onProbe?: (state: GateState, i: number) => Promise<unknown>,
): Promise<GateState> {
  const o = cfg.runtime.opening;
  const deadline = Date.now() + o.maxMinutes * 60_000;
  let i = 0;

  for (;;) {
    if (Date.now() > deadline) {
      log.error("maxMinutes estourou sem a cota abrir");
      return "closed";
    }
    i += 1;

    const left = msUntilOpening(cfg);
    const burst = left != null && left <= o.burstSeconds * 1000 && left > -o.burstSeconds * 1000 * 4;
    const hot = left == null || left <= o.leadSeconds * 1000;

    const state = await probe(page, cfg);
    if (onProbe) await onProbe(state, i).catch(() => {});

    if (state === "loggedout") {
      log.warn("sessao caiu -> re-logando");
      if (!(await login(page, cfg))) await page.waitForTimeout(5000);
      continue;
    }
    if (state === "open") {
      log.warn({ tentativas: i, msDoHorario: left == null ? null : -left }, ">>>>> COTA ABERTA <<<<<");
      return "open";
    }

    writeStatus(cfg.runtime.artifactsDir, burst ? "watch-burst" : hot ? "watch-hot" : "watch-idle", {
      tentativas: i,
      estado: state,
      faltamMin: left == null ? null : Math.round(left / 60_000),
    });
    if (i % 10 === 0 || burst) {
      log.info(
        { tentativas: i, estado: state, faltamSeg: left == null ? "?" : Math.round(left / 1000), marcha: burst ? "rajada" : hot ? "hot" : "idle" },
        "ainda fechada",
      );
    }

    if (burst) {
      await page.waitForTimeout(o.burstPollMs);
      continue;
    }
    if (!hot && left != null) {
      // dorme direto ate o inicio da janela quente (menos requests, menos WAF)
      const target = Math.max(1000, left - o.leadSeconds * 1000);
      await page.waitForTimeout(jitter(Math.min(o.idlePollMs, target), o.jitterMs));
      continue;
    }
    // hot: se falta pouco pro inicio da rajada, dorme exatamente ate la
    if (left != null && left > o.burstSeconds * 1000) {
      const toBurst = left - o.burstSeconds * 1000;
      await page.waitForTimeout(Math.min(jitter(o.hotPollMs, o.jitterMs), toBurst));
    } else {
      await page.waitForTimeout(jitter(o.hotPollMs, o.jitterMs));
    }
  }
}

// Aplicacao ja comecada (a sessao caiu no meio e voltamos). O INZ guarda o
// rascunho; com fillOnlyEmpty=true o bot completa o que faltou sem reescrever.
const RESUME = /continue (with |your )?(this )?application|resume (your )?application|edit application|incomplete|draft|in progress/i;

/** Depois de um re-login: retoma o rascunho; se nao achar, abre uma nova. */
export async function resumeApplication(page: Page, cfg: AppConfig): Promise<boolean> {
  await page.goto(cfg.runtime.urls.whsLogin, { waitUntil: "domcontentloaded" }).catch(() => {});
  const l = page.getByRole("link", { name: RESUME }).or(page.getByRole("button", { name: RESUME })).first();
  if ((await l.count()) > 0 && (await l.isVisible().catch(() => false))) {
    log.warn("retomando a aplicacao salva");
    await l.click({ timeout: 8000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    writeStatus(cfg.runtime.artifactsDir, "IN-APPLICATION", { url: page.url(), via: "retomada" });
    return true;
  }
  log.warn("nenhum rascunho pra retomar -> tentando abrir nova aplicacao");
  return startApplication(page, cfg);
}

/** Entra na aplicacao nova. Usa a URL direta se ela estiver calibrada. */
export async function startApplication(page: Page, cfg: AppConfig): Promise<boolean> {
  const direct = cfg.runtime.urls.applyDirect;
  if (direct) {
    log.info({ url: direct }, "atalho: indo direto pra nova aplicacao");
    await page.goto(direct, { waitUntil: "domcontentloaded" }).catch(() => {});
    const snap = await scanPage(page).catch(() => null);
    if (snap && snap.fields.length > 0) {
      writeStatus(cfg.runtime.artifactsDir, "IN-APPLICATION", { url: page.url(), via: "atalho" });
      return true;
    }
    log.warn("atalho nao caiu no formulario -> tentando pelo botao");
  }

  const l = await applyLink(page);
  if (!l) {
    log.error("botao de aplicar nao encontrado");
    return false;
  }
  await l.click({ timeout: 8000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded").catch(() => {});

  // se cair numa lista de esquemas, escolhe o do Brasil
  const schemeRe = new RegExp(cfg.runtime.scheme ?? "brazil", "i");
  const scheme = page.getByRole("link", { name: schemeRe }).or(page.getByRole("button", { name: schemeRe })).first();
  if ((await scheme.count()) > 0 && (await scheme.isVisible().catch(() => false))) {
    log.info({ esquema: cfg.runtime.scheme ?? "brazil" }, "selecionando esquema");
    await scheme.click({ timeout: 6000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
  writeStatus(cfg.runtime.artifactsDir, "IN-APPLICATION", { url: page.url() });
  return true;
}
