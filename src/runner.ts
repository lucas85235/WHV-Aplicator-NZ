import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";
import type { AppConfig } from "./types.js";
import { openSession } from "./browser.js";
import { ensureLoggedIn, login } from "./nz/login.js";
import { checkOpen, waitForOpening, startApplication, resumeApplication, msUntilOpening } from "./nz/gate.js";
import { walkForm, fillCurrentPage, classify } from "./form/walk.js";
import { pageSig, fastClick, armNavigation, waitForChange } from "./form/wait.js";
import { scanPage } from "./form/scan.js";
import { resolveFields, haystack } from "./form/answer.js";
import { fillPayment } from "./payment.js";
import { startAlarm, stopAlarm } from "./alarm.js";
import { notify } from "./notify.js";
import { screenshot, waitEnter, writeStatus } from "./util.js";
import { log } from "./log.js";

/** Salva um retrato da tela atual (campos + textos) pra calibrar o answers.json. */
export async function dumpScan(page: Page, cfg: AppConfig, tag: string): Promise<string> {
  const snap = await scanPage(page);
  const res = resolveFields(snap.fields, cfg.answers);
  const dir = cfg.runtime.artifactsDir;
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `scan-${tag}.json`);
  const body = {
    url: snap.url,
    heading: snap.heading,
    buttons: snap.buttons,
    errors: snap.errors,
    campos: res.map((r) => ({
      tipo: r.field.kind,
      pergunta: r.field.question,
      label: r.field.label,
      opcoes: r.field.options,
      valorAtual: r.field.value,
      obrigatorio: r.field.required,
      seletor: r.field.selector,
      regra: r.ruleId || null,
      resposta: r.value,
      chaveDeBusca: haystack(r.field),
    })),
  };
  writeFileSync(file, JSON.stringify(body, null, 2));
  const semResposta = res.filter((r) => r.value == null).length;
  log.info({ file, campos: res.length, semResposta }, "scan salvo");
  return file;
}

/** Ensaio: loga, olha o estado da cota e mede a cobertura do livro de respostas. */
export async function rehearsal(cfg: AppConfig): Promise<void> {
  log.info("== ENSAIO == loga, checa a cota e varre a tela. NAO submete nada.");
  const s = await openSession(cfg.runtime);
  try {
    const ok = await ensureLoggedIn(s.page, cfg);
    if (!ok) {
      log.error("nao consegui confirmar o login. Logue manual nesta janela e rode de novo.");
      await dumpScan(s.page, cfg, "login");
      return;
    }
    const state = await checkOpen(s.page);
    const left = msUntilOpening(cfg);
    log.info(
      { cota: state, faltamHoras: left == null ? "?" : (left / 3_600_000).toFixed(1) },
      "estado da cota",
    );
    await screenshot(s.page, "ensaio", cfg.runtime.artifactsDir, true);
    await dumpScan(s.page, cfg, "ensaio");
    if (state === "open") {
      log.warn("A COTA ESTA ABERTA AGORA. Rode `npm run live` (o ensaio nao aplica).");
    }
  } finally {
    await s.close();
  }
}

/** So vigia e avisa (nao aplica). Util pra rodar num PC secundario. */
export async function watch(cfg: AppConfig): Promise<void> {
  log.info("== VIGIA == espera a cota abrir e dispara alarme + push. Nao preenche nada.");
  const s = await openSession(cfg.runtime);
  try {
    const state = await waitForOpening(s.page, cfg);
    if (state !== "open") return;
    startAlarm("COTA ABERTA (WHV Nova Zelandia)! Vai pro PC AGORA.");
    await notify(cfg, "COTA ABERTA - WHV NZ", "As 300 vagas abriram. Aplica AGORA.");
    await waitEnter("Alarme ligado. ENTER pra desligar.");
  } finally {
    stopAlarm();
    await s.close();
  }
}

