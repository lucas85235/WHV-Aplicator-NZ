import type { Page } from "playwright";

// Esperas ADAPTATIVAS. Um `waitForTimeout(700)` fixo por tela custa segundos de
// graca no total; aqui a gente observa uma assinatura barata da pagina e segue
// no instante em que ela muda/estabiliza.

/** Assinatura barata da tela (nao forca layout pesado). */
async function sig(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const h = document.querySelector("h1, h2, legend");
      return [
        location.href,
        document.readyState,
        document.querySelectorAll("input, select, textarea").length,
        // erros de validacao entram na assinatura: se o Save falhar e a tela so
        // mostrar "campo obrigatorio", isso conta como mudanca (nao ficamos presos)
        document.querySelectorAll(".error, .errors, .field-error, [role=alert]").length,
        (h?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      ].join("|");
    });
  } catch {
    return "@navegando"; // contexto destruido = a pagina trocou
  }
}

/** Espera a tela parar de mudar (2 leituras iguais). Retorna ms gastos. */
export async function settle(page: Page, maxMs = 1200, stepMs = 30): Promise<number> {
  const t0 = Date.now();
  let last = await sig(page);
  let stable = 0;
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(stepMs);
    const cur = await sig(page);
    if (cur === last && !cur.startsWith("@") && cur.includes("|complete|")) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
    }
    last = cur;
  }
  return Date.now() - t0;
}

/**
 * Espera a tela MUDAR em relacao a `prev`. So devolve quando a tela nova esta
 * carregada (readyState=complete) - senao o proximo scan pegaria DOM pela metade
 * e acharia "0 campos". Depois de 1,5s aceita a tela mesmo sem 'complete'
 * (imagem/tracker lento nao pode segurar o bot).
 */
export async function waitForChange(
  page: Page,
  prev: string,
  maxMs = 8000,
  nav?: NavWatch,
  stepMs = 30,
  /** Se nada aconteceu (sem navegacao, sem mudanca, tela pronta), desiste antes. */
  idleMs = 2500,
): Promise<number> {
  const t0 = Date.now();
  let navegouNoPoll = false;
  try {
    while (Date.now() - t0 < maxMs) {
      const cur = await sig(page);
      // postback que recarrega a MESMA tela (mesma URL, mesmos campos) nao muda a
      // assinatura em nada. Sem detectar a navegacao em si, o bot esperaria o teto
      // inteiro (15s) numa tela que ja estava pronta. Por isso o evento de
      // navegacao (NavWatch) e a fonte principal; o poll e so reforco.
      if (cur.startsWith("@") || cur.includes("|loading|") || cur.includes("|interactive|")) {
        navegouNoPoll = true;
        await page.waitForTimeout(stepMs);
        continue;
      }
      const navegou = navegouNoPoll || (nav?.saw() ?? false);
      const pronto = cur.includes("|complete|");
      if ((cur !== prev || navegou) && (pronto || Date.now() - t0 > 1500)) return Date.now() - t0;
      // Clique que nao fez nada (botao errado, JS bloqueou): nao adianta esperar o
      // teto de 15s - devolve rapido pro walk tentar outra coisa.
      if (!navegou && cur === prev && pronto && Date.now() - t0 > idleMs) return Date.now() - t0;
      await page.waitForTimeout(stepMs);
    }
    return Date.now() - t0;
  } finally {
    nav?.off();
  }
}

export interface NavWatch {
  /** true se a pagina navegou desde que o watch foi armado. */
  saw: () => boolean;
  off: () => void;
}

/**
 * Arma a escuta de navegacao ANTES do clique. Deterministico: nao depende de
 * pegar o instante certo no poll (um postback rapido acontece entre dois polls).
 */
export function armNavigation(page: Page): NavWatch {
  let navegou = false;
  const onNav = (frame: { parentFrame: () => unknown }): void => {
    if (frame.parentFrame() === null) navegou = true; // so o frame principal
  };
  page.on("framenavigated", onNav);
  let desligado = false;
  return {
    saw: () => navegou,
    off: () => {
      if (desligado) return;
      desligado = true;
      page.off("framenavigated", onNav);
    },
  };
}

export const pageSig = sig;

/**
 * Acha e clica o botao de avancar numa unica ida ao browser. O clique e agendado
 * pro proximo tick: se ele navegar, o evaluate ja retornou (sem "context destroyed").
 */
export async function fastClick(page: Page, labels: string[], deny?: string): Promise<string | null> {
  return page.evaluate(({ wanted, denySrc }: { wanted: string[]; denySrc: string | null }) => {
    const denyRe = denySrc ? new RegExp(denySrc, "i") : null;
    const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (el: Element) => {
      const he = el as HTMLElement;
      return !!(he.offsetParent || el.getClientRects().length);
    };
    const cands = [
      ...document.querySelectorAll(
        "button, input[type=submit], input[type=button], a[role=button], a.button, a.btn",
      ),
    ].filter((el) => vis(el) && !(el as HTMLButtonElement).disabled);

    const textOf = (el: Element) => norm((el as HTMLInputElement).value || el.textContent);
    // lista negra: 'Continue' casaria 'Continue to payment' no match por substring
    const pode = (el: Element) => !denyRe || !denyRe.test(textOf(el));

    // 1a passada: texto exato (na ordem de prioridade da lista)
    for (const w of wanted) {
      const W = w.toLowerCase();
      const hit = cands.find((el) => pode(el) && textOf(el).toLowerCase() === W);
      if (hit) {
        setTimeout(() => (hit as HTMLElement).click(), 0);
        return textOf(hit);
      }
    }
    // 2a passada: contem o texto
    for (const w of wanted) {
      const W = w.toLowerCase();
      const hit = cands.find((el) => pode(el) && textOf(el).toLowerCase().includes(W));
      if (hit) {
        setTimeout(() => (hit as HTMLElement).click(), 0);
        return textOf(hit);
      }
    }
    return null;
  }, { wanted: labels, denySrc: deny ?? null });
}

/** Idem pra links de secao (menu Personal / Health / Character / ...). */
export async function fastClickLink(page: Page, pattern: string, visited: string[]): Promise<string | null> {
  return page.evaluate(
    ({ pat, seen }: { pat: string; seen: string[] }) => {
      const re = new RegExp(pat, "i");
      const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
      const vis = (el: Element) => !!((el as HTMLElement).offsetParent || el.getClientRects().length);
      const hit = [...document.querySelectorAll("a")]
        .filter(vis)
        .find((a) => {
          const t = norm(a.textContent);
          return t.length > 2 && t.length < 60 && re.test(t) && !seen.includes(t);
        });
      if (!hit) return null;
      setTimeout(() => (hit as HTMLElement).click(), 0);
      return norm(hit.textContent);
    },
    { pat: pattern, seen: visited },
  );
}
