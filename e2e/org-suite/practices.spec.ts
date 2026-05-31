import { test, expect } from "@playwright/test";

// Practice Library = the org's playbook, mined from its own best repos. Value (the differentiator):
// for each practice, an internal exemplar to learn from + the repos that could adopt it + a
// leak-free reusable *shape* — institutional AI knowledge that travels without the code.
test.describe("Org Practices — reuse across the company", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/org/vercel/practices");
  });

  test("the library frames reuse without leaking proprietary code", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Practice Library" })).toBeVisible();
    await expect(page.getByText(/reusable shape travels, the proprietary code doesn/)).toBeVisible();
  });

  test("each practice gives an exemplar, gap repos, and a reusable shape", async ({ page }) => {
    // several practices, each with a leak-free starter
    expect(await page.getByText("Reusable shape").count()).toBeGreaterThanOrEqual(5);
    // an internal exemplar to learn from, linking to its report
    await expect(page.getByText("Learn from").first()).toBeVisible();
    await expect(page.locator('a[href*="/report?repo="]').first()).toBeVisible();
    // repos that could adopt it next (systematic apply)
    await expect(page.getByText(/Could adopt next/).first()).toBeVisible();
  });
});