/** Dia D: espera a cota abrir, entra, preenche tudo e para no pagamento. */
export async function live(cfg: AppConfig): Promise<void> {
  log.warn("== LIVE == espera a cota, preenche o formulario e PARA no pagamento. NUNCA paga sozinho.");
  const dir = cfg.runtime.artifactsDir;
  const s = await openSession(cfg.runtime);
  try {
    writeStatus(dir, "login");
    if (!(await ensureLoggedIn(s.page, cfg))) {
      log.error("sem sessao logada - logue manual nesta janela do Chrome e rode de novo.");
      writeStatus(dir, "error", { detail: "sem sessao logada" });
      return;
    }

    const state = await waitForOpening(s.page, cfg);
    if (state !== "open") {
      writeStatus(dir, "closed");
      return;
    }

    // vaga aberta: acorda o usuario JA, mesmo que o preenchimento trave depois
    writeStatus(dir, "OPEN", { detail: "cota aberta - preenchendo" });
    if (cfg.runtime.payment.alarm) startAlarm("COTA ABERTA! Bot preenchendo - acorda e confere.");
    await notify(cfg, "COTA ABERTA - WHV NZ", "Bot entrou na aplicacao e esta preenchendo. Vai pro PC.");

    if (!(await startApplication(s.page, cfg))) {
      log.error("nao consegui abrir a aplicacao - ASSUMA A TELA.");
      await dumpScan(s.page, cfg, "falha-start");
      await waitEnter("Assuma a tela e tecle ENTER quando estiver dentro do formulario.");
    }

    const t0 = Date.now();
    let out = await walkForm(s.page, cfg, { rehearsal: false });

    // Sessao caiu no meio do formulario: re-loga, retoma o rascunho e continua.
    // fillOnlyEmpty=true garante que o que ja foi salvo nao e reescrito.
    for (let tent = 1; out === "loggedout" && tent <= 3; tent++) {
      log.warn({ tentativa: tent }, "sessao caiu no meio do formulario -> re-logando");
      writeStatus(dir, "RELOGIN", { tentativa: tent });
      if (!(await login(s.page, cfg))) {
        log.error("re-login falhou - ASSUMA A TELA");
        break;
      }
      await resumeApplication(s.page, cfg);
      out = await walkForm(s.page, cfg, { rehearsal: false });
    }

    log.warn({ resultado: out, segundos: ((Date.now() - t0) / 1000).toFixed(1) }, "fim do preenchimento");
    await dumpScan(s.page, cfg, `fim-${out}`).catch(() => "");

    if (out === "payment") {
      await fillPayment(s.page, cfg);
      writeStatus(dir, "PAYMENT", { detail: "cartao preenchido - aguardando voce pagar" });
      await notify(cfg, "PAGAMENTO - WHV NZ", "Cartao preenchido. Confere, clica pagar e faz o OTP do banco.");
      await waitEnter("PAGUE na tela (confira o cartao, clique pagar, faca o OTP). ENTER quando terminar.");
      writeStatus(dir, "PAID", { detail: "voce confirmou o pagamento" });
      log.warn("== CONCLUIDO ==");
      return;
    }

    writeStatus(dir, "HANDOVER", { detail: out });
    await notify(cfg, "ASSUMA A TELA - WHV NZ", `Bot parou em: ${out}. Termina manual, rapido.`);
    await waitEnter(`Bot parou em "${out}". ASSUMA A TELA e termine manual. ENTER quando terminar.`);
  } finally {
    stopAlarm();
    log.info("Fim do live. O Chrome continua com voce.");
  }
}

/** Comando de calibracao: varre a tela que estiver aberta agora. */
export async function scan(cfg: AppConfig): Promise<void> {
  const s = await openSession(cfg.runtime);
  try {
    await dumpScan(s.page, cfg, String(Date.now()));
    await screenshot(s.page, "scan", cfg.runtime.artifactsDir, true);
  } finally {
    await s.close();
  }
}

/**
 * TESTE AO VIVO num esquema que o usuario NAO pode aplicar (ex: Peru).
 * So observa: loga, vigia a abertura, entra no formulario, varre cada tela com
 * os dados REAIS do usuario e PARA antes de declaracao/submit/pagamento.
 * Nunca submete, nunca marca declaracao, nunca preenche cartao.
 */
