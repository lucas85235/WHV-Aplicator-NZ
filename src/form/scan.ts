import type { Page } from "playwright";
import type { FieldKind } from "../types.js";

/** Um campo (ou grupo de radios) visivel na tela, com o texto que o identifica. */
export interface ScannedField {
  kind: FieldKind;
  /** Seletor estavel pra agir no campo (ou no 1o radio do grupo). */
  selector: string;
  name: string;
  label: string;
  /** Pergunta: legend do fieldset / heading mais proximo. Vale ouro nos radios. */
  question: string;
  options: string[];
  /** Valor atual (texto da opcao marcada / value do input). "" = vazio. */
  value: string;
  required: boolean;
  /** Seletores das opcoes (radio), na ordem de `options`. */
  optionSelectors: string[];
}

export interface PageSnapshot {
  url: string;
  heading: string;
  /** Texto visivel condensado (usado pra classificar a tela). */
  text: string;
  fields: ScannedField[];
  /** Rotulos dos botoes visiveis. */
  buttons: string[];
  /** Mensagens de erro/validacao na tela. */
  errors: string[];
}

/**
 * Varre o DOM e devolve TODO campo visivel com o texto que o identifica.
 * Generico de proposito: o formulario do INZ so existe depois que a cota abre,
 * entao o bot descobre a tela em runtime em vez de depender de seletores fixos.
 */
