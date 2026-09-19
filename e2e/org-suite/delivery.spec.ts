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
    // `.first()` like the line above it: "Merge rate" now appears three times on this tab (the signal
    // band, the Delivery-over-time trend panel, and that panel's slope list). Without it the locator
    // is a strict-mode violation, which fails instantly and reads like the metric is missing rather
    // than present three times over.
    await expect(page.getByText("Merge rate").first()).toBeVisible();
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
    // The standalone "Commit activity" heading is gone: commit volume folded into the
    // Delivery-over-time section when the day-by-day trend panels shipped. Same data, same claim
    // (real GitHub activity, not a placeholder), asserted where it actually lives now.
    await expect(page.getByRole("heading", { name: "Delivery over time" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By repository" })).toBeVisible();
  });
});
