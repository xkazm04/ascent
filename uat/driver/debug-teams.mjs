import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
await page.goto("http://localhost:3000/org/vercel", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^Intel/ }).first().click({ timeout: 3000 });
await page.waitForTimeout(300);
const links = await page.locator('nav[aria-label="Organization sections"] a').all();
for (const l of links) {
  console.log(JSON.stringify(await l.innerText()), await l.getAttribute("href"));
}
await browser.close();
