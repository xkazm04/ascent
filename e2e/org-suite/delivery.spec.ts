import { test, expect } from "@playwright/test";

// Delivery = how the org actually ships. Value: PR discipline, branch-protection guardrails
// (where AI output is/ isn't governed), and real commit activity.
test.describe("Org Delivery — how the org ships", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/org/vercel/delivery");
  });

  test("PR signals quantify shipping discipline", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Pull request signals" })).toBeVisible();
    await expect(page.getByText("Review coverage").first()).toBeVisible();
    await expect(page.getByText("Merge rate")).toBeVisible();
  });

  test("branch governance reveals where guardrails are missing", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Branch governance" })).toBeVisible();
    for (const t of ["Protect main", "Require review", "Require checks"]) {
      await expect(page.getByText(t)).toBeVisible();
    }
    // per-repo governance table — the risk-first view
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(10);
  });

  test("commit activity is shown (real, from GitHub)", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Commit activity" })).toBeVisible();
    await expect(page.getByText(/repo(s)? reporting/)).toBeVisible();
  });
});