export async function probe(cfg: AppConfig, scheme: string, atIso: string): Promise<void> {
  const dir = cfg.runtime.artifactsDir;
  cfg.runtime.scheme = scheme;
  cfg.runtime.opening.isoUtc = atIso;
  // mais gentil que o dia D: a conta real vai ser usada de novo em 07/10
  cfg.runtime.opening.burstPollMs = Math.max(cfg.runtime.opening.burstPollMs, 1500);
  cfg.runtime.opening.burstSeconds = 45;
  cfg.answers.defaults.checkDeclarations = false;
  cfg.runtime.flow.onUnanswered = "warn";
  const tag = (t: string) => `probe-${t}`;

  // Simulacao de passaporte do esquema testado: regras EM MEMORIA, na frente do
  // livro real. config/answers.json nunca e alterado.
  const ovPath = resolve(process.cwd(), "config", "probe-overrides.json");
  if (existsSync(ovPath)) {
    const ov = JSON.parse(readFileSync(ovPath, "utf-8")) as { rules?: AppConfig["answers"]["rules"] };
    const extra = ov.rules ?? [];
    cfg.answers.rules = [...extra, ...cfg.answers.rules];
    log.warn({ regras: extra.map((r) => r.id) }, "PROBE: simulacao de passaporte carregada (so em memoria)");
  }

  log.warn({ esquema: scheme, abertura: atIso }, "== PROBE == so observa. NUNCA submete, NUNCA paga.");
  const s = await openSession(cfg.runtime);
  const t0 = Date.now();

  // TRAVA DE REDE: mesmo que algum clique escape das outras travas, nenhuma
  // pagina de gateway de pagamento carrega nesta sessao.
  const GATEWAY = /windcave|paymentexpress|dpspayment|\/payment|checkout|\/pay\b|securepay/i;
  await s.context.route("**/*", (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && GATEWAY.test(req.url())) {
      log.error({ url: req.url() }, "PROBE: navegacao pra PAGAMENTO bloqueada");
      return route.abort().catch(() => {});
    }
    return route.continue().catch(() => {});
  });
  // Dialogo "tem certeza que quer submeter?" -> sempre CANCELA, e registra o texto.
  s.page.on("dialog", (d) => {
    log.warn({ tipo: d.type(), texto: d.message().slice(0, 200) }, "PROBE: dialogo -> cancelado");
    d.dismiss().catch(() => {});
  });
  try {
    if (!(await ensureLoggedIn(s.page, cfg))) {
      log.error("login falhou - logue manual na janela do Chrome do bot e rode de novo.");
      await dumpScan(s.page, cfg, tag("00-login-falhou")).catch(() => "");
      await screenshot(s.page, tag("login-falhou"), dir, true);
      return;
    }
    await dumpScan(s.page, cfg, tag("01-logado")).catch(() => "");
    await screenshot(s.page, tag("logado"), dir, true);

    // dump do painel toda vez que o estado muda (fechado -> aberto, etc.)
    let ultimo = "";
    const state = await waitForOpening(s.page, cfg, async (st, i) => {
      if (st === ultimo) return;
      ultimo = st;
      log.warn({ estado: st, tentativa: i }, "PROBE: estado do painel mudou");
      await dumpScan(s.page, cfg, tag(`02-painel-${st}-${i}`)).catch(() => "");
      await screenshot(s.page, tag(`painel-${st}`), dir, true);
    });
    const left = msUntilOpening(cfg);
    log.warn({ estado: state, msDepoisDoHorario: left == null ? null : -left }, "PROBE: fim da espera");
    if (state !== "open") return;

    await notify(cfg, "PROBE: cota Peru abriu", "O bot detectou a abertura. So observando, nao vai submeter.");
    const tIn = Date.now();
    const entrou = await startApplication(s.page, cfg);
    await dumpScan(s.page, cfg, tag("03-apos-apply")).catch(() => "");
    await screenshot(s.page, tag("apos-apply"), dir, true);
    log.warn({ entrou, ms: Date.now() - tIn }, "PROBE: tentativa de entrar na aplicacao");
    if (!entrou) return;

    const out = await walkForm(s.page, cfg, {
      rehearsal: true,
      onStep: (t) => dumpScan(s.page, cfg, tag(`04-${t}`)),
    });
    await dumpScan(s.page, cfg, tag(`05-fim-${out}`)).catch(() => "");
    await screenshot(s.page, tag(`fim-${out}`), dir, true);
    log.warn({ resultado: out, segundosTotal: ((Date.now() - t0) / 1000).toFixed(1) }, "PROBE: concluido");
    log.warn("NAO clique em submit na janela. Os dumps estao em artifacts/probe-*.json");
    log.error(">>> APAGUE O RASCUNHO PERU DA CONTA AGORA. A mesma conta aplica pro Brasil em 07/10. <<<");
  } finally {
    writeStatus(dir, "PROBE-DONE");
    log.info("Fim do probe. O Chrome continua com voce.");
  }
}

