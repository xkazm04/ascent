import { test, expect } from "@playwright/test";

// Onboarding = the first-run flow: pick up to 10 org repos, scan them in one shot, land on the
// cross-repo dashboard. Org-auth is the shortcut (auth unconfigured → flow is open).
test.describe("Onboarding — pick repos & one-shot scan", () => {
  test("fetch an org and select up to 10 repositories (cap enforced)", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Scan your organization" })).toBeVisible();

    await page.getByRole("button", { name: "vercel", exact: true }).click(); // suggestion chip
    // Step 2's heading is "Choose repositories" (OnboardingSelectStep); the cap now lives in the
    // CapPill ("10/10 selected") and the "Select top 10" action rather than in the heading text.
    await expect(page.getByRole("heading", { name: "Choose repositories" })).toBeVisible({ timeout: 30_000 });

    // Repo rows are BUTTONS carrying aria-disabled, not checkboxes: OnboardingSelectStep uses
    // aria-disabled over native `disabled` on purpose, so a keyboard/SR user at the cap can still
    // focus a row and hear why it won't take. Selecting on `:disabled` therefore finds nothing.
    const rows = page.getByRole("button", { name: /vercel\// });
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(10);
    // Drive to the cap explicitly rather than relying on how many the step preselects — the cap
    // being ENFORCED is what this test is about, and the preselect count is free to change.
    await page.getByRole("button", { name: /Select top 10/ }).click();
    // surplus refused, scan button reflects the count
    await expect(page.getByText("10/10")).toBeVisible();
    expect(await page.locator('button[aria-disabled="true"]').count()).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /Scan 10 repos/ })).toBeVisible();
  });

  test("one-shot scan of a selection lands on the cross-repo dashboard", async ({ page, request }) => {
    // Two real claude-opus-5 assessments run inside this test, so the default 300s per-test budget
    // cannot hold it.
    test.setTimeout(720_000);

    // A live scan failing here used to give nothing but "heading not found" after a multi-minute wait,
    // with the cause (a client-side throw, a dropped SSE event) invisible. Surface both channels.
    const clientErrors: string[] = [];
    page.on("pageerror", (e) => clientErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") clientErrors.push(`console.error: ${m.text()}`);
    });

    // PRECONDITION: give "sindresorhus" an Organization row before the live run.
    //
    // In production this test's flow takes the PUBLIC FUNNEL — a real, token-less, allowance-metered
    // scan that works on an org Ascent has never seen. This suite cannot reach that path: the import
    // route derives `publicFunnel` as `... && !authOff`, and the suite runs with ASCENT_AUTH_BYPASS,
    // which is exactly `authOff`. That exclusion is correct and deliberate — an auth-off run scans
    // with an ambient GITHUB_TOKEN, so it is NOT structurally incapable of reading private repos, and
    // the free public lane must never be granted to a run that could.
    //
    // So here the run is METERED, and a metered scan of an org with no row is a 402 (checkScanEntitlement
    // denies a confirmed-missing org). A mock import is not metered, creates the row, and costs no
    // inference — after it, the free plan's monthly allowance covers the live scan below.
    const seed = await request.post("/api/org/import", {
      data: { org: "sindresorhus", count: 1, mock: true, watch: false, schedule: "weekly" },
    });
    expect(seed.ok(), "mock seed import failed — the live scan below would 402").toBeTruthy();

    await page.goto("/onboarding");
    await page.getByPlaceholder("vercel").fill("sindresorhus"); // many small repos → fast live scan
    await page.getByRole("button", { name: "List repos" }).click();
    await expect(page.getByRole("heading", { name: "Choose repositories" })).toBeVisible({ timeout: 30_000 });

    // narrow the selection to 2 repos for a quick one-shot scan
    const all = page.getByRole("button", { name: /sindresorhus\// });
    await expect(all.first()).toBeVisible();
    // "Clear" in one action, instead of walking every row — the old loop re-read isChecked() per
    // box against a list that had already grown past 100 rows.
    await page.getByRole("button", { name: "Clear" }).click();
    await all.nth(0).click();
    await all.nth(1).click();
    await expect(page.getByText("2/10")).toBeVisible();

    await page.getByRole("button", { name: /Scan 2 repos/ }).click();
    // 150s was a mock-era budget. Two live claude-opus-5 assessments of small repos measured 2.0min
    // for the pair; 420s leaves room for a slower pair without letting a genuine hang masquerade as a
    // slow model. `clientErrors` is folded into the failure so the cause is in the report, not in a
    // trace someone has to open separately.
    await expect(
      page.getByRole("heading", { name: "Scan complete" }),
      `scan never reached the done screen. Client errors: ${clientErrors.join(" | ") || "(none)"}`,
    ).toBeVisible({ timeout: 420_000 });

    // The handoff is a BUTTON now (onViewDashboard), not a link, and its label depends on whether a
    // live upgrade is queued — "View dashboard" or "Open dashboard (live scan starts there)". Match
    // the half that is stable across both.
    const cta = page.getByRole("button", { name: /dashboard/i });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/org\/sindresorhus/);
    // The org name is a header CHIP, not an h1. Assert what actually matters about the landing anyway:
    // the dashboard rendered its section nav, and did NOT fall back to the "No data for <org>" empty
    // state — which is the shape this page takes when the import didn't really populate the org, and
    // is therefore the assertion an h1 check was only standing in for.
    await expect(page.getByRole("navigation", { name: "Organization sections" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/No data for/i)).toHaveCount(0);
  });
});
