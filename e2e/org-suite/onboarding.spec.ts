import { test, expect } from "@playwright/test";

// Onboarding = the first-run flow: pick up to 10 org repos, scan them in one shot, land on the
// cross-repo dashboard. Org-auth is the shortcut (auth unconfigured → flow is open).
test.describe("Onboarding — pick repos & one-shot scan", () => {
  test("fetch an org and select up to 10 repositories (cap enforced)", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Scan your organization" })).toBeVisible();

    await page.getByRole("button", { name: "vercel", exact: true }).click(); // suggestion chip
    await expect(page.getByRole("heading", { name: /Pick up to 10/ })).toBeVisible({ timeout: 30_000 });

    const boxes = page.locator('label input[type="checkbox"]');
    expect(await boxes.count()).toBeGreaterThan(10);
    // pre-selected at the cap, surplus disabled, scan button reflects the count
    await expect(page.getByText("10/10")).toBeVisible();
    expect(await page.locator('input[type="checkbox"]:disabled').count()).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /Scan 10 repos/ })).toBeVisible();
  });

  test("one-shot scan of a selection lands on the cross-repo dashboard", async ({ page }) => {
    await page.goto("/onboarding");
    await page.getByPlaceholder("vercel").fill("sindresorhus"); // many small repos → fast live scan
    await page.getByRole("button", { name: "Fetch repos" }).click();
    await expect(page.getByRole("heading", { name: /Pick up to 10/ })).toBeVisible({ timeout: 30_000 });

    // narrow the selection to 2 repos for a quick one-shot scan
    const all = page.locator('label input[type="checkbox"]');
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const cb = all.nth(i);
      if (await cb.isChecked()) await cb.uncheck();
    }
    await all.nth(0).check();
    await all.nth(1).check();
    await expect(page.getByText("2/10")).toBeVisible();

    await page.getByRole("button", { name: /Scan 2 repos/ }).click();
    await expect(page.getByRole("heading", { name: "Scan complete" })).toBeVisible({ timeout: 150_000 });

    const cta = page.getByRole("link", { name: /View cross-repo analysis/ });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/org\/sindresorhus/);
    await expect(page.getByRole("heading", { name: "sindresorhus", level: 1 })).toBeVisible({ timeout: 30_000 });
  });
});
