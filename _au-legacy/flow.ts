import type { Page } from "playwright";
import type { AppConfig } from "./types.js";
import { clickButton, checkAllCheckboxes } from "./locators.js";
import { tryAction } from "./util.js";
import { log } from "./log.js";

/** Abre a aplicacao: retoma a salva (Edit) ou cria nova + seleciona o visto 462. */
export async function startApplication(page: Page, cfg: AppConfig): Promise<void> {
  const onErr = cfg.runtime.flow.onError;
  if (cfg.runtime.flow.startMode === "resume") {
    log.info("Abrindo aplicacao SALVA (Edit)...");
    await tryAction("abrir app salva (Edit)", () => clickButton(page, "Edit"), onErr);
    // esperar sair do summary
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(300);
      if (!(await page.getByText("My applications summary").first().isVisible().catch(() => false))) break;
    }
    return;
  }
  log.info("Criando NOVA aplicacao...");
  await tryAction("new application", () => clickButton(page, "New application"), onErr);
  await tryAction("Working Holiday Maker", () => clickButton(page, "Working Holiday Maker"), onErr);
  await tryAction("Work and Holiday visa (462)", () => clickButton(page, "Work and Holiday visa (462)"), onErr);
  await acceptTerms(page, cfg);
}

/** Pagina 1: Terms and Conditions. No form real basta clicar Next (sem checkbox). */
export async function acceptTerms(page: Page, cfg: AppConfig): Promise<void> {
  const onErr = cfg.runtime.flow.onError;
  await tryAction("aceitar termos (checkbox se houver)", () => checkAllCheckboxes(page), onErr);
}

/** Pagina de revisao final antes de submeter. */
export async function reviewAndConfirm(page: Page, cfg: AppConfig): Promise<void> {
  const onErr = cfg.runtime.flow.onError;
  await tryAction("declaracoes da revisao", () => checkAllCheckboxes(page), onErr);
}

/** Clica 'Submit now' (nao envia; leva ao pagamento). */
export async function submitNow(page: Page): Promise<void> {
  await clickButton(page, "Submit now");
}
