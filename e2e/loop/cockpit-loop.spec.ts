import { test, expect, type APIRequestContext } from "@playwright/test";
import { FIXTURE_NAME, FIXTURE_REPO, createFixtureRepo, git, removeFixtureRepo, theLoopBranch } from "./fixture";

// THE COCKPIT LOOP, END TO END — the UC1 journey as one spec: map a repo → scan it from disk → open
// the cockpit → select it → propose → run → read the outcome → iterate.
//
// WHAT IS DRIVEN FOR REAL (everything except the agent session):
//   • local-mode mapping + pairing, through the real `/api/org/local/projects` door;
//   • a real scan of a real git repository on disk (LocalFsSource, deterministic mock engine);
//   • the real cockpit UI — observatory selection, the propose panel, the model/effort dials, Run;
//   • the real loop engine: a real `git worktree`, a real FOUNDATION lane that writes the generated
//     `.ai/` tree and commits it, a real rescan of that worktree, real persistence;
//   • the real attribution rule, the real outcome ledger, the real branch left behind.
//
// WHAT IS NOT: no `claude -p` session ever runs. The fixture repo has no `.ai/manifest.yaml`, so
// rule 1 of `proposeLaneKind` gives it a FOUNDATION lane — a deterministic install, no agent — and
// `Cycles` is pinned to 1 so cycle 2 (which would fall back to the agent lane) never happens. That
// is a deliberate scoping choice, not an accident: an e2e spec that spends a real model session per
// run is neither fast nor repeatable, and the foundation lane exercises every part of the loop
// *around* the agent.
//
// THE HONEST STATE THE LEDGER MUST RENDER. The engine here is the deterministic mock, so both ends
// of every comparison carry `engineProvider: "mock"` and the attribution rule refuses to call the
// movement a lift — "not attributable: mock scan". This spec asserts that refusal. A green delta
// here would be the bug (src/lib/maturity/attribution.ts).

const ORG = process.env.E2E_LOOP_ORG || "e2eloop";
const BASE = `http://localhost:${process.env.E2E_LOOP_PORT || "3111"}`;
const COCKPIT = `/org/${ORG}?tab=live`;

let api: APIRequestContext;
let fixtureDir: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE });

  fixtureDir = await createFixtureRepo();

  // Map + pair in one call — the headless door an agent driving a fleet would use.
  const mapped = await api.post("/api/org/local/projects", {
    data: { org: ORG, projects: [{ url: FIXTURE_REPO, path: fixtureDir }] },
  });
  expect(mapped.status(), await mapped.text()).toBe(200); // 207 would mean the pairing half failed
  const mapBody = await mapped.json();
  expect(mapBody.paired).toBe(1);
  expect(mapBody.results[0]).toMatchObject({ fullName: FIXTURE_REPO, watched: true, paired: true, error: null });

  // The first scan — from disk, so it is the `before` end of the loop's first comparison.
  const scanned = await api.post("/api/org/local/rescan", { data: { org: ORG, fullName: FIXTURE_REPO } });
  expect(scanned.status(), await scanned.text()).toBe(200);
  const scan = await scanned.json();
  expect(scan.ok).toBe(true);
  expect(scan.level).toMatch(/^L[1-5]$/);
});

test.afterAll(async () => {
  await removeFixtureRepo(fixtureDir);
  await api?.dispose();
});

