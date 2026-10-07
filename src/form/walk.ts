import type { Page } from "playwright";
import type { AppConfig } from "../types.js";
import { scanPage, type PageSnapshot, type ScannedField } from "./scan.js";
import { resolveFields, applyValue, haystack } from "./answer.js";
import { toBatch, fastApply, applyFiles } from "./fastfill.js";
import { settle, waitForChange, pageSig, fastClick, fastClickLink, armNavigation } from "./wait.js";
import { screenshot, waitEnter, writeStatus, shortErr } from "../util.js";
import { log } from "../log.js";

export type WalkOutcome = "payment" | "submitted" | "closed" | "loggedout" | "stuck" | "maxsteps" | "stopped" | "captcha";

// Visto no teste Peru (30/09): /rs-captcha?redirect=...Wizard/Personal1.aspx com um
// botao "SUBMIT". O bot NUNCA resolve nem contorna captcha - para e chama o humano.
export const CAPTCHA = /rs-captcha|complete the captcha|recaptcha|hcaptcha|what code is in the image/i;

// Em ensaio NUNCA clicar nada que submeta/pague, mesmo que o texto do botao
// contenha uma palavra de avancar ("Continue to payment", "Save and submit").
const DENY_REHEARSAL = "submit|pay|lodge|purchase|checkout|declar|confirm and";
const DECLARATION_SCREEN = /declaration|i declare|submit (your |this )?application/i;

// ---- classificacao de tela (regex conservadoras; ajustar na calibracao) ----
const QUOTA_CLOSED =
  /quota (is |has been )?(full|filled|reached)|currently closed|no longer accepting|places (are |have )?(all )?(taken|filled)|scheme is closed|not open/i;
const LOGIN_SCREEN = /sign in|log ?in to your account|forgotten your password/i;
// Pagamento so e reconhecido por CAMPO DE CARTAO ou host de gateway - NUNCA por
// texto solto. A secao Personal do INZ pergunta "are you paying by credit card?":
// casar por texto fazia o bot declarar "cheguei no pagamento" na 1a tela e abortar.
// 07/10: 'expiry' solto casava 'passportExpiryDate' (tela de identificacao) -> alarme falso.
const CARD_FIELD = /card ?number|card ?holder|cardholder|name on (the )?card|\bcvv\b|\bcvc\b|card security|card expiry/i;
const GATEWAY_URL = /windcave|paymentexpress|dpspayment|\/payment|checkout/i;
const SUBMITTED =
  /your application (has been )?(successfully )?(submitted|received)|thank you for (your )?(application|payment)|payment (was )?successful|transaction (approved|successful)/i;
const SECTION_LINKS = "personal|identification|health|character|working holiday|declaration|summary";

const DEFAULT_ADVANCE = ["Save and continue", "Save & continue", "Save and next", "Continue", "Next", "Save", "Proceed"];
const DEFAULT_SUBMIT = ["Submit application", "Confirm and submit", "Submit", "Proceed to payment", "Continue to payment"];

function listFrom(sel: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const v = sel[key];
  return Array.isArray(v) && v.every((x) => typeof x === "string") && v.length ? (v as string[]) : fallback;
}

export function classify(s: PageSnapshot): WalkOutcome | null {
  const hay = `${s.heading} ${s.text}`;
  if (CAPTCHA.test(s.url) || CAPTCHA.test(hay)) return "captcha";
  // campo de cartao de verdade (texto livre nao conta) OU host de gateway
  // so rotulo/pergunta: o name/id do ASP.NET tem 'Expiry', 'Card' etc. em campos que nao sao de cartao
  const camposCartao = s.fields.filter((f) => f.kind !== "radio" && CARD_FIELD.test(`${f.label} ${f.question}`)).length;
  if (camposCartao >= 2 || GATEWAY_URL.test(s.url)) return "payment";
  if (SUBMITTED.test(hay)) return "submitted";
  if (QUOTA_CLOSED.test(hay)) return "closed";
  if (s.fields.some((f) => /password/i.test(haystack(f))) && LOGIN_SCREEN.test(hay)) return "loggedout";
  return null;
}

