import { existsSync, statSync } from "node:fs";
import type { Page } from "playwright";
import type { AppConfig } from "./types.js";
import { clickButton, selectDropdown, fillLabel } from "./locators.js";
import { tryAction } from "./util.js";
import { log } from "./log.js";

const MAX_BYTES = 5 * 1024 * 1024;

/** Valida que os documentos existem, no tamanho correto. */
export function validateDocuments(cfg: AppConfig): boolean {
  let ok = true;
  for (const d of cfg.documents.documents) {
    const key = String(d["key"] ?? "?");
    const path = (d["path"] as string | null) ?? null;
    if (!path) {
      log.warn({ key }, "documento sem 'path' (sera pulado / justificado)");
      ok = false;
      continue;
    }
    if (!existsSync(path)) {
      log.error({ key, path }, "arquivo nao encontrado");
      ok = false;
      continue;
    }
    if (statSync(path).size > MAX_BYTES) {
      log.error({ key, path }, "arquivo > 5MB");
      ok = false;
      continue;
    }
    log.info({ key, path }, "documento OK");
  }
  return ok;
}

/** Preenche a caixa de justificativa que o site abre quando falta um doc
 * obrigatorio (ex: certificado de ingles). Retorna true se preencheu algo. */
export async function fillMissingDocJustification(page: Page, cfg: AppConfig): Promise<boolean> {
  const text = (cfg.documents as Record<string, unknown>)["missingDocJustification"] as string | undefined;
  if (!text) return false;
  const areas = page.locator("textarea");
  const n = await areas.count();
  let filled = 0;
  for (let i = 0; i < n; i += 1) {
    const a = areas.nth(i);
    if (!(await a.isVisible().catch(() => false))) continue;
    const cur = await a.inputValue().catch(() => "");
    if (!cur || cur.trim() === "") {
      await a.fill(text).catch(() => {});
      filled += 1;
    }
  }
  if (filled) log.info({ caixas: filled }, "justificativa de doc faltante preenchida");
  return filled > 0;
}

/** Anexa os documentos na pagina "Attach documents". CALIBRADO no DOM real:
 * 5 slots FIXOS (na ordem do config), cada um com um dropdown "Document Type" +
 * um input[type=file]. Pareia por indice (slot i <-> documents[i]). Seleciona o
 * tipo (siteType) e sobe o arquivo. Slot sem arquivo (ingles) fica p/ justificar. */
export async function ensureDocumentsAttached(page: Page, cfg: AppConfig): Promise<void> {
  const onErr = cfg.runtime.flow.onError;
  const docs = cfg.documents.documents;
  // revela todos os slots
  await clickButton(page, "Expand all").catch(() => {});
  await page.waitForTimeout(1000);
  const typeSelects = page.getByLabel("Document Type", { exact: false });
  const fileInputs = page.locator("input[type=file]");
  const nSel = await typeSelects.count();
  const nFile = await fileInputs.count();
  log.info({ selects: nSel, files: nFile, docs: docs.length }, "attach documents: slots encontrados");

  for (let i = 0; i < docs.length; i += 1) {
    const d = docs[i] as Record<string, unknown>;
    const key = String(d["key"] ?? `slot${i}`);
    const path = (d["path"] as string | null) ?? null;
    const siteType = (d["siteType"] as string) ?? "";
    if (!path || !existsSync(path)) {
      log.warn({ key }, "sem arquivo — slot fica vazio (justificar depois)");
      continue;
    }
    if (i >= nFile) {
      log.warn({ key, i, nFile }, "slot alem dos file inputs disponiveis — pular");
      continue;
    }
    await tryAction(
      `anexar ${key} (slot ${i}: ${siteType})`,
      async () => {
        // 1) seleciona o Document Type no dropdown do slot i (nao usa .first())
        const sel = typeSelects.nth(i);
        if (await sel.count()) {
          const opt = await sel.evaluate((el, want) => {
            const W = String(want).replace(/\s+/g, " ").trim().toUpperCase();
            const opts = [...(el as HTMLSelectElement).options].map((o) => o.text.replace(/\s+/g, " ").trim());
            return (
              opts.find((t) => t.toUpperCase() === W) ||
              opts.find((t) => t.toUpperCase().includes(W)) ||
              // fallback: 1a opcao real (nao placeholder / nao "Other")
              opts.find((t) => t && !/^please select|^-+$|^other\b/i.test(t)) ||
              null
            );
          }, siteType);
          if (opt) await sel.selectOption({ label: opt }, { timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(600); // postback do dropdown
        }
        // 2) Description do slot i (opcional, mas preenche por seguranca)
        const descInput = page.getByLabel("Description", { exact: false }).nth(i);
        if (await descInput.count()) await descInput.fill(String(d["description"] ?? "")).catch(() => {});
        // 3) escolhe o arquivo no input do slot i (upload real acontece no Next)
        await fileInputs.nth(i).setInputFiles(path, { timeout: 8000 });
        await page.waitForTimeout(800); // upload/postback
      },
      onErr,
    );
  }
  await page.waitForTimeout(1200);
}
