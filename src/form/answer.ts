import type { Page } from "playwright";
import type { AnswerBook, AnswerRule } from "../types.js";
import type { ScannedField } from "./scan.js";
import { log } from "../log.js";

const SKIP = "@skip";

/** O INZ so aceita ASCII nos campos de texto. "Estácio" -> "Estacio". */
export function toAscii(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "");
}

/** Texto contra o qual as regras do livro de respostas sao testadas. */
export function haystack(f: ScannedField): string {
  return `${f.question} | ${f.label} | ${f.name} | ${f.selector}`.replace(/\s+/g, " ").trim();
}

const YESNO = /^(yes|no|sim|nao|true|false)$/i;

/** Grupo Yes/No — no INZ tanto radio quanto dropdown de 2 opcoes. */
function isYesNoGroup(f: ScannedField): boolean {
  if (f.kind !== "radio" && f.kind !== "select") return false;
  const opts = f.options.map((o) => o.trim()).filter((o) => o && !/^(select|choose|please|--)/i.test(o));
  return opts.length > 0 && opts.length <= 3 && opts.every((o) => YESNO.test(o));
}

export interface Resolution {
  field: ScannedField;
  value: string | null; // null = sem resposta
  ruleId: string; // id da regra, "default:yesNo", "" se nenhuma
}

/** Casa cada campo com a 1a regra do livro. Ordem do JSON = prioridade. */
export function resolveFields(fields: ScannedField[], book: AnswerBook): Resolution[] {
  const compiled = book.rules.map((r) => ({
    rule: r,
    re: safeRe(r.match),
    notRe: r.not ? safeRe(r.not) : null,
  }));

  return fields.map((f) => {
    const hay = haystack(f);
    const yesNoField = isYesNoGroup(f);
    for (const c of compiled) {
      if (c.rule.kind && c.rule.kind !== f.kind) continue;
      if (!c.re.test(hay)) continue;
      if (c.notRe && c.notRe.test(hay)) continue;
      // Guarda: campo Yes/No so aceita resposta Yes/No. Sem isso, uma regra
      // generica (ex: "country" -> "Brazil") sequestra uma pergunta de carater
      // ("removed from any country?") e responde lixo numa pergunta seria.
      if (yesNoField && c.rule.value !== SKIP && !YESNO.test(c.rule.value.trim())) continue;
      return { field: f, value: c.rule.value === SKIP ? null : c.rule.value, ruleId: c.rule.id };
    }
    if (book.defaults.yesNo && isYesNoGroup(f)) {
      return { field: f, value: book.defaults.yesNo, ruleId: "default:yesNo" };
    }
    if (book.defaults.checkDeclarations && f.kind === "checkbox" && /declar|agree|confirm|read and underst|terms/i.test(hay)) {
      return { field: f, value: "yes", ruleId: "default:declaration" };
    }
    return { field: f, value: null, ruleId: "" };
  });
}

function safeRe(src: string): RegExp {
  try {
    return new RegExp(src, "i");
  } catch {
    log.warn({ regex: src }, "regex invalida no answers.json - ignorada");
    return /$^/;
  }
}

/** Escolhe a melhor opcao de uma lista (exata > comeca com > contem). */
export function pickOption(options: string[], want: string): string | null {
  const W = want.replace(/\s+/g, " ").trim().toUpperCase();
  const norm = (o: string) => o.replace(/\s+/g, " ").trim().toUpperCase();
  return (
    options.find((o) => norm(o) === W) ??
    options.find((o) => norm(o).startsWith(W)) ??
    options.find((o) => norm(o).includes(W)) ??
    options.find((o) => W.includes(norm(o)) && norm(o).length > 1) ??
    null
  );
}

const TRUTHY = /^(yes|y|true|1|check|checked|sim)$/i;

/**
 * Aplica uma resolucao no campo. Retorna true se mexeu, false se pulou.
 * Nunca lanca: campo que nao aceita valor vira aviso (humano resolve).
 */
export async function applyValue(
  page: Page,
  r: Resolution,
  opts: { onlyIfEmpty: boolean },
): Promise<{ ok: boolean; why: string }> {
  const f = r.field;
  if (r.value == null) return { ok: false, why: "sem resposta" };
  if (opts.onlyIfEmpty && f.value && f.kind !== "checkbox") return { ok: false, why: "ja preenchido" };

  const loc = page.locator(f.selector).first();
  const T = 2500;

  try {
    switch (f.kind) {
      case "text":
      case "date":
      case "textarea": {
        await loc.fill(toAscii(r.value), { timeout: T });
        await loc.evaluate((el) => {
          el.dispatchEvent(new Event("change", { bubbles: true }));
          (el as HTMLElement).blur();
        });
        return { ok: true, why: "" };
      }
      case "select": {
        const opt = pickOption(f.options, r.value);
        if (!opt) return { ok: false, why: `opcao inexistente: ${r.value}` };
        try {
          await loc.selectOption({ label: opt }, { timeout: T });
        } catch {
          await loc.evaluate((el, want) => {
            const s = el as HTMLSelectElement;
            const o = [...s.options].find((x) => x.text.replace(/\s+/g, " ").trim() === want);
            if (o) {
              s.value = o.value;
              for (const ev of ["input", "change", "blur"]) s.dispatchEvent(new Event(ev, { bubbles: true }));
            }
          }, opt);
        }
        return { ok: true, why: "" };
      }
      case "radio": {
        const opt = pickOption(f.options, r.value);
        if (!opt) return { ok: false, why: `opcao inexistente: ${r.value}` };
        const idx = f.options.indexOf(opt);
        const sel = f.optionSelectors[idx];
        if (!sel) return { ok: false, why: "seletor da opcao ausente" };
        if (opts.onlyIfEmpty && f.value) return { ok: false, why: "ja respondido" };
        await page.locator(sel).first().check({ timeout: T });
        return { ok: true, why: "" };
      }
      case "checkbox": {
        const want = TRUTHY.test(r.value);
        if (want === (f.value === "checked")) return { ok: false, why: "ja no estado certo" };
        if (want) await loc.check({ timeout: T });
        else await loc.uncheck({ timeout: T });
        return { ok: true, why: "" };
      }
      case "file": {
        await loc.setInputFiles(r.value, { timeout: 8000 });
        return { ok: true, why: "" };
      }
      default:
        return { ok: false, why: "tipo desconhecido" };
    }
  } catch (e) {
    return { ok: false, why: String(e).split("\n")[0]?.slice(0, 120) ?? "erro" };
  }
}

/** Regras que nunca casaram: sinal de que o livro de respostas precisa de ajuste. */
export function unusedRules(book: AnswerBook, used: Set<string>): AnswerRule[] {
  return book.rules.filter((r) => !used.has(r.id));
}