/** Open the cockpit and select the fixture repo, leaving the inspector's proposal on screen. */
async function selectFixture(page: import("@playwright/test").Page) {
  await page.goto(COCKPIT);
  const cockpit = page.getByRole("region", { name: "Loop cockpit" });
  await expect(cockpit).toBeVisible();
  // The observatory's SVG is aria-hidden; ObservatoryList is its accessible twin and the surface a
  // keyboard (or a test) operates.
  const row = cockpit.getByRole("button", { name: new RegExp(FIXTURE_NAME) });
  await expect(row).toBeVisible();
  if ((await row.getAttribute("aria-pressed")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  return cockpit;
}

test("the cockpit's gate is open on this deployment, and the fleet plots the paired repo", async ({ page }) => {
  await page.goto(COCKPIT);
  const cockpit = page.getByRole("region", { name: "Loop cockpit" });
  await expect(cockpit).toBeVisible();
  await expect(cockpit.getByRole("heading", { name: "The fleet, in adoption × rigor" })).toBeVisible();
  await expect(cockpit.getByRole("button", { name: new RegExp(FIXTURE_NAME) })).toBeVisible();

  // The rail is the INSPECTOR, which means `cockpitSetupState` returned null: self-hosted, repos in
  // scope, owner, ASCENT_AUTOPILOT on, and a paired working copy. If any of the five were missing we
  // would be looking at a CockpitSetup block instead — so this assertion IS the gate assertion.
  await expect(cockpit.getByText(/Lasso or click bodies/)).toBeVisible();
  await expect(page.getByText("Three steps to your first run")).toHaveCount(0);
  await expect(page.getByText("Loop disabled on this deployment")).toHaveCount(0);
  await expect(page.getByText("Loops run where your code is")).toHaveCount(0);

  // And the server agrees, through the route the poll uses.
  const status = await api.get(`/api/org/loop?org=${ORG}`);
  expect(status.status()).toBe(200);
  expect(await status.json()).toMatchObject({ enabled: true, active: null });
});

test("a repo with no .ai/ standard is proposed a foundation lane", async ({ page }) => {
  const cockpit = await selectFixture(page);

  await expect(cockpit.getByText("Proposed batch")).toBeVisible();
  // The selection chip, not a bare text match: the observatory's SVG carries the same full name in a
  // hidden <title>, so `getByText(FIXTURE_REPO)` resolves to something no user can see.
  await expect(cockpit.getByRole("listitem", { name: FIXTURE_REPO })).toBeVisible();
  await expect(cockpit.getByText(".ai/ foundation", { exact: true })).toBeVisible();
  await expect(cockpit.getByText(/No \.ai\/ foundation in this repo/)).toBeVisible();
  // A foundation lane has no rows to curate — the proposal says so instead of showing an empty list.
  await expect(cockpit.getByText(/no rows to curate/)).toBeVisible();

  await expect(cockpit.getByRole("button", { name: "Run (1 repo)" })).toBeEnabled();
  // The drive CTA is reachable from the cockpit (it used to be curl-only). Asserted present, not
  // clicked: a drive dispatches runs until green, and run 2 would be an agent lane.
  await expect(cockpit.getByRole("button", { name: "Drive to green" })).toBeEnabled();

  // /propose and the engine call the SAME rule; this is the wire half of that identity.
  const proposed = await api.get(`/api/org/loop/propose?org=${ORG}&repos=${encodeURIComponent(FIXTURE_REPO)}`);
  expect(proposed.status()).toBe(200);
  const { proposals } = await proposed.json();
  expect(proposals).toHaveLength(1);
  expect(proposals[0]).toMatchObject({ repo: FIXTURE_REPO, kind: "foundation", practiceId: null, items: [] });
});

test("a bounded run installs the foundation, and the ledger refuses to call a mock pair a lift", async ({ page }) => {
  const cockpit = await selectFixture(page);
  await expect(cockpit.getByText(".ai/ foundation", { exact: true })).toBeVisible();

  // ONE cycle. Cycle 2 would drop back to the backlog lane and spawn a real `claude -p` session.
  await cockpit.getByLabel("Cycles").selectOption("1");
  await cockpit.getByTestId("cockpit-model").selectOption("haiku");
  await cockpit.getByTestId("cockpit-effort").selectOption("low");

  await cockpit.getByRole("button", { name: "Run (1 repo)" }).click();
  await expect(cockpit.getByText(/Run · (running|done)/)).toBeVisible();

  // The run: worktree → install → commit → rescan. The rail switches to the outcome when it settles.
  await expect(cockpit.getByText(/Outcome · done/)).toBeVisible({ timeout: 300_000 });

  // WHAT THE LIFT WAS PRODUCED UNDER. Resolved at arm time and persisted on the row, so the ledger
  // can say it long after the process that drove the run is gone.
  // It renders in two places, which is the design: beside the outcome's timestamp AND under the run's
  // row in the history strip, because comparing two lifts means comparing two setups.
  await expect(cockpit.getByText("haiku · low effort").first()).toBeVisible();

  // The headline refuses to claim anything: every scan here is a mock scan, so nothing is
  // attributable and the one lane is reported as excluded rather than as zero movement.
  await expect(cockpit.getByText("attributable lift")).toBeVisible();
  await expect(cockpit.getByText(/excluded: 1 mock scan/)).toBeVisible();

  // The ledger row: the lane's kind, the refusal in place of a coloured delta, and the provenance.
  // Anchored on the refusal itself, which nothing but the ledger row renders — the fleet list on the
  // left also carries the repo's name.
  const row = cockpit.locator("li").filter({ hasText: "not attributable: mock scan" }).first();
  await expect(row).toContainText(FIXTURE_REPO);
  await expect(row.getByText(".ai/ foundation", { exact: true })).toBeVisible();
  await expect(row.getByText(/engine mock/)).toBeVisible();
  // A local rescan cannot observe the GitHub-side platform fold and there is nothing to carry, so
  // D2/D3/D4 are declared unmeasurable rather than scored at a floor the repo cannot raise.
  await expect(row.getByText(/not measurable locally/)).toBeVisible();
  // Real work landed: a commit on a real branch.
  await expect(row.getByText(/[1-9]\d* commits/)).toBeVisible();
  await expect(row.getByText(/ascent\/loop-/)).toBeVisible();

  // THE BRANCH IS THE DELIVERABLE — verified in the repository itself, not from the screen.
  const branch = await theLoopBranch(fixtureDir);
  const tree = await git(fixtureDir, ["ls-tree", "-r", "--name-only", branch]);
  expect(tree).toContain(".ai/manifest.yaml");
  // The operator's own working copy is untouched: the install is on the branch, not on `main`.
  const mainTree = await git(fixtureDir, ["ls-tree", "-r", "--name-only", "main"]);
  expect(mainTree).not.toContain(".ai/manifest.yaml");

  // ITERATE: back to the inspector with the selection intact — the run you just watched is the
  // selection you want to run again.
  await cockpit.getByRole("button", { name: "Back to inspect" }).click();
  // Two counters read "1 selected" (the fleet list's and the inspector's) — either proves the point.
  await expect(cockpit.getByText("1 selected").first()).toBeVisible();
  await expect(cockpit.getByRole("button", { name: "Run (1 repo)" })).toBeEnabled();

  // And the run is in the history strip, which is what a later session iterates from.
  const runs = await api.get(`/api/org/loop?org=${ORG}`);
  const body = await runs.json();
  expect(body.active).toBeNull();
  expect(body.runs[0]).toMatchObject({ model: "haiku", effort: "low", repos: [FIXTURE_REPO] });
});

test("once the branch is merged, the same rule stops proposing a foundation lane", async ({ page }) => {
  // The lane kind reads the PAIRED working copy, not the branch — so it keeps proposing the
  // foundation until a human merges. Merging is the operator's half of the loop; this is it.
  const branch = await theLoopBranch(fixtureDir);
  await git(fixtureDir, ["merge", "--no-edit", branch]);
  expect(await git(fixtureDir, ["ls-tree", "-r", "--name-only", "main"])).toContain(".ai/manifest.yaml");

  const proposed = await api.get(`/api/org/loop/propose?org=${ORG}&repos=${encodeURIComponent(FIXTURE_REPO)}`);
  const { proposals } = await proposed.json();
  expect(proposals[0].kind).not.toBe("foundation");

  const cockpit = await selectFixture(page);
  await expect(cockpit.getByText("Proposed batch")).toBeVisible();
  await expect(cockpit.getByText(".ai/ foundation", { exact: true })).toHaveCount(0);
});

test("the loop's gates answer for themselves, and the drive door is reachable under the same one", async () => {
  // A repo with no pairing is refused before a single lane is armed — the same message the cockpit's
  // `unpaired` setup state points at.
  const unpaired = await api.post("/api/org/loop", {
    data: { action: "start", org: ORG, repos: ["ascent-e2e/never-paired"] },
  });
  expect(unpaired.status()).toBe(409);
  expect((await unpaired.json()).error).toMatch(/not paired/i);

  // The public funnel org is not a tenant a loop may be pointed at.
  const publicOrg = await api.post("/api/org/loop", { data: { action: "start", org: "public", repos: [FIXTURE_REPO] } });
  expect(publicOrg.status()).toBe(403);

  // /propose is a pure read and validates its own inputs.
  const noRepos = await api.get(`/api/org/loop/propose?org=${ORG}`);
  expect(noRepos.status()).toBe(400);

  // The drive shares the loop's gate exactly (cockpitGate.ts is one predicate for both), so its
  // listing door answers here. Not started: a drive runs until green, and run 2 would be an agent lane.
  const drives = await api.get(`/api/org/local/drive?org=${ORG}`);
  expect(drives.status()).toBe(200);
  expect(Array.isArray((await drives.json()).drives)).toBe(true);

  // The mapping door reports greenness on the same read, including what could not be measured at all
  // from disk — the platform fold this branch made explicit rather than silently absent.
  const projects = await api.get(`/api/org/local/projects?org=${ORG}`);
  expect(projects.status()).toBe(200);
  const mapping = await projects.json();
  expect(mapping).toMatchObject({ org: ORG, paired: 1 });
  expect(mapping.green.inScope).toBe(1);
  expect(mapping.green.repos[0].unmeasurable).toEqual(expect.arrayContaining(["D2", "D3", "D4"]));
});
