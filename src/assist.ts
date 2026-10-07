// ============================================================================
// DIA D - CO-PILOTO (npm run assist)
//
// Fluxo REAL do INZ (visto em 07/10):
//   /WorkingHoliday/ = grade de paises (BRAZIL "CLOSED")
//   -> Create.aspx?CountryId=..  "Working Holiday Scheme status for Brazil: ..."
//   -> quando abre: "Scheme is available" + input#..._applyNowButton "APPLY NOW"
//   -> captcha (/rs-captcha) -> wizard (Personal1 .. WorkingHolidaySpecific)
//
// FASE 1 (entrada): o bot atualiza a pagina do BRASIL e clica APPLY NOW no instante
//   em que ela abre. Nunca clica Apply Now de outro pais.
// FASE 2 (formulario): voce resolve o captcha; o bot preenche cada tela.
//
// NAO BRIGA COM VOCE: o bot nao usa o mouse/teclado do sistema (so DOM), nao rola a
// tela e nao rouba foco. Cada campo e escrito UMA vez. Se voce clicar, rolar ou
// digitar numa tela, o bot solta aquela tela (nao escreve nem aperta Next nela).
// Na pagina de status, mexer pausa o refresh por 3s.
// ============================================================================
import type { Page } from "playwright";
import type { AppConfig } from "./types.js";
import { openSession } from "./browser.js";
import { login } from "./nz/login.js";
import { fillCurrentPage, classify } from "./form/walk.js";
import { pageSig, fastClick, armNavigation, waitForChange } from "./form/wait.js";
import { scanPage } from "./form/scan.js";
import { fillPayment } from "./payment.js";
import { startAlarm, stopAlarm } from "./alarm.js";
import { notify } from "./notify.js";
import { screenshot, writeStatus } from "./util.js";
import { dumpScan } from "./runner.js";
import { log } from "./log.js";

const WH_HOME = "https://onlineservices.immigration.govt.nz/WorkingHoliday/";

type EntradaTipo = "grade" | "brasil-fechado" | "brasil-aberto" | "outro-pais" | "login" | "desafio" | "outro";
interface EntradaInfo {
  tipo: EntradaTipo;
  detalhe?: string;
  tileHref?: string | null;
}

/** Le a tela de entrada (grade / status do esquema). So DOM, nenhuma requisicao. */
export async function lerEntrada(page: Page): Promise<EntradaInfo> {
  const r = await page.evaluate(() => {
    const t = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (e: Element) => !!((e as HTMLElement).offsetParent || e.getClientRects().length);
    const txt = t(document.body?.innerText || "");
    if (txt.length < 700 && /what code is in the image|enable javascript to view|support id is/i.test(txt)) {
      return { tipo: "desafio", detalhe: txt.slice(0, 100) };
    }
    if (document.querySelector("input[type=password]") && /log ?in|sign in|password/i.test(txt)) return { tipo: "login" };
    const st = /Working Holiday Scheme status for\s+([A-Za-z ().'&-]+?)\s*:\s*([^.]*)/i.exec(txt);
    if (st) {
      const pais = t(st[1]);
      const estado = t(st[2]);
      if (!/^brazil$/i.test(pais)) return { tipo: "outro-pais", detalhe: pais };
      const btn = [...document.querySelectorAll("input[type=submit],input[type=button],button,a")]
        .filter(vis)
        .find((e) => /^apply now$/i.test(t((e as HTMLInputElement).value || e.textContent)));
      if (/scheme is available/i.test(estado) && btn) return { tipo: "brasil-aberto", detalhe: estado };
      return { tipo: "brasil-fechado", detalhe: estado };
    }
    if (/only passport holders from the countries below/i.test(txt)) {
      const tile = [...document.querySelectorAll("a, [onclick], [role=link], [role=button]")]
        .filter(vis)
        .find((e) => /^brazil\b/i.test(t((e as HTMLElement).innerText || e.textContent)));
      const href = tile && (tile as HTMLAnchorElement).href ? (tile as HTMLAnchorElement).href : null;
      return {
        tipo: "grade",
        tileHref: href,
        detalhe: tile ? t((tile as HTMLElement).innerText).slice(0, 40) : "sem tile do Brasil",
      };
    }
    return { tipo: "outro" };
  });
  return r as EntradaInfo;
}

/** Clica APPLY NOW - SO se a pagina for a do BRASIL e disser "Scheme is available". */
async function clicarApplyNow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (e: Element) => !!((e as HTMLElement).offsetParent || e.getClientRects().length);
    const txt = t(document.body?.innerText || "");
    if (!/Working Holiday Scheme status for\s+Brazil\s*:\s*Scheme is available/i.test(txt)) return false;
    const btn = [...document.querySelectorAll("input[type=submit],input[type=button],button,a")]
      .filter(vis)
      .find((e) => /^apply now$/i.test(t((e as HTMLInputElement).value || e.textContent)));
    if (!btn) return false;
    setTimeout(() => (btn as HTMLElement).click(), 0); // clique via DOM: nao mexe no seu mouse
    return true;
  });
}

