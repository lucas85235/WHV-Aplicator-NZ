import { existsSync, statSync } from "node:fs";
import type { AppConfig, AnswerRule, JsonRecord } from "./types.js";
import { log } from "./log.js";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Confere os arquivos listados em config/documents.json.
 * No esquema WHS o INZ costuma NAO pedir upload na hora da inscricao (pede
 * depois, por email: raio-X, seguro, antecedentes). Mesmo assim deixamos tudo
 * pronto: se a tela pedir arquivo, o bot anexa sozinho.
 */
export function validateDocuments(cfg: AppConfig): boolean {
  let ok = true;
  for (const d of cfg.documents.documents) {
    const key = String(d["key"] ?? "?");
    const path = (d["path"] as string | null) ?? null;
    const required = d["required"] !== false;
    if (!path) {
      log[required ? "error" : "warn"]({ key }, "documento sem 'path'");
      if (required) ok = false;
      continue;
    }
    if (!existsSync(path)) {
      log[required ? "error" : "warn"]({ key, path }, "arquivo nao encontrado");
      if (required) ok = false;
      continue;
    }
    const mb = (statSync(path).size / 1024 / 1024).toFixed(1);
    if (statSync(path).size > MAX_BYTES) {
      log.warn({ key, path, mb }, "arquivo grande (>10MB) - o portal pode recusar");
    }
    log.info({ key, path, mb }, "documento OK");
  }
  return ok;
}

/** Vira regras de upload pro livro de respostas (campos input[type=file]). */
export function fileRules(docs: Array<JsonRecord>): AnswerRule[] {
  const out: AnswerRule[] = [];
  for (const d of docs) {
    const path = (d["path"] as string | null) ?? null;
    const match = (d["match"] as string | null) ?? null;
    if (!path || !match || !existsSync(path)) continue;
    out.push({ id: `doc:${String(d["key"] ?? "?")}`, match, kind: "file", value: path });
  }
  return out;
}
