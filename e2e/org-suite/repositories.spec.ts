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
    // Retrying assertions, not count(): count() takes ONE non-retrying sample, so it read a partial
    // table mid-render in a full-suite run while passing in isolation against an already-warm page.
    //
    // The old bar was 10 rows, a number that came from the documented 20-repo seed. This fixture has 7
    // SCANNED repos (the leaderboard lists scanned ones), so 10 could not pass — and lowering it to 7
    // would just re-pin the test to today's seed size. What the test actually claims is in its name:
    // the fleet is listed, and EVERY row links to its report. That is asserted directly below, with a
    // small floor to keep a one-row fleet from satisfying it.
    await expect(rows.nth(4)).toBeVisible();
    await expect(page.locator('table tbody tr a[href^="/report/"]')).toHaveCount(await rows.count());
  });

  // The repo × dimension heatmap USED to be asserted here. It now renders on the Overview tab as
  // "Dimension heatmap" (RepoDimensionHeatmap, mounted by OverviewFleetPanel), so the assertion moved
  // to overview.spec.ts with the panel — it is not dropped. What this tab genuinely offers alongside
  // the leaderboard is the freshness read, so that is what is pinned here instead.
  test("pairs the leaderboard with a freshness read on the fleet", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Context half-life" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Segments" })).toBeVisible();
  });
});
