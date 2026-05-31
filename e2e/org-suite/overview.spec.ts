import { test, expect } from "@playwright/test";

// Overview = the executive summary. Value: where the org stands, where it's heading, and the
// highest-leverage *gaps to explore* — framed as exploration, never as orders.
test.describe("Org Overview — executive value", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/org/vercel");
  });

  test("persistent org header + all five tabs", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "vercel", level: 1 })).toBeVisible();
    await expect(page.getByText(/L[1-5] · \d+/).first()).toBeVisible(); // maturity chip
    for (const t of ["Overview", "Repositories", "Contributors", "Delivery", "Practices"]) {
      await expect(page.getByRole("link", { name: t, exact: true })).toBeVisible();
    }
  });

  test("maturity, adoption & rigor tiles carry real numbers", async ({ page }) => {
    await expect(page.getByText("Org maturity").first()).toBeVisible();
    await expect(page.getByText("AI Adoption").first()).toBeVisible();
    await expect(page.getByText("Engineering Rigor").first()).toBeVisible();
    await expect(page.getByText("Repos scanned")).toBeVisible();
  });

  test("goal + standing give the org direction", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Goal · reach AI-Native" })).toBeVisible();
    await expect(page.getByText(/to go|reached|✓/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Standing" })).toBeVisible();
  });

  test("movers surface week-over-week change", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Top gainers" })).toBeVisible();
    await expect(page.getByText("▲").first()).toBeVisible();
  });

  test("separates common org gaps from repo-specific ones", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Where the gaps live" })).toBeVisible();
    await expect(page.getByText("Common organization gaps")).toBeVisible();
    await expect(page.getByText("Repo-specific gaps")).toBeVisible();
    // common gaps quantify how many repos they touch and route to a reusable practice (fix once)
    await expect(page.getByText(/weak in \d+\/\d+/).first()).toBeVisible();
    await expect(page.getByText("reuse a practice →").first()).toBeVisible();
    // repo-specific gaps frame an outlier against the org average
    await expect(page.getByText(/\d+ vs \d+ org/).first()).toBeVisible();
  });

  test("highest-leverage gaps are framed as exploration, not directives", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Gaps to explore across the fleet" })).toBeVisible();
    // at least 3 ranked gaps, each scoped to the repos they touch (systematic apply)
    const affects = page.getByText(/affects \d+ repo/);
    expect(await affects.count()).toBeGreaterThanOrEqual(3);
    // titles read as gap observations, not imperatives ("Add X")
    await expect(
      page.getByText(/thin|isn't|ad hoc|held by habit|Few tests|Little gates|hard to see|Sparse/i).first(),
    ).toBeVisible();
  });
});
