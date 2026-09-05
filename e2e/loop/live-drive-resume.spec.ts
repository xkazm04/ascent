import { test, expect, type APIRequestContext } from "@playwright/test";

// L2-C — THE RESUME BANNER, against a server that was really killed.
//
// This spec deliberately asserts only the LAST act of L2-C. Everything before it — map + pair a
// scratch repo, scan it, start a drive, `taskkill /F` the server mid-run, start it again — is done by
// the certification script that stages this run (uat/runs/2026-08-29-loop-l2/), because Playwright
// cannot kill a server it owns and go on testing. What is left, and what only a browser can settle,
// is whether the cockpit tells the operator the truth about what it found on boot:
//
//   • the interrupted drive is OFFERED, not auto-resumed, and it is offered as a banner ABOVE a
//     still-usable inspector rather than as a mode that hides it;
//   • the offer counts the runs the dead process already spent, against the budget she granted;
//   • pressing Resume continues that chain — `runsBefore` carries — so a restart cannot re-grant rope.
//
// Preconditions (the script asserts them before invoking playwright, so a failure here is a product
// finding rather than a staging accident): the NEWEST drive in `l2loop` is phase `interrupted`, with
// at least one run left in its budget.
//
//   npx playwright test --config playwright.loop-live.config.ts e2e/loop/live-drive-resume.spec.ts

const ORG = process.env.L2_ORG || "l2loop";
const BASE = `http://localhost:${process.env.L2_PORT || "3220"}`;
const COCKPIT = `/org/${ORG}?tab=live`;

let api: APIRequestContext;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE });
});
test.afterAll(async () => {
  await api?.dispose();
});

async function drives() {
  const res = await api.get(`/api/org/local/drive?org=${ORG}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).drives as Array<{
    id: string;
    phase: string;
    maxRuns: number;
    runsBefore: number;
    resumedFrom: string | null;
    runs: Array<{ runId: string; endedAt: string | null }>;
  }>;
}

/** The drive under test: the interrupted one. Asserted to also be the NEWEST, because that is the
 *  one the cockpit adopts on its mount tick — a banner about a different drive would be a finding. */
async function interruptedDrive() {
  const all = await drives();
  const found = all.find((d) => d.phase === "interrupted");
  expect(found, "staging: no interrupted drive").toBeTruthy();
  expect(all[0]!.id, "the interrupted drive is not the newest — the cockpit adopts the newest").toBe(found!.id);
  return found!;
}

test("the cockpit offers the interrupted drive back, above a still-usable inspector", async ({ page }) => {
  const interrupted = await interruptedDrive();

  await page.goto(COCKPIT);
  const cockpit = page.getByRole("region", { name: "Loop cockpit" });
  await expect(cockpit).toBeVisible();

  const banner = page.getByTestId("drive-interrupted");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Drive · Interrupted");
  // The sentence that makes "not auto-resumed" true on screen rather than only in the code comment.
  await expect(banner).toContainText(/was not resumed on its own/);

  // The runs the dead process already spent, counted against the budget the operator granted.
  const runsDone = interrupted.runsBefore + interrupted.runs.filter((r) => r.endedAt != null).length;
  await expect(banner).toContainText(`${runsDone}/${interrupted.maxRuns} runs spent`);

  // A banner, not a mode: the inspector underneath is still the thing she can select a scope in.
  await expect(cockpit.getByText(/Lasso or click bodies|Proposed batch|selected/).first()).toBeVisible();
});

test("resuming continues the same chain — the rope cannot be re-granted", async ({ page }) => {
  const interrupted = await interruptedDrive();
  const runsDone = interrupted.runsBefore + interrupted.runs.filter((r) => r.endedAt != null).length;
  const runsLeft = interrupted.maxRuns - runsDone;

  await page.goto(COCKPIT);
  const resume = page.getByTestId("drive-resume");
  await expect(resume).toBeVisible();
  // The affordance PRICES the offer: what is left, not what the dial said.
  await expect(resume).toHaveText(new RegExp(`Resume drive \\(${runsLeft} ${runsLeft === 1 ? "run" : "runs"} left\\)`));

  // THE CLICK IS RETRIED, and that is a finding rather than a convenience. The banner is server-
  // rendered, so `drive-resume` is visible-and-enabled in the HTML before React has hydrated the page
  // and attached its onClick. A click landing in that window is swallowed silently — no request, no
  // error, no change of state — and the operator's only signal is that nothing happened. Measured in
  // the L2 run: the first click after `goto` fired no POST at all.
  const posted = page.waitForRequest(
    (r) => r.url().includes("/api/org/local/drive") && r.method() === "POST",
    { timeout: 60_000 },
  );
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await resume.click();
    const landed = await Promise.race([posted.then(() => true), page.waitForTimeout(3_000).then(() => false)]);
    if (landed) {
      test.info().annotations.push({ type: "resume-click-attempt", description: String(attempt) });
      break;
    }
  }

  // A NEW drive row continuing the old chain: `resumedFrom` points at the interrupted one and
  // `runsBefore` carries its spend, so the budget is the chain's, never the segment's.
  await expect
    .poll(async () => (await drives()).find((d) => d.resumedFrom === interrupted.id)?.runsBefore ?? -1, {
      timeout: 60_000,
      message: "no resumed drive appeared",
    })
    .toBe(runsDone);

  const resumed = (await drives()).find((d) => d.resumedFrom === interrupted.id)!;
  expect(resumed.maxRuns).toBe(interrupted.maxRuns);
  // The prior row stays interrupted — it is the record of what died, not something to overwrite.
  expect((await drives()).find((d) => d.id === interrupted.id)!.phase).toBe("interrupted");
});
