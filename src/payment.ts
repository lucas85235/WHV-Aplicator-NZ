import type { Page, Frame } from "playwright";
import type { AppConfig } from "./types.js";
import { tryAction } from "./util.js";
import { log } from "./log.js";

/** Acha o frame do checkout (CommBank costuma vir em iframe). */
async function findCardScope(page: Page): Promise<Page | Frame> {
  for (const f of page.frames()) {
    const hit = await f
      .getByText(/card number|n[uú]mero do cart[aã]o/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (hit) return f;
  }
  return page;
}

/**
 * Preenche o checkout do Commonwealth Bank. NUNCA clica "Pagar" (stopBeforePay).
 * O OTP do banco e SEMPRE manual. Best-effort, blind.
 */
export async function fillPayment(page: Page, cfg: AppConfig): Promise<void> {
  if (!cfg.runtime.payment.autofillCard) {
    log.info("autofillCard=false — preenchimento manual do cartao.");
    return;
  }
  if (!cfg.secrets) {
    log.error("config/secrets.local.json ausente — copie secrets.example.json e preencha.");
    return;
  }
  const card = cfg.secrets.card;
  const onErr = cfg.runtime.flow.onError;
  const scope = await findCardScope(page);

  const fill = (name: string, rx: RegExp, val: string): Promise<boolean> =>
    tryAction(name, async () => {
      await scope.getByLabel(rx, { exact: false }).first().fill(val);
    }, onErr);

  await fill("nome titular", /titular|holder|name on card/i, card.holderName);
  await fill("numero do cartao", /n[uú]mero do cart|card number/i, card.number);
  await fill("validade", /validade|expiry|MM ?\/ ?YY/i, card.expiry);
  await fill("cvv", /seguran[çc]a|security|cvv|cvc/i, card.cvv);

  log.warn(">> CARTAO PREENCHIDO (best-effort). CONFIRA os campos, clique 'Pagar' e insira o OTP do banco MANUALMENTE.");
}
