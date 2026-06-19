import { test, expect } from "@playwright/test";

// Connect = where users pick which repos get watched + on what autoscan cadence. The watch toggle is
// OPTIMISTIC: it flips the checkbox immediately, POSTs /api/org/watch, and on a non-2xx rolls the
// checkbox back to its prior value and shows an inline row error (InstallationRepos.tsx:197-215). The
// pure reducers behind that (watchState.ts) have unit coverage; this e2e proves the WIRING — that a
// failed save actually reverts the rendered DOM and renders the role="alert", not a stuck "watched"
// state ("success theater → scheduled scans silently never run", per the comment at :194-196).
//
// Deterministic by design: every network dependency is mocked via page.route, so it can't flake on
// live GitHub / rate limits. /api/app/repos is intercepted (the connect env has no live GitHub App
// token), and /api/org/watch is forced to 500 to drive the rollback.
test.describe("Connect — watch-toggle optimistic rollback", () => {
  const ORG = "acme";
  const INSTALL_ID = "424242";
  const REPO = "acme/widgets";

  test.beforeEach(async ({ page }) => {
    // The repo list the panel renders. Shape = AppRepo[] (installationRepoTypes.ts:8-18); one
    // UNWATCHED repo so the checkbox starts unchecked and toggling ON is what we revert.
    // InstallationRepos.tsx:60-65 reads `data.repos`.
    await page.route(`**/api/app/repos?**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          installationId: INSTALL_ID,
          org: ORG,
          repos: [
            {
              fullName: REPO,
              owner: ORG,
              name: "widgets",
              private: false,
              url: `https://github.com/${REPO}`,
              language: "TypeScript",
              stars: 12,
              pushedAt: "2026-01-01T00:00:00Z",
              state: { watched: false, scanSchedule: "off", level: null, overall: null },
            },
          ],
        }),
      }),
    );

    // Best-effort side reads (InstallationRepos.tsx:82, :103) — stub them empty so they don't 404-noise
    // or alter the row under test. Neither is required for the rollback path.
    await page.route("**/api/org/credits?**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ balance: 0, unlimited: false }) }),
    );
    await page.route("**/api/org/segments?**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ segments: [], membership: {} }) }),
    );
  });

  test("a failed POST /api/org/watch reverts the checkbox and shows an inline error", async ({ page }) => {
    // Carry ?org=&installation_id= as if returning from the GitHub install redirect. The panel only
    // renders when the GitHub App is configured (connect/page.tsx:64) and, with auth OFF, the
    // query-carried org is pushed straight into `installs` (installRouting.ts:44-46) so
    // <InstallationRepos org installationId> mounts (connect/page.tsx:290-296). The default e2e env
    // configures neither GITHUB_APP_* nor auth, so when the panel is absent we skip with a clear
    // reason rather than assert against the "App not configured" branch.
    await page.goto(`/connect?org=${ORG}&installation_id=${INSTALL_ID}`);

    // The watch toggle is a checkbox inside a <label> ending in "watch" (RepoRow.tsx:54-62).
    const watch = page.getByRole("checkbox").first();
    const panelPresent = await watch.count().then((c) => c > 0);
    test.skip(
      !panelPresent,
      "Connect repos panel not rendered — needs GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (and auth OFF) in the e2e webServer env. With those set, the page.route mocks drive the rest.",
    );

    // Precondition: the repo starts unwatched (our mocked state.watched:false → checked={false}).
    await expect(watch).not.toBeChecked();

    // Force the save to fail. POST /api/org/watch (InstallationRepos.tsx:202) → 500 → the !res.ok
    // branch (:207-210) rolls back to prevWatched (false) and sets the row error.
    await page.route("**/api/org/watch", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
    );

    // Toggle watch ON — optimistic patch flips it checked immediately (:199), then the failed POST
    // must revert it.
    await watch.check();

    // The rollback: the checkbox returns to UNCHECKED (not a stuck "watched" state).
    await expect(watch).not.toBeChecked();

    // And the inline error surfaces: role="alert" carrying the watch failure copy
    // (RepoRow.tsx:108-111 renders errors[fullName]; the text is set at InstallationRepos.tsx:209).
    await expect(page.getByRole("alert").filter({ hasText: /not saved/i })).toBeVisible();
    await expect(page.getByText(/Couldn't watch — not saved/i)).toBeVisible();
  });
});
