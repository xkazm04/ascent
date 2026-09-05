import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
await page.goto("http://localhost:3000/org/vercel/executive", { waitUntil: "domcontentloaded", timeout: 60000 });
for (const wait of [1000, 2000, 3000, 5000, 8000, 12000]) {
  await page.waitForTimeout(wait === 1000 ? 1000 : wait - [1000,2000,3000,5000,8000,12000][[1000,2000,3000,5000,8000,12000].indexOf(wait)-1]);
}
