// Pins the "a policy change takes effect honestly" contract of POST /api/org/gate-policy.
//
// Tightening the org gate bar used to re-evaluate nothing: the handler wrote an audit row and
// returned, so already-open PRs kept their stale GREEN check until the next push while the fleet
// dashboard re-evaluated live — the fastest way to lose trust in a merge-blocking control. A save
// now schedules a bounded sweep that re-runs the gate through the SAME check-writing path the
// webhook uses (@/lib/github/pr-gate), and the response states what was (or was not) scheduled so
// the editor can tell the owner when the bar applies instead of implying instant enforcement.
//
// What must hold: the sweep is SCHEDULED (deferred, never blocking the save), CAPPED, SKIPPED
// cleanly with a stated reason when the org has no App installation / no watched repos, and
// ISOLATED — one repo's GitHub failure can neither abort the rest of the sweep nor bubble out of
// after() (which would surface as an unhandled rejection in the deferred context).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  // A class, not a bare object: the handler branches on `gate instanceof NextResponse`.
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
  after: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgGatePolicy: vi.fn(async () => null),
  setOrgGatePolicy: vi.fn(async (_org: string, p: unknown) => p),
  recordOrgAudit: vi.fn(async () => {}),
  getInstallationIdForOwner: vi.fn(async () => "42"),
  listWatchedRepos: vi.fn(async () => []),
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "owner-login") }));
// describeGatePolicy stays REAL (importOriginal) so the audit row's human-readable bar is the exact
// canonical rendering every other surface uses, not a test-local approximation.
vi.mock("@/lib/scoring/gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scoring/gate")>()),
  sanitizeGatePolicy: vi.fn((p: unknown) => p),
}));
vi.mock("@/lib/github/app", () => ({
  isAppConfigured: () => true,
  getInstallationToken: vi.fn(async () => "tok"),
  githubAppFetch: vi.fn(async () => []),
}));
vi.mock("@/lib/github/pr-gate", () => ({ runPrGate: vi.fn(async () => {}) }));

import { POST } from "./route";
import { after } from "next/server";
import { getInstallationIdForOwner, getOrgGatePolicy, listWatchedRepos, recordOrgAudit } from "@/lib/db";
import { getInstallationToken, githubAppFetch } from "@/lib/github/app";
import { runPrGate } from "@/lib/github/pr-gate";

const mockAfter = vi.mocked(after);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockWatched = vi.mocked(listWatchedRepos);
const mockFetch = vi.mocked(githubAppFetch);
const mockToken = vi.mocked(getInstallationToken);
const mockGate = vi.mocked(runPrGate);

type Watched = Awaited<ReturnType<typeof listWatchedRepos>>;

/** A watched-repo row shaped like listWatchedRepos returns (only owner/name are read by the sweep). */
function repo(owner: string, name: string): Watched[number] {
  return { owner, name, fullName: `${owner}/${name}`, url: "", isPrivate: false, lastScanAt: null };
}

/** An open-PR row shaped like GitHub's `GET /repos/:o/:r/pulls` returns. */
function pr(number: number) {
  return { number, head: { sha: `sha${number}` }, base: { ref: "main" } };
}

function save(policy: unknown = { minLevel: "L3" }) {
  return POST(
    new Request("http://localhost/api/org/gate-policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: "acme", policy }),
    }),
  );
}

