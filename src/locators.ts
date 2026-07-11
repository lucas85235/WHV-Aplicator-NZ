import type { Page } from "playwright";

// Helpers calibrados no DOM real do ImmiAccount (ELodgement).
// - Radios: agrupados por 'name'; label via label[for]; pergunta no fieldset/legend.
// - Selects: options MAIUSCULAS, as vezes "NOME - COD" -> match case-insensitive/contains.
// - Velocidade: guard count()==0 falha em ~0ms (sem esperar timeout). Sem loop de 4s.
// - fillOnlyEmpty: nao sobrescreve dados ja preenchidos (protege a app pre-salva).

let ONLY_IF_EMPTY = true;
export function setFillMode(onlyIfEmpty: boolean): void {
  ONLY_IF_EMPTY = onlyIfEmpty;
}

const FILL_T = 2000;

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ImmiAccount so aceita caracteres ingleses padrao (ASCII) em campos de texto.
 * Remove acentos: "Universidade Estácio de Sá" -> "Universidade Estacio de Sa".
 * Sem isso, o Confirm/Next da "An error has occurred" (validacao de campo). */
export function toAscii(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "");
}

/** Preenche input de texto por label. Pula se ja tiver valor (fillOnlyEmpty). */
export async function fillLabel(page: Page, label: string, value: string | null): Promise<void> {
  if (value == null || value === "") return;
  const clean = toAscii(String(value));
  const f = page.getByLabel(label, { exact: false }).filter({ visible: true }).first();
  if ((await f.count()) === 0) throw new Error(`campo nao encontrado: ${label}`);
  if (ONLY_IF_EMPTY) {
    const cur = await f.inputValue().catch(() => "");
    if (cur && cur.trim() !== "") return; // ja preenchido -> nao mexe
  }
  await f.fill(clean, { timeout: FILL_T });
}

export const setDate = fillLabel;

