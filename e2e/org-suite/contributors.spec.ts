import { test, expect } from "@playwright/test";

// Contributors = inputs to explore where trust could grow — explicitly NOT a ranking and NOT a
// to-do list for anyone. Value: exemplars to learn from + where key-person risk sits.
test.describe("Org Contributors — inputs, not directives", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/org/vercel/contributors");
  });

  test("framed as inputs to explore trust, never as orders", async ({ page }) => {
    await expect(page.getByText(/Inputs to explore where trust/)).toBeVisible();
    await expect(page.getByText(/inputs to explore, never directives/)).toBeVisible();
  });

  test("champions are surfaced as exemplars to learn from", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "AI champions" })).toBeVisible();
    await expect(page.getByText(/exemplars whose approach/)).toBeVisible();
  });

  test("involvement + bus-factor surface real people and key-person risk", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Involvement" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Concentration/ })).toBeVisible();
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
  });
});
