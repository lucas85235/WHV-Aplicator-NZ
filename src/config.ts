import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig, AnswerBook, RuntimeConfig, Secrets } from "./types.js";
import { fileRules } from "./documents.js";
import { log } from "./log.js";

const root = process.cwd();
const cfgPath = (name: string) => resolve(root, "config", name);

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

/** Expande {{secao.campo}} do answers.json com valores de applicant.json. */
function expand(book: AnswerBook, applicant: Record<string, unknown>): AnswerBook {
  const get = (path: string): string | null => {
    let cur: unknown = applicant;
    for (const part of path.split(".")) {
      if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else return null;
    }
    return cur == null ? null : String(cur);
  };
  const rules = book.rules.map((r) => {
    const value = r.value.replace(/\{\{([\w.]+)\}\}/g, (_m, p: string) => {
      const v = get(p);
      if (v == null) {
        log.warn({ regra: r.id, ref: p }, "referencia {{...}} nao existe em applicant.json");
        return "";
      }
      return v;
    });
    return { ...r, value };
  });
  return { ...book, rules };
}

export async function loadConfig(): Promise<AppConfig> {
  const [applicant, answersRaw, documents, selectors, runtime] = await Promise.all([
    readJson<AppConfig["applicant"]>(cfgPath("applicant.json")),
    readJson<AnswerBook>(cfgPath("answers.json")),
    readJson<AppConfig["documents"]>(cfgPath("documents.json")),
    readJson<AppConfig["selectors"]>(cfgPath("selectors.json")),
    readJson<RuntimeConfig>(cfgPath("runtime.json")),
  ]);

  const answers = expand(answersRaw, applicant as Record<string, unknown>);
  // uploads declarados em documents.json entram como regras de campo 'file'
  answers.rules = [...answers.rules, ...fileRules(documents.documents)];

  let secrets: Secrets | null = null;
  const secretsPath = cfgPath("secrets.local.json");
  if (existsSync(secretsPath)) secrets = await readJson<Secrets>(secretsPath);

  return { applicant, answers, documents, selectors, runtime, secrets };
}
