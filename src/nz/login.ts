import type { Page } from "playwright";
import { authenticator } from "otplib";
import type { AppConfig } from "../types.js";
import { scanPage } from "../form/scan.js";
import { haystack } from "../form/answer.js";
import { log } from "../log.js";

// Sistema Working Holiday do INZ (portal antigo, separado do Immigration Online).
// A conta pode (e DEVE) ser criada semanas antes da cota abrir.

const LOGGED_IN = /my applications|application list|log ?out|sign out|welcome back|start a new application|apply now/i;
const LOGIN_FORM = /sign in|log ?in|username|forgotten your password/i;

export async function isLoggedIn(page: Page): Promise<boolean> {
  const snap = await scanPage(page).catch(() => null);
  if (!snap) return false;
  const hasPassword = snap.fields.some((f) => /password/i.test(haystack(f)));
  if (hasPassword) return false;
  return LOGGED_IN.test(`${snap.heading} ${snap.text}`);
}

/** Login no portal WHS: usuario + senha (+ TOTP se o INZ pedir). */
export async function login(page: Page, cfg: AppConfig): Promise<boolean> {
  const creds = cfg.secrets?.login;
  const url = cfg.runtime.urls.whsLogin;

  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(800);

  if (await isLoggedIn(page)) {
    log.info("Sessao ja logada.");
    return true;
  }

  if (!creds?.username || !creds?.password) {
    log.warn("secrets.login vazio -> logue MANUALMENTE nesta janela do Chrome. O bot usa a sessao aberta.");
    return false;
  }

  const snap = await scanPage(page);
  if (!LOGIN_FORM.test(`${snap.heading} ${snap.text}`) && !snap.fields.some((f) => /password/i.test(haystack(f)))) {
    log.warn({ url: page.url() }, "tela de login nao reconhecida");
  }

  const userField = snap.fields.find((f) => /user ?name|user ?id|email/i.test(haystack(f)) && f.kind === "text");
  const passField = snap.fields.find((f) => /password/i.test(haystack(f)));
  if (!userField || !passField) {
    log.error("campos de login nao encontrados -> logue manual");
    return false;
  }

  await page.locator(userField.selector).first().fill(creds.username).catch(() => {});
  await page.locator(passField.selector).first().fill(creds.password).catch(() => {});
  await clickLogin(page);
  await page.waitForTimeout(2000);

  if (creds.totpSecret) await fillTotp(page, creds.totpSecret);

  const ok = await isLoggedIn(page);
  log.info({ ok }, ok ? "LOGIN OK" : "login nao confirmado - confira a tela");
  return ok;
}

async function clickLogin(page: Page): Promise<void> {
  const b = page
    .locator("button, input[type=submit], input[type=button], a[role=button]")
    .filter({ hasText: /^\s*(log ?in|sign in|continue|submit)\s*$/i })
    .first();
  if ((await b.count()) > 0) {
    await b.click({ timeout: 6000 }).catch(() => {});
  } else {
    await page.keyboard.press("Enter").catch(() => {});
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

/** Se aparecer tela de codigo (2FA), gera o TOTP e envia. */
async function fillTotp(page: Page, secret: string): Promise<void> {
  const snap = await scanPage(page).catch(() => null);
  if (!snap) return;
  const codeField = snap.fields.find((f) => /code|otp|token|verif|one.?time|mfa|2fa/i.test(haystack(f)));
  if (!codeField) return;
  const code = authenticator.generate(secret.replace(/\s+/g, ""));
  log.info("tela de 2FA detectada -> preenchendo codigo");
  await page.locator(codeField.selector).first().fill(code).catch(() => {});
  await clickLogin(page);
  await page.waitForTimeout(1800);
}

/** Garante sessao logada antes de operar. */
export async function ensureLoggedIn(page: Page, cfg: AppConfig): Promise<boolean> {
  if (await isLoggedIn(page)) return true;
  return login(page, cfg);
}