/** Run every callback the handler handed to after(), the way the runtime would post-response. */
async function runDeferred() {
  for (const [cb] of mockAfter.mock.calls) await (cb as () => unknown | Promise<unknown>)();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInstallId.mockResolvedValue("42");
  mockWatched.mockResolvedValue([]);
  mockToken.mockResolvedValue("tok");
  mockFetch.mockResolvedValue([]);
  mockGate.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("POST /api/org/gate-policy — open-PR re-check sweep", () => {
  it("schedules a sweep and re-runs the SHARED gate path on every open PR of the watched repos", async () => {
    mockWatched.mockResolvedValue([repo("acme", "api"), repo("acme", "web")]);
    mockFetch.mockResolvedValueOnce([pr(1), pr(2)]).mockResolvedValueOnce([pr(7)]);

    const res = await save();
    const body = (await res.json()) as { ok: boolean; sweep: { status: string; repos: number; cap: number } };

    // The response is answered BEFORE any GitHub work: the sweep is only scheduled here.
    expect(body.ok).toBe(true);
    expect(body.sweep).toEqual({ status: "scheduled", repos: 2, cap: 20 });
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockGate).not.toHaveBeenCalled();

    await runDeferred();

    expect(mockGate).toHaveBeenCalledTimes(3);
    // The gate is re-run through @/lib/github/pr-gate — the same writer the webhook uses — with the
    // PR's own head/base, never a forked check-writing path.
    expect(mockGate).toHaveBeenCalledWith({
      installationId: 42,
      owner: "acme",
      repo: "api",
      prNumber: 1,
      headSha: "sha1",
      baseRef: "main",
    });
    expect(mockGate).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "web", prNumber: 7, headSha: "sha7" }),
    );
  });

  it("caps the sweep at 20 PRs even when the fleet has far more open", async () => {
    mockWatched.mockResolvedValue([repo("acme", "a"), repo("acme", "b")]);
    mockFetch.mockResolvedValue(Array.from({ length: 50 }, (_, i) => pr(i + 1)));

    await save();
    await runDeferred();

    expect(mockGate).toHaveBeenCalledTimes(20);
    // The cap that matters — gate WORK (scans + check writes) — is exact. Listings are not: repos are
    // swept SWEEP_CONCURRENCY at a time, so up to that many can be listed before the budget is known to
    // be spent. That is a deliberate trade (a listing is one cheap read; a gated PR is two scans), and
    // it is bounded — never proportional to fleet size.
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("listing stays bounded by the concurrency, not by fleet size, once the PR budget is spent", async () => {
    mockWatched.mockResolvedValue(Array.from({ length: 25 }, (_, i) => repo("acme", `r${i}`)));
    mockFetch.mockResolvedValue(Array.from({ length: 50 }, (_, i) => pr(i + 1)));

    await save();
    await runDeferred();

    expect(mockGate).toHaveBeenCalledTimes(20); // still exactly the cap across a 25-repo fleet
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(4); // …and 21 repos are never listed at all
  });

  it("caps the number of repos it lists PRs for", async () => {
    mockWatched.mockResolvedValue(Array.from({ length: 80 }, (_, i) => repo("acme", `r${i}`)));
    mockFetch.mockResolvedValue([]); // no open PRs anywhere → the PR budget never bites

    const res = await save();
    const body = (await res.json()) as { sweep: { repos: number } };
    expect(body.sweep.repos).toBe(25);

    await runDeferred();
    expect(mockFetch).toHaveBeenCalledTimes(25);
  });

  it("skips cleanly, and SAYS SO, when the org has no App installation", async () => {
    mockInstallId.mockResolvedValue(null);
    mockWatched.mockResolvedValue([repo("acme", "api")]);

    const res = await save();
    const body = (await res.json()) as { ok: boolean; sweep: { status: string; reason: string } };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true); // the save itself still succeeded
    expect(body.sweep).toMatchObject({ status: "skipped", reason: "no-installation" });
    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
  });

  it("skips with a distinct reason when the installation exists but nothing is watched", async () => {
    mockWatched.mockResolvedValue([]);

    const body = (await (await save()).json()) as { sweep: { status: string; reason: string } };

    expect(body.sweep).toMatchObject({ status: "skipped", reason: "no-watched-repos" });
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("isolates a repo whose PR listing fails — the rest of the fleet is still re-checked", async () => {
    mockWatched.mockResolvedValue([repo("acme", "gone"), repo("acme", "web")]);
    mockFetch.mockRejectedValueOnce(new Error("404 Not Found")).mockResolvedValueOnce([pr(9)]);

    await save();
    await expect(runDeferred()).resolves.toBeUndefined();

    expect(mockGate).toHaveBeenCalledTimes(1);
    expect(mockGate).toHaveBeenCalledWith(expect.objectContaining({ repo: "web", prNumber: 9 }));
  });

  it("gives up quietly — never throwing out of after() — when the installation token can't be minted", async () => {
    mockWatched.mockResolvedValue([repo("acme", "api")]);
    mockToken.mockRejectedValue(new Error("401"));

    await save();
    await expect(runDeferred()).resolves.toBeUndefined();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGate).not.toHaveBeenCalled();
  });

  // A draft can't be merged, so its check blocks nothing — and `ready_for_review` is in the webhook's
  // PR_ACTIONS, so it gets re-gated against the current bar the moment it becomes mergeable. Spending
  // the 20-PR courtesy budget on drafts starved the PRs a bar change can actually keep wrongly green.
  it("does not spend sweep budget on DRAFT PRs", async () => {
    mockWatched.mockResolvedValue([repo("acme", "api")]);
    mockFetch.mockResolvedValue([{ ...pr(1), draft: true }, pr(2), { ...pr(3), draft: true }, pr(4)]);

    await save();
    await runDeferred();

    expect(mockGate).toHaveBeenCalledTimes(2);
    expect(mockGate.mock.calls.map(([ref]) => ref.prNumber)).toEqual([2, 4]);
  });

  it("lists a full page regardless of remaining budget, so drafts can't hide mergeable PRs behind them", async () => {
    mockWatched.mockResolvedValue([repo("acme", "api")]);
    mockFetch.mockResolvedValue([pr(1)]);

    await save();
    await runDeferred();

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("per_page=100"), "tok");
  });

  it("skips malformed PR rows rather than gating a PR with no head SHA", async () => {
    mockWatched.mockResolvedValue([repo("acme", "api")]);
    mockFetch.mockResolvedValue([{ number: 3, base: { ref: "main" } }, pr(4)]);

    await save();
    await runDeferred();

    expect(mockGate).toHaveBeenCalledTimes(1);
    expect(mockGate).toHaveBeenCalledWith(expect.objectContaining({ prNumber: 4 }));
  });

  // The audit trail for a MERGE-BLOCKING control has to answer "who lowered the security floor from 70
  // to 30" — `action: "set"` alone cannot. The row now carries the bar before and after, plus the
  // canonical human rendering in `status` (the field the audit viewer already displays).
  it("records WHAT the bar became and what it was, not just that it changed", async () => {
    vi.mocked(getOrgGatePolicy).mockResolvedValueOnce({ minLevel: "L3", minDimensionFor: { D9: 70 } });

    await save({ minLevel: "L3", minDimensionFor: { D9: 30 } });

    expect(recordOrgAudit).toHaveBeenCalledWith(
      "org.gate_policy",
      "acme",
      expect.objectContaining({
        action: "set",
        policy: { minLevel: "L3", minDimensionFor: { D9: 30 } },
        previousPolicy: { minLevel: "L3", minDimensionFor: { D9: 70 } },
        status: expect.stringContaining("no D9 < 30"), // the weakened floor is legible in the log
        previousStatus: expect.stringContaining("no D9 < 70"), // …next to the one it replaced
      }),
      "owner-login",
    );
  });

  it("a CLEAR is audited as the reset it is, naming the bar it removed", async () => {
    vi.mocked(getOrgGatePolicy).mockResolvedValueOnce({ minOverall: 60 });

    await save(null);

    expect(recordOrgAudit).toHaveBeenCalledWith(
      "org.gate_policy",
      "acme",
      expect.objectContaining({
        action: "cleared",
        policy: null,
        status: "cleared — archetype default",
        previousStatus: expect.stringContaining("min overall 60"),
      }),
      "owner-login",
    );
  });

  it("an audit-baseline read failure never fails the save (best-effort, unlike the gate's own read)", async () => {
    vi.mocked(getOrgGatePolicy).mockRejectedValueOnce(new Error("db down"));

    const res = await save({ minLevel: "L3" });

    expect(res.status).toBe(200);
    expect(recordOrgAudit).toHaveBeenCalledWith(
      "org.gate_policy",
      "acme",
      expect.objectContaining({ previousPolicy: null, previousStatus: "archetype default" }),
      "owner-login",
    );
  });

  it("sweeps on a CLEAR too — relaxing the bar must stop blocking PRs, not only tightening it", async () => {
    mockWatched.mockResolvedValue([repo("acme", "api")]);
    mockFetch.mockResolvedValue([pr(1)]);

    const body = (await (await save(null)).json()) as { policy: unknown; sweep: { status: string } };
    expect(body.policy).toBeNull();
    expect(body.sweep.status).toBe("scheduled");

    await runDeferred();
    expect(mockGate).toHaveBeenCalledTimes(1);
  });
});
