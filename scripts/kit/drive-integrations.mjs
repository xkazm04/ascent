// Drives the Integrations Prism level: open a row, Esc, Back, prev/next, deep link, and the empty secret field.
// Altimeter ignores the hash and keeps the card stack.
//   node scripts/kit/drive-integrations.mjs [--base http://localhost:3001]
import { chromium } from "@playwright/test";

const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3001";
if (/:3000(\/|$)/.test(base)) process.exit(2);
const URL = `${base}/org/kiro?tab=integrations`;
const browser = await chromium.launch();
let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "pass" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fails++;
};

async function fresh(theme, url = URL) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "ascent-theme", value: theme, url: base }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const skip = page.getByRole("button", { name: "Skip setup" });
  if (await skip.count()) {
    await skip.first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
  return { page, errs, ctx };
}

{
  const { page, errs, ctx } = await fresh("prism");
  check("prism: overview, no level", (await page.locator("[data-surface='overview']").count()) === 1 && (await page.locator("[data-role='level-nav']").count()) === 0);
  check("prism: statement", (await page.locator("main").innerText()).includes("Spend reaches a repository"));
  await page.getByRole("button", { name: /GitLab/ }).click();
  await page.waitForTimeout(400);
  check("open gitlab: hash", (await page.evaluate(() => location.hash)) === "#gitlab");
  check("open gitlab: level replaces overview", (await page.locator("[data-surface='level']").count()) === 1 && (await page.locator("[data-surface='overview']").count()) === 0);
  check("open gitlab: focus in the level", await page.evaluate(() => document.activeElement?.closest("#integration-level-title") != null));
  check("gitlab token is empty", (await page.locator("#gitlab-token").inputValue()) === "");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Esc: overview, hash cleared", (await page.locator("[data-surface='overview']").count()) === 1 && (await page.evaluate(() => location.hash)) === "");
  await page.getByRole("button", { name: /GitLab/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Next: Claude Code" }).click();
  await page.waitForTimeout(400);
  check("next walks to Claude Code", (await page.evaluate(() => location.hash)) === "#claude-code");
  const claude = await page.locator("main").innerText();
  if (claude.includes("Ingest is not configured")) check("claude: no token rendered", !claude.includes("asc_otel"));
  else {
    const value = await page.locator("#claude-token").inputValue();
    check("claude: token masked", value.includes("•") && value.startsWith("asc_otel."));
  }
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await page.waitForTimeout(400);
  check("Back closes the level", (await page.locator("[data-surface='overview']").count()) === 1);
  check("prism: no console errors", errs.length === 0, errs[0] ?? "");
  await ctx.close();
}

{
  const { page, errs, ctx } = await fresh("prism", `${URL}#openai`);
  await page.waitForTimeout(400);
  check("deep link: openai level", (await page.evaluate(() => location.hash)) === "#openai" && (await page.locator("[data-surface='level']").count()) === 1);
  const text = await page.locator("main").innerText();
  check("deep link: names OpenAI", text.includes("OpenAI"));
  check("deep link: no console errors", errs.length === 0, errs[0] ?? "");
  await page.goBack();
  await page.waitForTimeout(400);
  await ctx.close();
}

{
  const { page, errs, ctx } = await fresh("altimeter", `${URL}#gitlab`);
  const text = await page.locator("main").innerText();
  const folded = text.toLowerCase();
  check("altimeter: card stack remains", folded.includes("how spend maps to repos") && !folded.includes("spend reaches a repository"));
  check("altimeter: no level nav", (await page.locator("[data-role='level-nav']").count()) === 0);
  check("altimeter: no console errors", errs.length === 0, errs[0] ?? "");
  await ctx.close();
}

await browser.close();
console.log(fails ? `FAIL ${fails}` : "ok");
process.exit(fails ? 1 : 0);
