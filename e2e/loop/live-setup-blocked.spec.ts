import { test, expect } from "@playwright/test";

// L2-F — A BLOCKED SETUP STATE, rendered by a real deployment rather than by a prop.
//
// `CockpitSetup.dom.test.tsx` renders all five states from their prop, and `cockpitGate.test.ts`
// proves the predicate picks the right one. Neither can answer the question Priya actually has, which
// is whether a server booted WITHOUT the flag reaches that state at all — the gate reads
// `autopilotEnabled()` as reported by the loop's status poll, three layers away from the env var.
//
// So this spec is run against a server launched with `ASCENT_AUTOPILOT=0` and asserts the thing that
// makes the state worth having: the card NAMES the env var and says a restart is required, and the
// chart underneath is still readable, because a deployment that cannot dispatch agents can still be
// worth looking at.
//
//   npx playwright test --config playwright.loop-live.config.ts e2e/loop/live-setup-blocked.spec.ts

const ORG = process.env.L2_ORG || "l2loop";
const COCKPIT = `/org/${ORG}?tab=live`;

test("with ASCENT_AUTOPILOT off, the cockpit names the one next action instead of hiding", async ({ page, request }) => {
  // The server's own answer first: this is the fact the client gate mirrors.
  const status = await request.get(`/api/org/loop?org=${ORG}`);
  expect(status.status()).toBe(200);
  expect((await status.json()).enabled, "server: autopilot should be OFF for this spec").toBe(false);

  await page.goto(COCKPIT);
  const cockpit = page.getByRole("region", { name: "Loop cockpit" });
  await expect(cockpit).toBeVisible();

  // The blocked card, and the sentence that makes it actionable rather than a wall.
  await expect(cockpit.getByText("Loop disabled on this deployment")).toBeVisible();
  await expect(cockpit.getByText(/ASCENT_AUTOPILOT=1/)).toBeVisible();
  await expect(cockpit.getByText("Restart the server after setting it.")).toBeVisible();

  // The read-only half still works — the field is never hidden behind a setup state.
  await expect(cockpit.getByRole("heading", { name: "The fleet, in adoption × rigor" })).toBeVisible();

  // And no other state is claiming the rail at the same time.
  await expect(page.getByText("Three steps to your first run")).toHaveCount(0);
  await expect(page.getByText("Loops run where your code is")).toHaveCount(0);

  // The dispatch doors agree with the card rather than 500-ing behind it.
  const start = await request.post("/api/org/local/drive", {
    data: { org: ORG, action: "start", repos: [], maxRuns: 1 },
  });
  expect(start.status()).toBe(409);
  expect((await start.json()).error).toMatch(/ASCENT_AUTOPILOT/);
});
