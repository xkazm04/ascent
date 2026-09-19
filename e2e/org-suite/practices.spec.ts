import { test, expect } from "@playwright/test";

// Practice Library = the org's playbook, mined from its own best repos. Value (the differentiator):
// for each practice, an internal exemplar to learn from + the repos that could adopt it + a
// leak-free reusable *shape* — institutional AI knowledge that travels without the code.
test.describe("Org Practices — reuse across the company", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/org/vercel/practices");
  });

  // The library's header no longer CLAIMS leak-freedom in prose ("the reusable shape travels, the
  // proprietary code doesn't" was rewritten out); it now describes the two sources of a practice.
  // That is the honest thing to pin here. The leak-free guarantee itself is asserted where it is
  // actually enforced: the "Reusable shape" test below, and outlineOf's code-fence stripping in
  // src/lib/analyze/practice-shape.test.ts. A prose promise was never the real control.
  test("the library frames both sources of a practice", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Practice Library" })).toBeVisible();
    await expect(page.getByText(/playbooks you author and practices mined from/)).toBeVisible();
  });

  // The per-practice detail (MinedPracticeDetail) used to render inline for every row; it now opens
  // in PracticeDetailModal on row click, so the library lists practices and the detail is one click
  // in. The assertions are unchanged in substance — they just have to open a row first.
  test("each practice gives an exemplar, gap repos, and a reusable shape", async ({ page }) => {
    // Mined rows carry id="practice-<id>" (authored playbooks do not), so this counts the practices
    // that actually have a mined shape rather than every row in the ledger.
    const mined = page.locator('tr[id^="practice-"]');
    // Asserting the 5th mined row is visible IS "at least 5", but with retries. count() takes one
    // non-retrying sample, and this page streams its ledger in, so counting straight after goto()
    // reads a partial table — or 0 — on a page that is merely still arriving.
    await expect(mined.nth(4)).toBeVisible();

    await mined.first().click();

    // an internal exemplar to learn from, linking to its report
    await expect(page.getByText("Learn from").first()).toBeVisible();
    await expect(page.locator('a[href*="/report?repo="]').first()).toBeVisible();
    // repos that could adopt it next (systematic apply)
    await expect(page.getByText(/Could adopt next/).first()).toBeVisible();
    // the leak-free starter itself
    await expect(page.getByText("Reusable shape").first()).toBeVisible();
  });
});
