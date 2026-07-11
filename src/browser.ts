import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import type { RuntimeConfig } from "./types.js";
import { log } from "./log.js";

export interface Session {
  browser: Browser | null;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/**
 * Anexa a um Chrome ja aberto com --remote-debugging-port (sessao real, logada
 * manualmente pelo usuario). Fallback: lanca um Chrome com perfil persistente.
 */
export async function openSession(rt: RuntimeConfig): Promise<Session> {
  if (rt.browser.mode === "attach-cdp") {
    const url = `http://${rt.browser.cdp.host}:${rt.browser.cdp.port}`;
    log.info({ url }, "Anexando ao Chrome via CDP");
    const browser = await chromium.connectOverCDP(url);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    context.setDefaultTimeout(rt.timeouts.defaultMs);
    context.setDefaultNavigationTimeout(rt.timeouts.navigationMs);
    return {
      browser,
      context,
      page,
      close: async () => {
        // NAO fechar o Chrome do usuario; so soltar a conexao CDP.
        await browser.close();
      },
    };
  }

  log.info("Lancando Chrome com perfil persistente (fallback)");
  const context = await chromium.launchPersistentContext(rt.browser.launchFallback.userDataDir, {
    channel: rt.browser.launchFallback.channel,
    headless: rt.browser.launchFallback.headless,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  context.setDefaultTimeout(rt.timeouts.defaultMs);
  context.setDefaultNavigationTimeout(rt.timeouts.navigationMs);
  return {
    browser: null,
    context,
    page,
    close: async () => {
      await context.close();
    },
  };
}
