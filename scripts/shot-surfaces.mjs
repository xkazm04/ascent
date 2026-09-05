import { chromium } from "@playwright/test";
const base = process.argv[2] || "http://localhost:3001";
const paths = process.argv.slice(3);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("console", m => m.type()==="error" && errs.push("console: "+m.text()));
for (const p of paths) {
  const name = p.replace(/[^a-z0-9]+/gi,"_").replace(/^_|_$/g,"") || "root";
  try {
    const resp = await page.goto(base+p, { waitUntil:"networkidle", timeout:60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: ".proto-shots/surf-"+name+".png", fullPage:true });
    process.stderr.write("[surf] "+p+" -> "+resp.status()+(errs.length?(" ERR "+errs.slice(0,4).join(" | ")):" ok")+"\n");
  } catch(e){ process.stderr.write("[surf] "+p+" FAILED "+e.message+"\n"); }
  errs.length=0;
}
await browser.close();