/** Seleciona opcao de dropdown (match case-insensitive / contains). */
export async function selectDropdown(page: Page, label: string, value: string | null): Promise<void> {
  if (value == null || value === "") return;
  // Sem filtro visible: o <select> do ImmiAccount e widget custom (o select real
  // pode ser "invisivel" pro Playwright). .first() pega o do applicant.
  const sel = page.getByLabel(label, { exact: false }).first();
  if ((await sel.count()) === 0) throw new Error(`dropdown nao encontrado: ${label}`);
  if (ONLY_IF_EMPTY) {
    const cur = await sel.inputValue().catch(() => "");
    if (cur && cur.trim() !== "") return; // ja selecionado
  }
  const match = await sel.evaluate((el, v) => {
    const V = String(v).replace(/\s+/g, " ").trim().toUpperCase();
    const opts = [...(el as HTMLSelectElement).options].map((o) => o.text.replace(/\s+/g, " ").trim());
    return (
      opts.find((t) => t.toUpperCase() === V) ||
      opts.find((t) => t.toUpperCase().startsWith(V)) ||
      opts.find((t) => t.toUpperCase().includes(V)) ||
      null
    );
  }, value);
  if (!match) throw new Error(`opcao nao encontrada: ${label} -> ${value}`);
  try {
    await sel.selectOption({ label: match }, { timeout: FILL_T });
  } catch {
    // fallback p/ select custom/oculto: seta value + dispara change
    await sel.evaluate((el, m) => {
      const s = el as HTMLSelectElement;
      const o = [...s.options].find((x) => x.text.replace(/\s+/g, " ").trim() === m);
      if (o) {
        s.value = o.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, match);
  }
}

/** Marca um radio pela PERGUNTA (substring) + LABEL da opcao (Yes/No/Male/...). */
export async function setRadioInGroup(page: Page, question: string, optionLabel: string): Promise<void> {
  const res = await page.evaluate(
    ({ q, opt }) => {
      const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const nq = norm(q);
      const no = norm(opt);
      const labelOf = (r: Element): string => {
        const el = r as HTMLInputElement;
        if (el.id) {
          const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (l && norm(l.textContent)) return l.textContent || "";
        }
        const wl = el.closest("label");
        return wl ? wl.textContent || "" : "";
      };
      const qOf = (r: Element): string => {
        const fs = (r as HTMLElement).closest("fieldset");
        if (fs) {
          const lg = fs.querySelector("legend");
          if (lg && norm(lg.textContent)) return lg.textContent || "";
        }
        let node: Element | null = r;
        for (let up = 0; up < 8 && node; up++) {
          let sib = node.previousElementSibling;
          while (sib) {
            if (/^(H1|H2|H3|H4|LEGEND|LABEL)$/.test(sib.tagName) && norm(sib.textContent)) return sib.textContent || "";
            const h = sib.querySelector && sib.querySelector("h1,h2,h3,h4,legend");
            if (h && norm(h.textContent)) return h.textContent || "";
            sib = sib.previousElementSibling;
          }
          node = node.parentElement;
        }
        return "";
      };
      const vis = (el: Element) => !!((el as HTMLElement).offsetParent || el.getClientRects().length);
      const radios = ([...document.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]).filter(vis);
      for (const r of radios) {
        if (norm(labelOf(r)) !== no) continue;
        const qt = norm(qOf(r));
        if (qt.length > 0 && (qt.includes(nq) || nq.includes(qt))) {
          const grp = radios.filter((x) => x.name === r.name);
          return { id: r.id, groupChecked: grp.some((x) => x.checked) };
        }
      }
      return null;
    },
    { q: question, opt: optionLabel },
  );
  if (!res || !res.id) throw new Error(`radio nao encontrado: ${question} / ${optionLabel}`);
  if (ONLY_IF_EMPTY && res.groupChecked) return; // ja respondido -> nao mexe
  await page.locator(`[id="${res.id}"]`).check({ timeout: FILL_T });
}

/** Seleciona num dropdown de PAIS pela ORDEM entre os selects de pais VISIVEIS
 * (0=usual country of residence, 1=residential, ...). Acha o <select> por scan de
 * DOM (options tem AUSTRALIA+AFGHANISTAN), localiza pelo id e usa selectOption
 * NATIVO (dispara eventos certos no widget custom). Metodo comprovado ao vivo. */
export async function selectCountryByOrder(page: Page, order: number, value: string | null): Promise<void> {
  if (value == null || value === "") return;
  const info = await page.evaluate((ord) => {
    const txt = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (el: Element) => !!((el as HTMLElement).offsetParent || el.getClientRects().length);
    const isCountry = (s: HTMLSelectElement) =>
      [...s.options].some((o) => /^AUSTRALIA$/i.test(txt(o.text))) && [...s.options].some((o) => /^AFGHANISTAN$/i.test(txt(o.text)));
    const sels = ([...document.querySelectorAll("select")] as HTMLSelectElement[]).filter((s) => isCountry(s) && vis(s));
    const s = sels[ord];
    if (!s) return null;
    return { id: s.id, name: s.name, cur: txt(s.options[s.selectedIndex]?.text || "") };
  }, order);
  if (!info) throw new Error(`select de pais visivel #${order} nao encontrado`);
  if (ONLY_IF_EMPTY && info.cur && !/^(select|choose|please)\b|^-+$|^$/i.test(info.cur)) return; // ja preenchido
  const loc = info.id ? page.locator(`[id="${info.id}"]`) : page.locator(`select[name="${info.name}"]`);
  const opt = await loc.evaluate((el, v) => {
    const V = String(v).toUpperCase();
    const opts = [...(el as HTMLSelectElement).options].map((o) => o.text.replace(/\s+/g, " ").trim());
    return opts.find((t) => t.toUpperCase() === V) || opts.find((t) => t.toUpperCase().startsWith(V)) || opts.find((t) => t.toUpperCase().includes(V)) || null;
  }, value);
  if (!opt) throw new Error(`opcao nao encontrada (pais #${order}): ${value}`);
  try {
    await loc.selectOption({ label: opt }, { timeout: FILL_T });
  } catch {
    await loc.evaluate((el, m) => {
      const o = [...(el as HTMLSelectElement).options].find((x) => x.text.replace(/\s+/g, " ").trim() === m);
      if (o) { (el as HTMLSelectElement).value = o.value; for (const ev of ["input", "change", "blur"]) el.dispatchEvent(new Event(ev, { bubbles: true })); }
    }, opt);
  }
}

/** Seleciona num dropdown ACHANDO o select pela OPCAO (nao pelo label). Ideal
 * pra listas de opcao unica (qualification, industry, office) em paginas blind. */
export async function selectDropdownByOption(page: Page, value: string | null): Promise<void> {
  if (value == null || value === "") return;
  const found = await page.evaluate((v) => {
    const V = v.replace(/\s+/g, " ").trim().toUpperCase();
    const vis = (el: Element) => !!((el as HTMLElement).offsetParent || el.getClientRects().length);
    const match = (s: HTMLSelectElement) =>
      [...s.options].find((o) => o.text.replace(/\s+/g, " ").trim().toUpperCase() === V) ||
      [...s.options].find((o) => o.text.replace(/\s+/g, " ").trim().toUpperCase().includes(V));
    const selects = [...document.querySelectorAll("select")] as HTMLSelectElement[];
    const ordered = selects.filter(vis).concat(selects.filter((s) => !vis(s)));
    for (const s of ordered) {
      const o = match(s);
      if (o) return { id: s.id, name: s.name, optValue: o.value, curText: s.options[s.selectedIndex]?.text.trim() || "" };
    }
    return null;
  }, value);
  if (!found) throw new Error(`nenhum dropdown com a opcao: ${value}`);
  if (ONLY_IF_EMPTY && found.curText && !/^(select|choose|please)\b|^-+$|^$/i.test(found.curText)) return;
  const loc = found.id ? page.locator(`[id="${found.id}"]`) : page.locator(`select[name="${found.name}"]`);
  try {
    await loc.selectOption(found.optValue, { timeout: FILL_T });
  } catch {
    await loc.evaluate((el, val) => {
      (el as HTMLSelectElement).value = val;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, found.optValue);
  }
}

/** Marca a mesma opcao (ex: "No") em TODO grupo de radio ainda sem resposta.
 * Usado nas paginas de Saude/Carater (dezenas de Yes/No). */
export async function answerAllRadios(page: Page, optionLabel: string): Promise<number> {
  const ids = await page.evaluate((opt) => {
    const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const no = norm(opt);
    const vis = (el: Element) => !!((el as HTMLElement).offsetParent || el.getClientRects().length);
    const radios = ([...document.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]).filter(vis);
    const byName: Record<string, HTMLInputElement[]> = {};
    radios.forEach((r) => {
      (byName[r.name] = byName[r.name] || []).push(r);
    });
    const out: string[] = [];
    Object.values(byName).forEach((grp) => {
      if (grp.some((x) => x.checked)) return;
      for (const r of grp) {
        let lbl = "";
        if (r.id) {
          const l = document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
          if (l) lbl = l.textContent || "";
        }
        if (!lbl) {
          const wl = r.closest("label");
          if (wl) lbl = wl.textContent || "";
        }
        if (norm(lbl) === no) {
          out.push(r.id);
          break;
        }
      }
    });
    return out;
  }, optionLabel);
  for (const id of ids) await page.locator(`[id="${id}"]`).check({ timeout: FILL_T }).catch(() => {});
  return ids.length;
}

/** Marca radio pelo nome/label (regex) na pagina toda. */
export async function checkRadio(page: Page, name: RegExp): Promise<void> {
  const r = page.getByRole("radio", { name }).first();
  if ((await r.count()) === 0) throw new Error(`radio nao encontrado: ${name}`);
  await r.check({ timeout: FILL_T });
}

/** Marca UM checkbox pelo texto do label (substring). */
export async function checkByLabel(page: Page, labelText: string): Promise<void> {
  const cb = page.getByRole("checkbox", { name: new RegExp(escapeRx(labelText), "i") }).first();
  if ((await cb.count()) === 0) throw new Error(`checkbox nao encontrado: ${labelText}`);
  await cb.check({ timeout: FILL_T });
}

/** Preenche o primeiro campo de texto VISIVEL e vazio (ex: caixa revelada por "Other"). */
export async function fillFirstEmptyText(page: Page, value: string | null): Promise<void> {
  if (value == null || value === "") return;
  const fields = page.locator("textarea, input[type=text]");
  const n = await fields.count();
  for (let i = 0; i < n; i += 1) {
    const f = fields.nth(i);
    if (!(await f.isVisible().catch(() => false))) continue;
    const cur = await f.inputValue().catch(() => "x");
    if (!cur || cur.trim() === "") {
      await f.fill(value, { timeout: FILL_T });
      return;
    }
  }
  throw new Error("nenhum campo de texto vazio visivel");
}

/** Marca todos os checkboxes visiveis (paginas de declaracoes). */
export async function checkAllCheckboxes(page: Page): Promise<void> {
  const boxes = page.getByRole("checkbox");
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) {
    const b = boxes.nth(i);
    if (await b.isVisible().catch(() => false)) await b.check({ timeout: FILL_T }).catch(() => {});
  }
}

/** Avanca de pagina (Next do formulario; ignora "Next page" da paginacao). */
export async function clickNext(page: Page): Promise<void> {
  await page.waitForTimeout(400); // settle: radios com reveal disparam postback AJAX antes do Next
  const n = page.getByRole("button", { name: /^next$/i }).filter({ hasNot: page.locator("[disabled]") }).first();
  await n.click({ timeout: 6000 });
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

/** Clica um botao/link pelo TEXTO (substring, case-insensitive). wc-button tem
 * icone no nome acessivel, entao casamos por hasText (conteudo visivel). */
export async function clickButton(page: Page, text: string): Promise<void> {
  const b = page
    .locator("button, a.wc-button, a[role=button], input[type=submit], input[type=button]")
    .filter({ hasText: text })
    .filter({ hasNot: page.locator("[disabled]") })
    .first();
  if ((await b.count()) === 0) throw new Error(`botao nao encontrado: ${text}`);
  await b.click({ timeout: 6000 });
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}