export async function scanPage(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => {
    const norm = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim();
    const vis = (el: Element): boolean => {
      const he = el as HTMLElement;
      if (he.hidden) return false;
      const st = getComputedStyle(he);
      if (st.display === "none" || st.visibility === "hidden") return false;
      return !!(he.offsetParent || el.getClientRects().length);
    };
    const cssEsc = (s: string): string =>
      window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");

    // Etiqueta cada campo com data-whv="<i>" (opcao de radio: "<i>-<k>").
    // Motivo: seletor CSS puro, valido no Playwright E dentro de evaluate ->
    // o preenchimento em lote acha o elemento sem re-consultar por label.
    // Limpa as etiquetas antigas antes (a tela pode ter sido re-renderizada).
    document.querySelectorAll("[data-whv]").forEach((e) => e.removeAttribute("data-whv"));
    let tagN = 0;
    const tag = (el: Element, suffix?: string): string => {
      const id = suffix == null ? String(tagN) : `${tagN}-${suffix}`;
      el.setAttribute("data-whv", id);
      return `[data-whv="${id}"]`;
    };

    const labelOf = (el: Element): string => {
      const e = el as HTMLInputElement;
      if (e.id) {
        const l = document.querySelector(`label[for="${cssEsc(e.id)}"]`);
        if (l && norm(l.textContent)) return norm(l.textContent);
      }
      const wrap = e.closest("label");
      if (wrap && norm(wrap.textContent)) return norm(wrap.textContent);
      const aria = e.getAttribute("aria-label");
      if (aria) return norm(aria);
      const lb = e.getAttribute("aria-labelledby");
      if (lb) {
        const t = lb
          .split(/\s+/)
          .map((id) => norm(document.getElementById(id)?.textContent))
          .filter(Boolean)
          .join(" ");
        if (t) return t;
      }
      if (e.placeholder) return norm(e.placeholder);
      const td = e.closest("td");
      if (td) {
        const row = td.closest("tr");
        const first = row?.querySelector("th, td");
        if (first && first !== td && norm(first.textContent)) return norm(first.textContent);
      }
      return "";
    };

    /** Pergunta: legend do fieldset ou bloco de texto mais proximo acima. */
    const questionOf = (el: Element): string => {
      const fs = el.closest("fieldset");
      if (fs) {
        const lg = fs.querySelector("legend");
        if (lg && norm(lg.textContent)) return norm(lg.textContent);
      }
      let node: Element | null = el;
      for (let up = 0; up < 8 && node; up++) {
        let sib = node.previousElementSibling;
        while (sib) {
          if (/^(H1|H2|H3|H4|H5|LEGEND|P|STRONG|SPAN|DIV|TD|TH|LABEL)$/.test(sib.tagName)) {
            const t = norm(sib.textContent);
            if (t.length > 3 && t.length < 300 && !sib.querySelector("input, select, textarea")) return t;
          }
          sib = sib.previousElementSibling;
        }
        node = node.parentElement;
      }
      return "";
    };

    const isRequired = (el: Element): boolean => {
      const e = el as HTMLInputElement;
      if (e.required || e.getAttribute("aria-required") === "true") return true;
      return /\*|required|mandatory/i.test(labelOf(el) + " " + questionOf(el));
    };

    const fields: ScannedField[] = [];
    const seenRadioGroup = new Set<string>();
    // select2 (visto no INZ em 07/10): o <select> real fica OCULTO e o widget mostra
    // "Select an Option" + uma caixa de busca. Digitar na busca nao seleciona nada.
    const isWidgetInput = (el: Element): boolean => {
      const id = (el as HTMLElement).id || "";
      return /^s2id_autogen/.test(id) || !!el.closest(".select2-container, .select2-drop, .select2-search, .chosen-container");
    };
    const isSelect2Native = (el: Element): boolean => {
      if (el.tagName !== "SELECT") return false;
      const id = (el as HTMLElement).id;
      const w = (id && document.getElementById(`s2id_${id}`)) || el.previousElementSibling;
      return !!w && /select2-container|chosen-container/.test((w as HTMLElement).className || "") && vis(w);
    };
    const inputs = [...document.querySelectorAll("input, select, textarea")].filter(
      (el) => !isWidgetInput(el) && (vis(el) || isSelect2Native(el)),
    );

    for (const el of inputs) {
      const tagName = el.tagName.toLowerCase();
      const e = el as HTMLInputElement;
      const type = (e.getAttribute("type") || "text").toLowerCase();

      if (tagName === "input" && ["hidden", "submit", "button", "image", "reset"].includes(type)) continue;

      if (tagName === "input" && type === "radio") {
        const key = e.name || questionOf(el);
        if (seenRadioGroup.has(key)) continue;
        seenRadioGroup.add(key);
        const grp = (
          e.name
            ? ([...document.querySelectorAll(`input[type="radio"][name="${cssEsc(e.name)}"]`)] as HTMLInputElement[])
            : [e]
        ).filter(vis);
        const list = grp.length ? grp : [e];
        const opts = list.map((r) => labelOf(r) || norm(r.value));
        const checked = list.find((r) => r.checked);
        const optSels = list.map((r, k) => tag(r, String(k)));
        fields.push({
          kind: "radio",
          selector: optSels[0] ?? "",
          name: e.name,
          label: opts.join(" / "),
          question: questionOf(el),
          options: opts,
          value: checked ? labelOf(checked) || norm(checked.value) : "",
          required: isRequired(el),
          optionSelectors: optSels,
        });
        tagN += 1;
        continue;
      }

      if (tagName === "input" && type === "checkbox") {
        fields.push({
          kind: "checkbox",
          selector: tag(el),
          name: e.name,
          label: labelOf(el),
          question: questionOf(el),
          options: [],
          value: e.checked ? "checked" : "",
          required: isRequired(el),
          optionSelectors: [],
        });
        tagN += 1;
        continue;
      }

      if (tagName === "select") {
        const s = el as unknown as HTMLSelectElement;
        const opts = [...s.options].map((o) => norm(o.text));
        const cur = norm(s.options[s.selectedIndex]?.text || "");
        fields.push({
          kind: "select",
          selector: tag(el),
          name: s.name,
          label: labelOf(el),
          question: questionOf(el),
          options: opts,
          value: /^(select|choose|please|--|$)/i.test(cur) ? "" : cur,
          required: isRequired(el),
          optionSelectors: [],
        });
        tagN += 1;
        continue;
      }

      if (tagName === "textarea") {
        fields.push({
          kind: "textarea",
          selector: tag(el),
          name: e.name,
          label: labelOf(el),
          question: questionOf(el),
          options: [],
          value: norm(e.value),
          required: isRequired(el),
          optionSelectors: [],
        });
        tagN += 1;
        continue;
      }

      if (type === "file") {
        fields.push({
          kind: "file",
          selector: tag(el),
          name: e.name,
          label: labelOf(el),
          question: questionOf(el),
          options: [],
          value: norm(e.value),
          required: isRequired(el),
          optionSelectors: [],
        });
        tagN += 1;
        continue;
      }

      const lab = labelOf(el);
      const meta = `${lab} ${e.name} ${e.id} ${e.placeholder || ""}`;
      const dateish = type === "date" || /date|dob|dd\/mm|mm\/yyyy/i.test(meta);
      fields.push({
        kind: dateish ? "date" : "text",
        selector: tag(el),
        name: e.name,
        label: lab,
        question: questionOf(el),
        options: [],
        value: norm(e.value),
        required: isRequired(el),
        optionSelectors: [],
      });
      tagN += 1;
    }

    const heading = [...document.querySelectorAll("h1, h2, h3, legend")]
      .filter(vis)
      .map((h) => norm(h.textContent))
      .filter(Boolean)
      .slice(0, 6)
      .join(" | ");

    const buttons = [
      ...document.querySelectorAll("button, input[type=submit], input[type=button], a[role=button], a.button"),
    ]
      .filter(vis)
      .map((b) => norm((b as HTMLInputElement).value || b.textContent))
      .filter(Boolean)
      .slice(0, 30);

    const errors = [
      ...document.querySelectorAll(
        ".error, .errors, .error-message, .field-error, [role=alert], .validation-summary-errors, .alert-danger",
      ),
    ]
      .filter(vis)
      .map((el) => norm(el.textContent))
      .filter((t) => t.length > 3)
      .slice(0, 10);

    const text = norm(document.body?.innerText || "").slice(0, 4000);

    return { url: location.href, heading, text, fields, buttons, errors };
  });
}

/** Assinatura da tela: muda quando a pagina muda (detecta "travou"). */
export function signature(s: PageSnapshot): string {
  return `${s.heading}::${s.fields.map((f) => f.selector).join(",")}`.slice(0, 400);
}
