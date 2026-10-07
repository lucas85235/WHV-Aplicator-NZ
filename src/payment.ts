import type { Page, Frame } from "playwright";
import type { AppConfig } from "./types.js";
import { tryAction } from "./util.js";
import { log } from "./log.js";

// Checkout do INZ (gateway neozelandes, normalmente Windcave/Payment Express,
// muitas vezes dentro de um iframe). O bot preenche o cartao e PARA: clicar
// "Pagar" e o eventual OTP/3-D Secure do banco sao SEMPRE manuais.

async function findCardScope(page: Page): Promise<Page | Frame> {
  for (const f of page.frames()) {
    const hit = await f
      .getByText(/card number|cardholder|n[uú]mero do cart[aã]o/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (hit) return f;
  }
  return page;
}

export async function fillPayment(page: Page, cfg: AppConfig): Promise<void> {
  if (!cfg.runtime.payment.autofillCard) {
    log.info("autofillCard=false - preenchimento manual do cartao.");
    return;
  }
  if (!cfg.secrets) {
    log.error("config/secrets.local.json ausente - copie secrets.example.json e preencha.");
    return;
  }
  const card = cfg.secrets.card;
  const onErr = cfg.runtime.flow.onError;
  const scope = await findCardScope(page);

  const fill = (name: string, rx: RegExp, val: string): Promise<boolean> =>
    tryAction(
      name,
      async () => {
        await scope.getByLabel(rx, { exact: false }).first().fill(val, { timeout: 4000 });
      },
      onErr,
    );

  await fill("nome do titular", /cardholder|name on card|titular/i, card.holderName);
  await fill("numero do cartao", /card number|n[uú]mero do cart/i, card.number);
  await fill("validade", /expiry|valid (thru|until)|MM ?\/ ?YY|validade/i, card.expiry);
  await fill("cvv", /cvv|cvc|security code|seguran[çc]a/i, card.cvv);

  // alguns gateways separam mes/ano em selects
  const [mm, yy] = card.expiry.split("/");
  if (mm && yy) {
    await tryAction(
      "validade (mes/ano separados)",
      async () => {
        await scope.getByLabel(/month/i, { exact: false }).first().selectOption(mm.trim(), { timeout: 2500 });
        await scope.getByLabel(/year/i, { exact: false }).first().selectOption(yy.trim(), { timeout: 2500 });
      },
      "skip",
    );
  }

  log.warn(">> CARTAO PREENCHIDO (best-effort). CONFIRA os campos, clique em pagar e faca o OTP do banco MANUALMENTE.");
}
