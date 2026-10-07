import type { Page } from "playwright";
import { authenticator } from "otplib";
import type { AppConfig } from "./types.js";
import { clickButton } from "./locators.js";
import { log } from "./log.js";

const LOGIN_URL = "https://online.immi.gov.au/lusc/login";
const SUMMARY_URL = "https://online.immi.gov.au/ola/app";

async function isLoginPage(page: Page): Promise<boolean> {
  return page.locator("#password, input[type=password]").first().isVisible().catch(() => false);
}

async function onSummary(page: Page): Promise<boolean> {
  if (/\/ola\/app/.test(page.url())) {
    return page.getByText("My applications").first().isVisible().catch(() => false);
  }
  return false;
}

/** Detecta a tela de 2FA (input de codigo do authenticator). */
async function findCodeSelector(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const vis = (el: Element) => !!((el as HTMLElement).offsetParent || el.getClientRects().length);
    const ins = ([...document.querySelectorAll("input")] as HTMLInputElement[]).filter(vis).filter((i) => {
      const t = (i.getAttribute("type") || "text").toLowerCase();
      return ["text", "tel", "number", "password"].includes(t);
    });
    const meta = (i: HTMLInputElement) => `${i.id} ${i.name} ${i.getAttribute("aria-label") || ""} ${i.placeholder || ""}`.toLowerCase();
    const codeish = ins.find((i) => /code|otp|token|auth|verif|one.?time|pin|mfa|2fa/.test(meta(i)));
    const target = codeish || ins.find((i) => !i.value) || ins[0];
    if (!target) return null;
    if (target.id) return `#${CSS.escape(target.id)}`;
    if (target.name) return `input[name="${target.name}"]`;
    return null;
  });
}

/** Marca "trust/remember this device" se existir (evita 2FA nas proximas). */
async function trustDevice(page: Page): Promise<void> {
  const cb = page.getByRole("checkbox").filter({ hasText: /trust|remember|don.t ask|this device/i }).first();
  if (await cb.isVisible().catch(() => false)) await cb.check().catch(() => {});
  // fallback: qualquer checkbox visivel na tela de 2FA
  const any = page.getByRole("checkbox").first();
  if (await any.isVisible().catch(() => false)) await any.check().catch(() => {});
}

async function clickByText(page: Page, rx: RegExp): Promise<boolean> {
  const b = page.getByRole("button", { name: rx }).or(page.getByRole("link", { name: rx })).first();
  if (await b.isVisible().catch(() => false)) {
    await b.click().catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return true;
  }
  return false;
}

/**
 * Login automatico: usuario/senha + codigo TOTP do authenticator.
 * Se secrets.login ausente, assume que o Chrome autopreenche e so submete.
 * O OTP do BANCO (no pagamento) e outra coisa - esse continua manual.
 */
export async function autoLogin(page: Page, cfg: AppConfig): Promise<boolean> {
  const lg = cfg.secrets?.login;
  log.info("Login automatico...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(600);

  if (lg?.username) await page.locator("#username").fill(lg.username).catch(() => {});
  if (lg?.password) await page.locator("#password").fill(lg.password).catch(() => {});
  await clickByText(page, /^log ?in$/i);
  await page.waitForTimeout(1800);

  // ja entrou direto? (dispositivo confiavel -> pode cair em telas de aviso)
  await advancePostLogin(page);
  if (await onSummary(page)) {
    log.info("LOGIN OK (sem 2FA)");
    return true;
  }

  // 2FA
  if (!lg?.totpSecret) {
    log.warn(">> Tela de 2FA. Sem 'totpSecret' no config -> digite o codigo do Authenticator MANUALMENTE.");
    return false;
  }
  const sel = await findCodeSelector(page);
  if (!sel) {
    log.warn("nao achei o campo do codigo 2FA -> resolver manual");
    return false;
  }
  const code = authenticator.generate(lg.totpSecret.replace(/\s+/g, ""));
  log.info("codigo 2FA gerado, preenchendo...");
  await page.locator(sel).first().fill(code).catch(() => {});
  await trustDevice(page);
  if (!(await clickByText(page, /verify|continue|log ?in|submit|next|confirm/i))) {
    await page.keyboard.press("Enter").catch(() => {});
  }
  await page.waitForTimeout(2000);

  await advancePostLogin(page);
  const ok = await onSummary(page);
  log.info({ ok }, ok ? "LOGIN OK (2FA)" : "login nao confirmado - verifique a tela");
  return ok;
}

/** Passa por telas de aviso pos-login ("Login successful", notices) ate o summary.
 * Usa clickButton (hasText) - wc-button tem icone no nome acessivel. */
async function advancePostLogin(page: Page): Promise<void> {
  const labels = ["Next", "Continue", "Acknowledge", "Proceed", "I agree", "OK"];
  for (let i = 0; i < 5; i++) {
    if (await onSummary(page)) return;
    let clicked = false;
    for (const t of labels) {
      try {
        await clickButton(page, t);
        clicked = true;
        break;
      } catch {
        /* proximo label */
      }
    }
    if (!clicked) return;
    await page.waitForTimeout(1200);
  }
}

/** Garante sessao logada antes de operar. Retorna true se logado. */
export async function ensureLoggedIn(page: Page, cfg: AppConfig): Promise<boolean> {
  await page.goto(SUMMARY_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(800);
  if (await onSummary(page)) {
    log.info("Sessao ja logada.");
    return true;
  }
  if (await isLoginPage(page)) return autoLogin(page, cfg);
  // estado incerto: tenta login
  return autoLogin(page, cfg);
}