/**
 * Preenche a tela inteira. Em modo "fast" escreve tudo num unico round-trip e
 * re-varre pra pegar os campos que so aparecem depois (postback/reveal).
 * Retorna a ultima varredura, pra quem chamou saber o que sobrou.
 */
/** Freios pro bot nao brigar com o humano (assist). */
export interface FillGuard {
  /** Campo que o bot NAO deve tocar (ex: ja escreveu uma vez). */
  skip?: (f: ScannedField) => boolean;
  /** Avisado de cada campo que o bot escreveu. */
  onWritten?: (f: ScannedField) => void;
  /** true = humano assumiu a tela -> para de escrever. Checado entre passadas. */
  stop?: () => Promise<boolean>;
}

export async function fillCurrentPage(
  page: Page,
  cfg: AppConfig,
  first: PageSnapshot,
  guard: FillGuard = {},
): Promise<{ filled: number; unanswered: string[]; snap: PageSnapshot; passes: number }> {
  const fl = cfg.runtime.flow;
  const onlyIfEmpty = fl.fillOnlyEmpty;
  let snap = first;
  let filled = 0;
  let pass = 0;

  while (pass < fl.maxFillPasses) {
    if (pass > 0 && guard.stop && (await guard.stop())) break;
    const todas = resolveFields(snap.fields, cfg.answers);
    const res = guard.skip ? todas.filter((r) => !guard.skip!(r.field)) : todas;

    if (fl.fillMode === "fast") {
      const { items, problems } = toBatch(res, onlyIfEmpty);
      for (const p of problems) log.warn({ detalhe: p }, "lote: campo problematico");
      const fileProblems = await applyFiles(page, res);
      for (const p of fileProblems) log.warn({ detalhe: p }, "upload");
      if (items.length === 0) break;

      const out = await fastApply(page, items);
      filled += out.applied;
      if (guard.onWritten) {
        for (const it of items) {
          const r = res.find((x) => x.field.selector === it.sel || x.field.optionSelectors.includes(it.sel));
          if (r) guard.onWritten(r.field);
        }
      }
      for (const p of out.problems) log.warn({ detalhe: p }, "lote: falha");
      log.info({ passada: pass + 1, escritos: out.applied, itens: items.length }, "lote aplicado");

      // So campo de escolha dispara postback/reveal. Tela so de texto nao precisa
      // de settle nem de re-varredura -> economiza ~150ms por tela.
      const podeRevelar = items.some((it) => it.kind === "select" || it.kind === "radio" || it.kind === "checkbox");
      if (!podeRevelar) {
        pass += 1;
        break;
      }
    } else {
      let did = 0;
      for (const r of res) {
        if (r.value == null) continue;
        const out = await applyValue(page, r, { onlyIfEmpty });
        if (out.ok) {
          did += 1;
          filled += 1;
          guard.onWritten?.(r.field);
        } else if (!/^ja /.test(out.why)) {
          log.warn({ regra: r.ruleId, campo: haystack(r.field).slice(0, 80), motivo: out.why }, "NAO preencheu");
        }
      }
      if (did === 0) break;
    }

    await settle(page, fl.settleMs);
    pass += 1;
    const next = await scanPage(page).catch(() => null);
    if (!next) break;
    snap = next;
  }

  // o que sobrou sem resposta na ultima varredura
  const unanswered = resolveFields(snap.fields, cfg.answers)
    .filter((r) => r.value == null && (r.field.required || r.field.kind === "radio" || r.field.kind === "select"))
    .map((r) => haystack(r.field).slice(0, 110));

  return { filled, unanswered, snap, passes: pass };
}

