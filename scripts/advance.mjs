import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pg = b.contexts()[0].pages()[0];
const onSummary = async () => /\/ola\/app/.test(pg.url()) && await pg.getByText("My applications").first().isVisible().catch(()=>false);
for (let i=0;i<6;i++){
  if (await onSummary()) break;
  const btn = pg.getByRole("button",{name:/^next$|continue|acknowledge|proceed|ok/i}).or(pg.getByRole("link",{name:/^next$|continue/i})).first();
  if (!(await btn.isVisible().catch(()=>false))) break;
  await btn.click().catch(()=>{});
  await pg.waitForLoadState("domcontentloaded").catch(()=>{});
  await pg.waitForTimeout(1000);
}
console.log("URL:", pg.url());
console.log("onSummary:", await onSummary());
console.log("heading:", (await pg.locator("h2,h3").allTextContents()).slice(0,2).join(" | "));
await b.close();
