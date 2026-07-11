import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig, RuntimeConfig, Secrets } from "./types.js";

const root = process.cwd();
const cfgPath = (name: string) => resolve(root, "config", name);

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

export async function loadConfig(): Promise<AppConfig> {
  const [applicant, documents, selectors, runtime] = await Promise.all([
    readJson<AppConfig["applicant"]>(cfgPath("applicant.json")),
    readJson<AppConfig["documents"]>(cfgPath("documents.json")),
    readJson<AppConfig["selectors"]>(cfgPath("selectors.json")),
    readJson<RuntimeConfig>(cfgPath("runtime.json")),
  ]);

  let secrets: Secrets | null = null;
  const secretsPath = cfgPath("secrets.local.json");
  if (existsSync(secretsPath)) {
    secrets = await readJson<Secrets>(secretsPath);
  }

  return { applicant, documents, selectors, runtime, secrets };
}
