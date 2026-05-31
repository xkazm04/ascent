import { test, expect } from "@playwright/test";

// Repositories = the fleet at a glance. Value: which repos lead and lag, and where each is
// strong/weak across the eight dimensions — a map for where to apply the org's practices.
test.describe("Org Repositories — leaders & laggards", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/org/vercel/repositories");
  });

  test("leaderboard lists the fleet, each repo linking to its report", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(10);
    await expect(page.locator('a[href*="/report?repo="]').first()).toBeVisible();
  });

  test("heatmap exposes per-dimension strengths and weaknesses", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Repo × dimension heatmap" })).toBeVisible();
    for (const d of ["AI Tooling", "Testing", "AI Process"]) {
      await expect(page.getByText(d, { exact: true }).first()).toBeVisible();
    }
  });
});
