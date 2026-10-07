import type { Page } from "playwright";
import type { Resolution } from "./answer.js";
import { pickOption, toAscii } from "./answer.js";

// Preenchimento EM LOTE: uma unica chamada page.evaluate escreve todos os campos
// da tela de uma vez. Cada op do Playwright custa um round-trip pelo CDP (~20-60ms);
// com 40 campos isso vira 1-3s. Em lote vira ~1 round-trip (~10ms).
//
// Risco conhecido: campo com autopostback (ASP/Java) dispara navegacao ao mudar.
// Como o evaluate roda inteiro numa unica task de JS, TODOS os campos sao escritos
// antes de qualquer navegacao acontecer. Se algo se perder no postback, a passada
// seguinte do walk re-varre e completa (fillOnlyEmpty evita reescrever o que ficou).

export interface BatchItem {
  sel: string;
  kind: string;
  /** texto ja resolvido (opcao exata do select/radio, ou valor do campo) */
  value: string;
  ruleId: string;
  label: string;
}

export interface BatchResult {
  applied: number;
  skipped: number;
  problems: string[];
}

const TRUTHY = /^(yes|y|true|1|check|checked|sim)$/i;

const MESES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Datepicker do INZ (visto em 07/10): dateFormat "d MM, yy" -> "28 February, 2034". */
export function inzDate(v: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!m) return toAscii(v);
  const mes = MESES_EN[Number(m[2]) - 1];
  return mes ? `${Number(m[1])} ${mes}, ${m[3]}` : toAscii(v);
}

/**
 * Data DD/MM/YYYY num campo que e UM dos 3 dropdowns (dia/mes/ano). Os 3 tem o
 * mesmo label ("Date of birth"), entao a mesma regra casa os 3 - aqui cada um
 * pega so a sua parte, decidindo pelo conteudo das opcoes.
 */
export function datePart(options: string[], value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, d, mo, y] = m as unknown as [string, string, string, string];
  const opts = options.map((o) => o.trim());
  const find = (cands: string[]) => opts.find((o) => cands.some((c) => o.toLowerCase() === c.toLowerCase())) ?? null;
  if (opts.some((o) => /^(19|20)\d{2}$/.test(o))) return find([y]);
  const nome = MESES[Number(mo) - 1] ?? "";
  if (opts.some((o) => /^jan/i.test(o))) return opts.find((o) => o.toLowerCase().startsWith(nome)) ?? null;
  const numericas = opts.filter((o) => /^\d{1,2}$/.test(o)).length;
  if (numericas >= 12 && numericas <= 13) return find([mo.padStart(2, "0"), String(Number(mo))]);
  if (numericas >= 28) return find([d.padStart(2, "0"), String(Number(d))]);
  return null;
}

/** Monta os itens do lote a partir das resolucoes (resolve opcao aqui, no Node). */
export function toBatch(res: Resolution[], onlyIfEmpty: boolean): { items: BatchItem[]; problems: string[] } {
  const items: BatchItem[] = [];
  const problems: string[] = [];

  for (const r of res) {
    const f = r.field;
    if (r.value == null) continue;
    if (f.kind === "file") continue; // upload nao da pra fazer por DOM
    // data no formato antigo DD/MM/YYYY (que o proprio bot escreveu antes) conta como vazia
    const dataVelha = f.kind === "date" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(f.value);
    if (onlyIfEmpty && f.value && f.kind !== "checkbox" && !dataVelha && !r.force) continue;

    let value = r.value;
    if (f.kind === "select" || f.kind === "radio") {
      const opt = (f.kind === "select" ? datePart(f.options, r.value) : null) ?? pickOption(f.options, r.value);
      if (!opt) {
        problems.push(`${r.ruleId}: opcao inexistente "${r.value}" em [${f.options.slice(0, 4).join(", ")}]`);
        continue;
      }
      value = opt;
      if (f.kind === "radio") {
        const idx = f.options.indexOf(opt);
        const sel = f.optionSelectors[idx];
        if (!sel) {
          problems.push(`${r.ruleId}: seletor da opcao ausente`);
          continue;
        }
        items.push({ sel, kind: "radio", value: opt, ruleId: r.ruleId, label: f.label.slice(0, 50) });
        continue;
      }
    } else if (f.kind === "checkbox") {
      value = TRUTHY.test(r.value) ? "1" : "0";
      if ((value === "1") === (f.value === "checked")) continue; // ja no estado certo
    } else if (f.kind === "date") {
      value = inzDate(r.value);
    } else {
      value = toAscii(r.value);
    }
    items.push({ sel: f.selector, kind: f.kind, value, ruleId: r.ruleId, label: f.label.slice(0, 50) });
  }
  return { items, problems };
}

/** Escreve o lote inteiro no DOM numa unica chamada. */
export async function fastApply(page: Page, items: BatchItem[]): Promise<BatchResult> {
  if (items.length === 0) return { applied: 0, skipped: 0, problems: [] };

  const out = await page.evaluate((batch: BatchItem[]) => {
    const fire = (el: Element, evs: string[]): void => {
      for (const ev of evs) el.dispatchEvent(new Event(ev, { bubbles: true }));
    };
    const problems: string[] = [];
    let applied = 0;

    for (const it of batch) {
      const el = document.querySelector(it.sel) as HTMLInputElement | HTMLSelectElement | null;
      if (!el) {
        problems.push(`${it.ruleId}: elemento sumiu (${it.label})`);
        continue;
      }
      try {
        if (it.kind === "select") {
          const s = el as HTMLSelectElement;
          const o = [...s.options].find((x) => x.text.replace(/\s+/g, " ").trim() === it.value);
          if (!o) {
            problems.push(`${it.ruleId}: opcao "${it.value}" sumiu`);
            continue;
          }
          if (s.value === o.value) continue;
          s.value = o.value;
          fire(s, ["input", "change"]);
        } else if (it.kind === "radio") {
          const r = el as HTMLInputElement;
          if (r.checked) continue;
          r.checked = true; // o DOM desmarca os irmaos do mesmo name sozinho
          fire(r, ["input", "change"]);
        } else if (it.kind === "checkbox") {
          const c = el as HTMLInputElement;
          const want = it.value === "1";
          if (c.checked === want) continue;
          c.checked = want;
          fire(c, ["input", "change"]);
        } else {
          const t = el as HTMLInputElement;
          if (t.value === it.value) continue;
          t.value = it.value;
          fire(t, ["input", "change", "blur"]);
        }
        applied += 1;
      } catch (e) {
        problems.push(`${it.ruleId}: ${String(e).slice(0, 80)}`);
      }
    }
    return { applied, problems };
  }, items);

  return { applied: out.applied, skipped: items.length - out.applied, problems: out.problems };
}

/** Uploads: nao dao pra fazer por DOM, vao pelo Playwright mesmo. */
export async function applyFiles(page: Page, res: Resolution[]): Promise<string[]> {
  const problems: string[] = [];
  for (const r of res) {
    if (r.field.kind !== "file" || r.value == null) continue;
    if (r.field.value) continue;
    try {
      await page.locator(r.field.selector).first().setInputFiles(r.value, { timeout: 8000 });
    } catch (e) {
      problems.push(`${r.ruleId}: upload falhou (${String(e).split("\n")[0]?.slice(0, 70)})`);
    }
  }
  return problems;
}