/** Percorre o formulario ate o pagamento (ou ate travar). */
export async function walkForm(
  page: Page,
  cfg: AppConfig,
  opts: { rehearsal: boolean; onStep?: (tag: string) => Promise<unknown> },
): Promise<WalkOutcome> {
  const rt = cfg.runtime;
  const fl = rt.flow;
  const advance = listFrom(cfg.selectors, "advanceButtons", DEFAULT_ADVANCE);
  const submit = listFrom(cfg.selectors, "submitButtons", DEFAULT_SUBMIT);
  const wanted = opts.rehearsal ? advance : [...advance, ...submit];
  const visitedSections: string[] = [];
  const tStart = Date.now();

  let prevSig = "";
  let stuck = 0;

  for (let step = 0; step < fl.maxSteps; step++) {
    const tStep = Date.now();
    const snap0 = await scanPage(page).catch((e) => {
      log.warn({ err: shortErr(e) }, "scan falhou");
      return null;
    });
    if (!snap0) {
      await settle(page, 800);
      continue;
    }

    if (opts.onStep) await opts.onStep(`s${String(step).padStart(2, "0")}-a-antes`).catch(() => {});
    const verdict = classify(snap0);
    if (verdict) {
      log.warn({ step, tela: snap0.heading.slice(0, 80), verdict, msTotal: Date.now() - tStart }, "tela terminal");
      if (fl.screenshotMode !== "off") await shoot(page, `s${step}-${verdict}`, cfg);
      return verdict;
    }
    if (snap0.errors.length) log.warn({ erros: snap0.errors.slice(0, 3) }, "erros de validacao na tela");

    log.info({ step, tela: snap0.heading.slice(0, 70), campos: snap0.fields.length }, "tela");
    writeStatus(rt.artifactsDir, "walking", { step, tela: snap0.heading.slice(0, 80), campos: snap0.fields.length });

    // ensaio: para ANTES de preencher/marcar qualquer declaracao
    if (opts.rehearsal && DECLARATION_SCREEN.test(`${snap0.heading} ${snap0.buttons.join(" ")}`)) {
      log.warn({ step, tela: snap0.heading.slice(0, 80) }, "ENSAIO: tela de declaracao/submit -> parando aqui (nunca submete)");
      return "stopped";
    }

    const { filled, unanswered, snap, passes } = await fillCurrentPage(page, cfg, snap0);
    if (opts.onStep) await opts.onStep(`s${String(step).padStart(2, "0")}-b-depois`).catch(() => {});
    if (unanswered.length) {
      log.warn({ pendentes: unanswered.slice(0, 8) }, `${unanswered.length} campo(s) sem resposta`);
      if (fl.onUnanswered === "pause") await waitEnter("Campos sem resposta acima. Resolva na tela e tecle ENTER.");
    }

    // screenshot DEPOIS de preencher: 1 print por tela em vez de 1 print vazio
    if (fl.screenshotMode !== "off") await shoot(page, `s${String(step).padStart(2, "0")}`, cfg);

    // tela sem campo: pode ser menu de secoes
    if (snap.fields.length === 0) {
      const sigMenu = await pageSig(page); // ANTES do clique, senao a espera nao detecta a troca
      const navMenu = armNavigation(page);
      const link = await fastClickLink(page, SECTION_LINKS, visitedSections);
      if (link) {
        visitedSections.push(link);
        log.info({ secao: link }, "abrindo secao");
        await waitForChange(page, sigMenu, fl.navMaxMs, navMenu);
        continue;
      }
      navMenu.off();
    }

    const sigBefore = await pageSig(page);
    const nav = armNavigation(page); // armado ANTES do clique (postback rapido)
    const clicked = await fastClick(page, wanted, opts.rehearsal ? DENY_REHEARSAL : undefined);
    if (clicked) {
      const dt = await waitForChange(page, sigBefore, fl.navMaxMs, nav);
      log.info(
        { botao: clicked, preenchidos: filled, passadas: passes, msTela: Date.now() - tStep, msNav: dt },
        "avancou",
      );
    } else {
      nav.off();
      log.warn({ botoes: snap.buttons.slice(0, 8) }, "nenhum botao de avancar reconhecido");
      await settle(page, fl.settleMs);
    }

    const sigNow = await pageSig(page);
    if (sigNow === prevSig) {
      if (++stuck >= 3) {
        log.error({ tela: snap.heading.slice(0, 80), msTotal: Date.now() - tStart }, "travado na mesma tela 3x");
        return "stuck";
      }
    } else stuck = 0;
    prevSig = sigNow;
  }
  return "maxsteps";
}

async function shoot(page: Page, name: string, cfg: AppConfig): Promise<void> {
  await screenshot(page, name, cfg.runtime.artifactsDir, cfg.runtime.flow.screenshotMode === "full");
}