/**
 * DIA D - CO-PILOTO. Depois do teste Peru (30/09) ficou claro que o bot nao
 * consegue sozinho: tem CAPTCHA antes do formulario e o painel nao mostra um
 * botao de "aplicar" previsivel. Entao a divisao e:
 *   VOCE: navega ate a aplicacao, resolve o captcha, revisa, marca declaracao,
 *         clica Submit e paga (OTP).
 *   BOT:  no instante em que uma tela de formulario aparece, preenche TUDO
 *         (um round-trip) e, se nao sobrou pendencia nem erro, avanca sozinho.
 *         No checkout, preenche o cartao. Nunca clica submit/pagar/declaracao.
 */
export async function assist(cfg: AppConfig): Promise<void> {
  const dir = cfg.runtime.artifactsDir;
  cfg.answers.defaults.checkDeclarations = false; // declaracao: voce marca, depois de revisar
  const autoAdvance = cfg.runtime.flow.autoAdvance !== false;
  const sel = cfg.selectors as Record<string, unknown>;
  const ADV = Array.isArray(sel["advanceButtons"]) ? (sel["advanceButtons"] as string[]) : ["Save and continue", "Next", "Continue", "Save"];
  const DENY = "submit|pay|lodge|purchase|checkout|declar|confirm and|delete|cancel|logout";
  const DECLARACAO = /declaration|i declare|i confirm that the information/i;

  const s = await openSession(cfg.runtime);
  log.warn({ autoAdvance }, "== ASSIST == voce navega + resolve captcha; o bot preenche cada tela na hora. Ctrl+C pra sair.");
  writeStatus(dir, "ASSIST");

  // aba do INZ/gateway mais recente (voce pode abrir aba nova a vontade)
  const pick = () => {
    const ps = s.context.pages().filter((p) => /immigration\.govt\.nz|windcave|paymentexpress/i.test(p.url()));
    return ps[ps.length - 1] ?? s.page;
  };

  let lastSig = "";
  let telas = 0;
  const avisado = new Set<string>();
  const avisoUmaVez = async (k: string, titulo: string, msg: string) => {
    if (avisado.has(k)) return;
    avisado.add(k);
    await notify(cfg, titulo, msg);
  };

  try {
    for (;;) {
      const page = pick();
      const sig = await pageSig(page);
      if (sig === lastSig || sig.startsWith("@") || !sig.includes("|complete|")) {
        await page.waitForTimeout(200);
        continue;
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
          await fillPayment(page, cfg);
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
        await screenshot(page, "assist-confirmacao", dir, true);
        continue;
      }

      const ehForm = /onlineservices\.immigration\.govt\.nz/i.test(snap.url) && snap.fields.length >= 2;
      if (!ehForm) {
        log.info({ url: snap.url.slice(0, 90), tela: snap.heading.slice(0, 60) }, "aguardando uma tela de formulario...");
        continue;
      }

      const temDeclaracao =
        DECLARACAO.test(snap.heading) ||
        snap.fields.some((f) => f.kind === "checkbox" && DECLARACAO.test(`${f.label} ${f.question}`));
      if (temDeclaracao) {
        log.warn(">>> DECLARACAO: revise, marque as caixas e clique SUBMIT VOCE. <<<");
        writeStatus(dir, "DECLARATION");
        await avisoUmaVez(`decl-${snap.url}`, "DECLARACAO - WHV NZ", "Revise, marque a declaracao e clique Submit.");
        await dumpScan(page, cfg, `assist-declaracao`).catch(() => "");
        continue;
      }

      // ---- tela de formulario: preenche tudo ----
      const t0 = Date.now();
      telas += 1;
      const r = await fillCurrentPage(page, cfg, snap);
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
      } else if (autoAdvance) {
        const antes = await pageSig(page);
        const nav = armNavigation(page);
        const botao = await fastClick(page, ADV, DENY);
        if (botao) {
          const dt = await waitForChange(page, antes, cfg.runtime.flow.navMaxMs, nav);
          avancou = true;
          log.info({ botao, msNav: dt }, "avancou sozinho");
        } else {
          nav.off();
          log.warn({ botoes: r.snap.buttons.slice(0, 8) }, "nao achei botao de avancar seguro - clique voce");
        }
      }
      // Avancou: a tela NOVA ainda nao foi processada -> nao marcar como vista.
      // (bug pego no teste: salvar a assinatura aqui fazia o bot pular a tela 2)
      lastSig = avancou ? "" : await pageSig(page);
    }
  } finally {
    stopAlarm();
  }
}
