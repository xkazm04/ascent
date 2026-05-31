import { test, expect } from "@playwright/test";

test("landing renders the hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /AI-native/i })).toBeVisible();
  await expect(page.getByPlaceholder("owner/repo")).toBeVisible();
});

test("scan flow streams to a report without a manual refresh", async ({ page }) => {
  await page.goto("/");

  // Drive the exact path that was stuck: client-side nav from the form -> SSE stream.
  await page.getByPlaceholder("owner/repo").fill("sindresorhus/slugify");
  await page.getByRole("button", { name: /^scan$/i }).click();

  await page.waitForURL(/\/report\?repo=/);

  // The regression guard: the report must appear on its own (no refresh).
  await expect(page.getByTestId("report")).toBeVisible({ timeout: 90_000 });

  // v2 surfaces: posture + the two axes + archetype chip + 8 dimensions (incl. D8) + badge.
  await expect(page.getByText("Posture", { exact: true })).toBeVisible();
  await expect(page.getByText("AI Adoption", { exact: true })).toBeVisible();
  await expect(page.getByText("Engineering Rigor", { exact: true })).toBeVisible();
  await expect(page.getByText(/early-stage|product|platform/)).toBeVisible(); // archetype chip
  await expect(page.getByRole("button", { name: /D8 AI Process & Harness/ })).toBeVisible(); // the 8th dimension
  await expect(page.getByText("Share your maturity badge")).toBeVisible();
  await expect(page.getByRole("link", { name: /sindresorhus\/slugify/ })).toBeVisible();

  // dimension cards are interactive — expanding reveals evidence.
  await page.getByRole("button", { name: /Automated Testing/ }).click();
  await expect(page.getByText(/Evidence|test file|signal /i).first()).toBeVisible();
});

test("invalid repo shows a clean error", async ({ page }) => {
  await page.goto("/report?repo=not-a-real-repo");
  await expect(page.getByRole("heading", { name: "Couldn't scan that repo" })).toBeVisible({
    timeout: 60_000,
  });
});
