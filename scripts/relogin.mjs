// Re-loga na sessao CDP usando o autoLogin do bot (username/senha + TOTP).
import { chromium } from "playwright";
import { loadConfig } from "../dist/src/config.js";
import { ensureLoggedIn } from "../dist/src/login.js";
const cfg = await loadConfig();
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const ok = await ensureLoggedIn(pg, cfg);
console.log("logado:", ok);
console.log("url:", pg.url());
await b.close();
