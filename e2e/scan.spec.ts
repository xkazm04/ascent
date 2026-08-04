import { test, expect } from "@playwright/test";

// @smoke marks tests that are safe against a production deployment: read-only, no auth, no seeds,
// and — critically — no real scan (a scan consumes public quota and live LLM spend). The post-deploy
// workflow (.github/workflows/smoke.yml) runs `--grep @smoke` with E2E_BASE_URL set.
test("landing renders the hero @smoke", async ({ page }) => {
  await page.goto("/");
  // IndexLanding hero: the h1 plus the scan CTA (the repo input now lives inside the ScanModal
  // dialog, so the trigger button — not an inline placeholder — is the hero's scannable affordance).
  await expect(
    page.getByRole("heading", { name: /Every engineering org has a maturity/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Scan a repository/i })).toBeVisible();
});

test("header nav routes to the pricing page @smoke", async ({ page }) => {
  await page.goto("/");
  // The header is page-level nav (Leaderboard / Pricing / About / Org demo) — section anchors moved
  // into the deck's own "Page sections" rail. Guard that the top-menu Pricing route resolves.
  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { name: /Plans & credits/ })).toBeVisible();
});

// Deliberately NOT @smoke: this and the next test run a real scan (GitHub ingest + live LLM engine
// on prod), which burns public scan quota and LLM cost on every deploy. There is no client-reachable
// mock mode against a deployed server (LLM_PROVIDER=mock is a server env), so they stay local-only.
test("scan flow streams to a report without a manual refresh", async ({ page }) => {
  await page.goto("/");

  // Drive the exact path that was stuck: client-side nav from the form -> SSE stream.
  // The repo input lives inside the ScanModal dialog now — open it first.
  await page.getByRole("button", { name: /Scan a repository/i }).click();
  await page.getByPlaceholder("owner/repo").fill("sindresorhus/slugify");
  await page.getByRole("button", { name: /^scan$/i }).click();

  await page.waitForURL(/\/report\?repo=/);

  // The regression guard: the report must appear on its own (no refresh).
  await expect(page.getByTestId("report")).toBeVisible({ timeout: 90_000 });

  // v2 surfaces: posture + the two axes + archetype chip + the 9 dimensions behind the tab.
  await expect(page.getByText("Posture", { exact: true })).toBeVisible();
  await expect(page.getByText("AI Adoption", { exact: true })).toBeVisible();
  await expect(page.getByText("Engineering Rigor", { exact: true })).toBeVisible();
  // Archetype chip — anchored to the START of the chip's text (ARCHETYPE_LABEL) so the substring
  // doesn't also collide with "platform"/"product" in body copy. No end anchor: the chip carries an
  // sr-only " — <hint>" suffix for screen readers, so its text content extends past the label.
  await expect(
    page.getByText(/^(Solo \/ early-stage|Team \/ product|Org \/ platform)/).first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /sindresorhus\/slugify/ }).first()).toBeVisible();

  // The report is tabbed now — dimension cards live under the Dimensions tab.
  await page.getByRole("button", { name: "Dimensions" }).click();
  // Card names lead with the dimension id ("D8 AI Process & Harness 12%") — anchor on it, since a
  // bare name also matches the explorer's axis pill (a strict-mode violation).
  await expect(page.getByRole("button", { name: /^D8 AI Process & Harness/ })).toBeVisible();

  // dimension cards are interactive — expanding reveals evidence.
  await page.getByRole("button", { name: /^D2 Automated Testing/ }).click();
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

test("invalid repo shows a clean error @smoke", async ({ page }) => {
  await page.goto("/report?repo=not-a-real-repo");
  await expect(page.getByRole("heading", { name: "Couldn't scan that repo" })).toBeVisible({
    timeout: 60_000,
  });
});