/** Clica o tile do Brasil na grade quando ele nao tem href (fallback). */
async function clicarTileBrasil(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (e: Element) => !!((e as HTMLElement).offsetParent || e.getClientRects().length);
    const tile = [...document.querySelectorAll("a, [onclick], [role=link], [role=button]")]
      .filter(vis)
      .find((e) => /^brazil\b/i.test(t((e as HTMLElement).innerText || e.textContent)));
    if (!tile) return false;
    setTimeout(() => (tile as HTMLElement).click(), 0);
    return true;
  });
}

/**
 * Ultimo instante (relogio do PC) em que VOCE clicou, rolou, digitou ou tocou na
 * pagina. So conta evento real (isTrusted) - o que o bot faz via DOM nao conta.
 */
export async function atividadeUsuario(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      const w = window as unknown as { __whvTrack?: boolean; __whvUserTs?: number };
      if (!w.__whvTrack) {
        w.__whvTrack = true;
        w.__whvUserTs = 0;
        for (const ev of ["mousedown", "keydown", "wheel", "touchstart"]) {
          window.addEventListener(
            ev,
            (e) => {
              if (e.isTrusted) w.__whvUserTs = Date.now();
            },
            { capture: true, passive: true },
          );
        }
      }
      return w.__whvUserTs ?? 0;
    })
    .catch(() => 0);
}

/** Intervalo do refresh da pagina de status, pela distancia ate a abertura. */
export function intervaloRefresh(cfg: AppConfig): number {
  const T = Date.parse(cfg.runtime.opening.isoUtc ?? "");
  const j = (n: number) => Math.floor(Math.random() * n);
  if (Number.isNaN(T)) return 2500 + j(800);
  const dt = Date.now() - T; // negativo = antes de abrir
  if (dt < -120_000) return 240_000 + j(30_000); // so mantem a sessao viva
  if (dt < -20_000) return 2_500 + j(800); //       16:58:00 - 16:59:40
  if (dt < 120_000) return 1_100 + j(500); //       16:59:40 - 17:02:00 (rajada)
  if (dt < 30 * 60_000) return 2_500 + j(800); //   ate 17:30
  return 10_000;
}

