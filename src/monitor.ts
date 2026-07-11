import type { AppConfig } from "./types.js";
import { log } from "./log.js";

/**
 * Poll do status de vagas + alerta (som/desktop) e, se configurado, auto-disparo
 * do live(). TODO M9: definir statusUrl real e parser na calibracao.
 */
export async function monitor(cfg: AppConfig): Promise<void> {
  const { statusUrl, pollIntervalMs } = cfg.runtime.monitor;
  if (!statusUrl) {
    log.warn("runtime.monitor.statusUrl nao definido — configure na calibracao (M9).");
    return;
  }
  log.info({ statusUrl, pollIntervalMs }, "TODO: iniciar poll de vagas (M9)");
}
