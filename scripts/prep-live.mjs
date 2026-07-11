// Prepara estado limpo pro live valendo: garante login, leva o browser pro summary
// (/ola/app) e RESETA status.json (tira o PAST-GATE falso da calibracao).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../dist/src/config.js";
import { ensureLoggedIn } from "../dist/src/login.js";
const cfg = await loadConfig();
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const ok = await ensureLoggedIn(pg, cfg);
console.log("logado:", ok);
await pg.goto("https://online.immi.gov.au/ola/app", { waitUntil: "domcontentloaded" }).catch(() => {});
await pg.waitForTimeout(1500);
const h = (await pg.locator("h1,h2,h3").allTextContents().catch(() => [])).join(" | ").replace(/Online Lodgement.*visa \|?/i, "").trim().slice(0, 60);
console.log("browser em:", h);
const hasEdit = await pg.locator('button:has-text("Edit"), a:has-text("Edit")').first().isVisible().catch(() => false);
console.log("summary c/ Edit visivel:", hasEdit);
// reseta status.json (neutro -> watchdog reinicia live limpo)
writeFileSync("artifacts/status.json", JSON.stringify({ ts: 0, iso: "reset", state: "idle", detail: "reset manual - gate fechado, aguardando live" }, null, 2));
console.log("status.json resetado -> idle");
await b.close();