export async function assist(cfg: AppConfig, opts: { entrada?: boolean } = {}): Promise<void> {
  const dir = cfg.runtime.artifactsDir;
  cfg.answers.defaults.checkDeclarations = false; // declaracao: voce marca, depois de revisar
  const autoAdvance = cfg.runtime.flow.autoAdvance !== false;
  // 07/10 tela real: botoes do wizard = Previous | SAVE | COMPLETE LATER | Next.
  // So "Next" avanca. "SAVE" recarrega a mesma aba (o bot ficou 8x em loop no WHS Specific).
  const ADV = ["Next"];
  const DENY = "submit|pay|lodge|purchase|checkout|declar|confirm and|delete|cancel|logout|save|complete later";
  const DECLARACAO = /declaration|i declare|i confirm that the information/i;
  // Nacionalidade esperada (o rascunho de 18/08 era do esquema da BELGICA).
  const passaporte = ((cfg.applicant as Record<string, Record<string, unknown>>)["passport"] ?? {}) as Record<string, unknown>;
  const nacionalidade = String(passaporte["nationality"] ?? "Brazil");
  const appsBloqueadas = new Set<string>();
  const appId = (u: string) => /ApplicationId=(\d+)/i.exec(u)?.[1] ?? "";

  const s = await openSession(cfg.runtime);
  const entrada = opts.entrada !== false;
  log.warn(
    { entradaAutomatica: entrada, abertura: cfg.runtime.opening.isoUtc, autoAdvance },
    "== ASSIST == entrada: bot clica APPLY NOW do Brasil quando abrir | formulario: voce faz o captcha, o bot preenche. Ctrl+C pra sair.",
  );
  writeStatus(dir, "ASSIST");

  // aba do INZ/gateway mais recente (voce pode abrir aba nova a vontade)
  const pick = () => {
    const ps = s.context.pages().filter((p) => /immigration\.govt\.nz|windcave|paymentexpress/i.test(p.url()));
    return ps[ps.length - 1] ?? s.page;
  };

  // --- estado da entrada ---
  let entrou = !entrada;
  let brazilUrl: string | null = null;
  let proximoReload = 0;
  let aguardandoAte = 0; // depois do APPLY NOW: nao navegar enquanto o POST carrega
  let ultimoEstado = "";
  let ultimoLogin = 0;

  // --- estado "nao brigar com voce" ---
  const escritos = new Set<string>(); // `${appId}|${campo}` - o bot escreve cada campo 1x por aplicacao
  const chaveCampo = (u: string, f: { name: string; question: string; label: string }) =>
    `${appId(u)}|${f.name || `${f.question}|${f.label}`}`;
  let paginaAtual = "";
  let paginaInicio = 0;
  let maosAvisado = false;
  const voceMexeu = async (page: Page) => (await atividadeUsuario(page)) > paginaInicio;

  let lastSig = "";
  let telas = 0;
  const avisado = new Set<string>();
  const avisoUmaVez = async (k: string, titulo: string, msg: string) => {
    if (avisado.has(k)) return;
    avisado.add(k);
    await notify(cfg, titulo, msg);
  };
  const ir = (page: Page, u: string) => page.goto(u, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);

  try {
    for (;;) {
      const page = pick();
      const url = page.url();

      // ===================== FASE 1: ENTRADA =====================
      if (!entrou && /rs-captcha|\/Wizard\//i.test(url)) {
        entrou = true;
        log.warn({ url: url.slice(0, 100) }, ">>> dentro da aplicacao - entrada concluida <<<");
      }
      if (!entrou) {
        const agora = Date.now();
        const T = Date.parse(cfg.runtime.opening.isoUtc ?? "");
        const naJanela = !Number.isNaN(T) && agora >= T - 120_000;

        if (agora < aguardandoAte) {
          await page.waitForTimeout(250); // POST do APPLY NOW carregando (pode demorar sob carga)
          continue;
        }
        const info = await lerEntrada(page).catch((): EntradaInfo => ({ tipo: "outro" }));
        const estado = `${info.tipo}|${info.detalhe ?? ""}`;
        if (estado !== ultimoEstado) {
          ultimoEstado = estado;
          log.info({ tela: info.tipo, detalhe: info.detalhe }, "entrada");
          writeStatus(dir, `ENTRADA-${info.tipo}`, { detalhe: info.detalhe ?? null });
        }

        switch (info.tipo) {
          case "brasil-aberto": {
            if (await clicarApplyNow(page)) {
              const atraso = Number.isNaN(T) ? null : Date.now() - T;
              log.warn({ msDepoisDaAbertura: atraso }, ">>>>> BRASIL ABERTO - APPLY NOW CLICADO <<<<<");
              writeStatus(dir, "APPLY-NOW", { msDepoisDaAbertura: atraso });
              aguardandoAte = Date.now() + 90_000;
              if (cfg.runtime.payment.alarm) startAlarm("BRASIL ABRIU! Bot clicou Apply Now - RESOLVA O CAPTCHA.");
              void notify(cfg, "BRASIL ABRIU - WHV NZ", "Bot clicou Apply Now. Resolva o captcha AGORA.");
            } else {
              await page.waitForTimeout(150);
            }
            continue;
          }
          case "brasil-fechado": {
            brazilUrl = url;
            if (!proximoReload) proximoReload = agora + intervaloRefresh(cfg);
            if (agora < proximoReload) {
              await page.waitForTimeout(Math.min(250, proximoReload - agora));
              continue;
            }
            if ((await atividadeUsuario(page)) > agora - 3000) {
              proximoReload = agora + 1000; // voce esta mexendo: segura o refresh
              continue;
            }
            await ir(page, brazilUrl);
            proximoReload = Date.now() + intervaloRefresh(cfg);
            continue;
          }
          case "grade": {
            if (info.tileHref) {
              brazilUrl = info.tileHref;
              await ir(page, info.tileHref);
            } else if (!(await clicarTileBrasil(page))) {
              log.warn("grade sem tile do Brasil - clique voce em BRAZIL");
              await page.waitForTimeout(2000);
            } else {
              await page.waitForTimeout(800);
            }
            continue;
          }
          case "outro-pais": {
            // NUNCA clica Apply Now de outro pais. Na janela, volta pro Brasil.
            if (naJanela && agora >= proximoReload) {
              log.warn({ pais: info.detalhe }, "pagina de OUTRO pais -> voltando pro Brasil");
              await ir(page, brazilUrl ?? WH_HOME);
              proximoReload = Date.now() + intervaloRefresh(cfg);
            } else {
              await page.waitForTimeout(500);
            }
            continue;
          }
          case "login": {
            if (agora - ultimoLogin > 20_000) {
              ultimoLogin = agora;
              log.warn("sessao caiu -> logando de novo");
              await login(page, cfg).catch(() => false);
              await ir(page, brazilUrl ?? WH_HOME);
            } else {
              await page.waitForTimeout(500);
            }
            continue;
          }
          case "desafio": {
            log.warn(">>> DESAFIO DO WAF na tela - resolva voce. O bot nao atualiza enquanto isso. <<<");
            await avisoUmaVez(`waf-${Math.floor(agora / 60_000)}`, "DESAFIO NO SITE - WHV NZ", "O site pediu verificacao. Resolva na tela.");
            await page.waitForTimeout(1500);
            continue;
          }
          default: {
            // pagina em branco (sobrecarga), home do Online Services, etc.
            if (naJanela && agora >= proximoReload) {
              await ir(page, brazilUrl ?? WH_HOME);
              proximoReload = Date.now() + intervaloRefresh(cfg);
            } else {
              await page.waitForTimeout(500);
            }
            continue;
          }
        }
      }

      // ===================== FASE 2: FORMULARIO =====================
      const sig = await pageSig(page);
      if (sig === lastSig || sig.startsWith("@") || !sig.includes("|complete|")) {
        await page.waitForTimeout(200);
        continue;
      }
      const chavePagina = url.split("#")[0] ?? url;
      if (chavePagina !== paginaAtual) {
        paginaAtual = chavePagina;
        paginaInicio = Date.now();
        maosAvisado = false;
        await atividadeUsuario(page); // instala o detector de mouse/teclado nesta tela
      }
      const snap = await scanPage(page).catch(() => null);
      if (!snap) {
        await page.waitForTimeout(300);
        continue;
      }
      lastSig = sig;
      const v = classify(snap);

      if (v === "captcha") {
        log.warn(">>> CAPTCHA: RESOLVA VOCE. O bot espera e continua sozinho depois. <<<");
        writeStatus(dir, "CAPTCHA");
        await avisoUmaVez(`captcha-${snap.url}`, "CAPTCHA - WHV NZ", "Resolva o captcha na tela. O bot continua depois.");
        continue;
      }
      if (v === "payment") {
        if (!avisado.has(`pay-${page.url()}`)) {
          avisado.add(`pay-${page.url()}`);
          if (await voceMexeu(page)) {
            log.warn("voce ja esta mexendo no checkout - o bot nao toca no cartao");
          } else {
            await fillPayment(page, cfg);
          }
          writeStatus(dir, "PAYMENT");
          if (cfg.runtime.payment.alarm) startAlarm("PAGAMENTO: confira o cartao, clique pagar e faca o OTP.");
          await notify(cfg, "PAGAMENTO - WHV NZ", "Cartao preenchido. Confere, paga e faz o OTP. RAPIDO.");
        }
        continue;
      }
      if (v === "submitted") {
        stopAlarm();
        writeStatus(dir, "DONE", { url: snap.url });
        log.warn(">>>>> TELA DE CONFIRMACAO - parece concluido. Confira o e-mail do INZ. <<<<<");
        await dumpScan(page, cfg, "assist-confirmacao").catch(() => "");
        await screenshot(page, "assist-confirmacao", dir, false); // viewport: fullPage mexe no layout
        continue;
      }

      const ehForm = /onlineservices\.immigration\.govt\.nz/i.test(snap.url) && snap.fields.length >= 2;
      // passou do captcha = voce esta no PC: desliga o alarme do APPLY NOW
      if (ehForm && /\/Wizard\//i.test(snap.url)) stopAlarm();
      if (!ehForm) {
        log.info({ url: snap.url.slice(0, 90), tela: snap.heading.slice(0, 60) }, "aguardando uma tela de formulario...");
        continue;
      }

      // ---- TRAVA DE ESQUEMA: aplicacao de outro pais -> nao preenche NADA nela ----
      const cid = /Citizenship of Passport\s*([A-Za-z][A-Za-z .,'&()-]{1,40}?)\s*(Passport Expiry|Passport Number|Second Form|$)/i.exec(
        snap.text,
      );
      if (cid && !new RegExp(nacionalidade, "i").test(cid[1] ?? "")) {
        const id = appId(snap.url);
        if (id) appsBloqueadas.add(id);
        log.error(
          { esquema: cid[1], esperado: nacionalidade, applicationId: id },
          ">>> APLICACAO DE OUTRO ESQUEMA - o bot NAO vai preencher. NAO SUBMETA. <<<",
        );
        await avisoUmaVez(`esq-${id}`, "ESQUEMA ERRADO - WHV NZ", `Aplicacao ${id} e do esquema ${cid[1]}, nao ${nacionalidade}. Nao submeta.`);
        continue;
      }
      if (appsBloqueadas.has(appId(snap.url))) {
        log.warn({ applicationId: appId(snap.url) }, "aplicacao bloqueada (outro esquema) - ignorando esta tela");
        continue;
      }

      const temDeclaracao =
        DECLARACAO.test(snap.heading) ||
        snap.fields.some((f) => f.kind === "checkbox" && DECLARACAO.test(`${f.label} ${f.question}`));
      if (temDeclaracao) {
        log.warn(">>> DECLARACAO: revise, marque as caixas e clique SUBMIT VOCE. <<<");
        writeStatus(dir, "DECLARATION");
        await avisoUmaVez(`decl-${snap.url}`, "DECLARACAO - WHV NZ", "Revise, marque a declaracao e clique Submit.");
        await dumpScan(page, cfg, "assist-declaracao").catch(() => "");
        continue;
      }

      // ---- voce mexeu nesta tela? entao ela e sua ----
      if (await voceMexeu(page)) {
        if (!maosAvisado) {
          maosAvisado = true;
          log.warn("voce mexeu nesta tela -> o bot NAO escreve nem avanca nela. Clique Next quando quiser.");
        }
        continue;
      }

      // ---- tela de formulario: preenche (cada campo 1x por aplicacao) ----
      const t0 = Date.now();
      telas += 1;
      const r = await fillCurrentPage(page, cfg, snap, {
        skip: (f) => escritos.has(chaveCampo(url, f)),
        onWritten: (f) => escritos.add(chaveCampo(url, f)),
        stop: () => voceMexeu(page),
      });
      const ms = Date.now() - t0;
      log.warn(
        { tela: telas, titulo: r.snap.heading.slice(0, 60), preenchidos: r.filled, pendentes: r.unanswered.length, ms },
        "TELA PREENCHIDA",
      );
      writeStatus(dir, "ASSIST-FILL", { tela: telas, pendentes: r.unanswered.length });
      dumpScan(page, cfg, `assist-${String(telas).padStart(2, "0")}`).catch(() => "");

      let avancou = false;
      if (r.unanswered.length) {
        log.warn({ pendentes: r.unanswered.slice(0, 10) }, ">>> CAMPOS SEM RESPOSTA: preencha voce e clique Next. <<<");
      } else if (r.snap.errors.length) {
        log.warn({ erros: r.snap.errors.slice(0, 5) }, ">>> ERRO DE VALIDACAO na tela: corrija voce e clique Next. <<<");
      } else if (autoAdvance && !(await voceMexeu(page))) {
        const antes = await pageSig(page);
        const nav = armNavigation(page);
        const botao = await fastClick(page, ADV, DENY);
        if (botao) {
          const dt = await waitForChange(page, antes, cfg.runtime.flow.navMaxMs, nav);
          avancou = true;
          log.info({ botao, msNav: dt }, "avancou sozinho");
        } else {
          nav.off();
          log.warn({ botoes: r.snap.buttons.slice(0, 8) }, "sem Next nesta tela (ultima aba?) - revise e siga voce");
        }
      }
      // Avancou: a tela NOVA ainda nao foi processada -> nao marcar como vista.
      lastSig = avancou ? "" : await pageSig(page);
    }
  } finally {
    stopAlarm();
  }
}
