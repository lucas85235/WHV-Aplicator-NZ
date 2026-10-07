import type { Page } from "playwright";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { log } from "./log.js";

/** Escreve um heartbeat/status pro watchdog e pra IA supervisora lerem. */
export function writeStatus(dir: string, state: string, extra: Record<string, unknown> = {}): void {
  try {
    mkdirSync(dir, { recursive: true });
    const s = { ts: Date.now(), iso: new Date().toISOString(), state, ...extra };
    writeFileSync(resolve(dir, "status.json"), JSON.stringify(s, null, 2));
  } catch {
    /* best-effort */
  }
}

let shotN = 0;

export async function screenshot(page: Page, name: string, dir: string, fullPage = false): Promise<void> {
  try {
    mkdirSync(dir, { recursive: true });
    shotN += 1;
    const file = resolve(dir, `${String(shotN).padStart(2, "0")}-${name}.png`);
    // fullPage forca re-layout da pagina inteira (~300-800ms). Viewport: ~60-150ms.
    await page.screenshot({ path: file, fullPage });
    log.debug({ file }, "screenshot");
  } catch (e) {
    log.debug({ err: shortErr(e) }, "screenshot falhou");
  }
}

/**
 * Executa uma acao de preenchimento de forma tolerante a falha. Blind = seletor
 * pode nao bater; entao NUNCA lanca: loga e segue, deixando o campo pro humano.
 * Se onError='pause', apita e espera Enter antes de seguir.
 */
export async function tryAction(
  name: string,
  fn: () => Promise<void>,
  onError: "skip" | "pause" = "skip",
): Promise<boolean> {
  try {
    await fn();
    log.info({ campo: name }, "ok");
    return true;
  } catch (e) {
    log.warn({ campo: name, err: shortErr(e) }, "NAO PREENCHEU — resolver manual");
    if (onError === "pause") {
      beep();
      await waitEnter(`Assuma o campo "${name}" na tela e tecle ENTER para continuar...`);
    }
    return false;
  }
}

export function beep(): void {
  process.stdout.write("");
}

export function waitEnter(msg: string): Promise<void> {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n>> ${msg}\n`, () => {
      rl.close();
      res();
    });
  });
}

export function shortErr(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return (s.split("\n")[0] ?? "").slice(0, 140);
}
