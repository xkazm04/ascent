import { test, expect } from "@playwright/test";

test("landing renders the hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /AI-native/i })).toBeVisible();
  await expect(page.getByPlaceholder("owner/repo")).toBeVisible();
});

test("header nav jumps to the on-page sections", async ({ page }) => {
  await page.goto("/");
  // The top-menu choices are in-page anchors (#levels / #how / #pricing) — smooth-scrolled via CSS.
  // Guard that the anchors still resolve to their sections (the substance of the menu navigation).
  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(page).toHaveURL(/#pricing$/);
  await expect(page.getByRole("heading", { name: /Usage-based/ })).toBeInViewport();
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
  // Archetype chip — match the EXACT chip label (ARCHETYPE_LABEL), anchored so the substring
  // doesn't also collide with "platform"/"product" in body copy (a strict-mode violation).
  await expect(
    page.getByText(/^(Solo \/ early-stage|Team \/ product|Org \/ platform)$/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /D8 AI Process & Harness/ })).toBeVisible(); // the 8th dimension
  await expect(page.getByRole("link", { name: /sindresorhus\/slugify/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Scan another repo/ })).toBeVisible(); // report fully rendered

  // dimension cards are interactive — expanding reveals evidence.
  await page.getByRole("button", { name: /Automated Testing/ }).click();
  await expect(page.getByText(/Evidence|test file|signal /i).first()).toBeVisible();
});

test("public scan runs through the engine and renders — no error wall", async ({ page }) => {
  // The basic operation the product exists to do: open a report, let the live pipeline run
  // (GitHub ingest → deterministic signals → LLM engine → compose), and render. This 500'd
  // ("Unexpected error while scanning the repository") when the DB was configured but unreachable,
  // because a best-effort cache read threw instead of degrading. Drive it straight from the URL.
  await page.goto("/report?repo=sindresorhus/slugify");

  // It must finish and render the report — not hang on the loading view, not fall to the error wall.
  await expect(page.getByTestId("report")).toBeVisible({ timeout: 90_000 });

  // And no error states from the scan failing or the quota wall tripping.
  await expect(page.getByRole("heading", { name: "Couldn't scan that repo" })).toHaveCount(0);
  await expect(page.getByText("Unexpected error while scanning the repository.")).toHaveCount(0);
});

test("invalid repo shows a clean error", async ({ page }) => {
  await page.goto("/report?repo=not-a-real-repo");
  await expect(page.getByRole("heading", { name: "Couldn't scan that repo" })).toBeVisible({
    timeout: 60_000,
  });
});
