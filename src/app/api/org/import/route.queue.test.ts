// /api/org/import ENQUEUES its batch before scanning (backlog develop-2026-09-17 row 26), matching the
// sibling /api/org/scan: every selected repo is a durable ScanJob row before the first scan starts, the
// request drains what fits inside its 300s budget, and the remainder stays QUEUED for the background
// worker. Before, the import `mapPool`ed scanRepository inline and only ever inserted a row at claim
// time, so a run killed at 300s left no trace of the repos it never reached: the wizard's reattach poll
// (GET /api/org/scan/queue) could not finish work that was never enqueued.
//
// The budget is forced by stubbing `fleetDeadlineAt` into the past with one lane, so exactly the first
// repo is drained (drainUntilDeadline always runs one item before it has a duration to project).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

type Row = { id: string; repoFullName: string; reason: string; state: string; runId: string };
const q = vi.hoisted(() => ({ rows: [] as Row[], seq: 0 }));

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/org/degraded-read", () => ({ noteReadFailure: vi.fn(), degradedRead: vi.fn() }));
vi.mock("@/lib/scan-alerts", () => ({ maybeAlertLowCredits: vi.fn(async () => {}) }));
vi.mock("@/lib/pool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pool")>();
  return { ...actual, SCAN_CONCURRENCY: 1, fleetDeadlineAt: vi.fn(() => 0) };
});
vi.mock("@/lib/db/forge-installations", () => ({ getForgeInstallation: vi.fn(async () => null), hostFromBase: vi.fn() }));
// A small in-memory queue with the real module's state machine, so "the remainder is queued rows" is
// asserted against rows rather than against call counts alone.
vi.mock("@/lib/db/scan-jobs", () => ({
  JOB_PRIORITY: { manual: 10, webhook: 5, cadence: 0 },
  enqueueScanJob: vi.fn(async (i: { repoFullName: string; reason: string; runId: string }) => {
    const row = { id: `job_${++q.seq}`, repoFullName: i.repoFullName, reason: i.reason, state: "queued", runId: i.runId };
    q.rows.push(row);
    return { id: row.id, created: true };
  }),
  claimJobById: vi.fn(async (id: string) => {
    const row = q.rows.find((r) => r.id === id && r.state === "queued");
    if (!row) return null;
    row.state = "claimed";
    return { ...row, creditCharged: false };
  }),
  // The pre-row-26 enqueue-and-claim-at-once helper, faked with the same state machine so the
  // red-before run exercises the old inline path rather than a missing export.
  claimRepoWork: vi.fn(async (_org: string, repo: string, reason: string, o: { runId: string }) => {
    const row = { id: `job_${++q.seq}`, repoFullName: repo, reason, state: "claimed", runId: o.runId };
    q.rows.push(row);
    return { ...row, creditCharged: false };
  }),
  markJobCredit: vi.fn(async () => {}),
  settleJob: vi.fn(async (id: string, out: { state: string }) => {
    const row = q.rows.find((r) => r.id === id);
    if (row) row.state = out.state;
  }),
  listJobsForRun: vi.fn(async (_org: string, runId: string) => q.rows.filter((r) => r.runId === runId)),
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => null),
  consumeScanCredit: vi.fn(),
  grantCredits: vi.fn(async () => 0),
  isByomActive: vi.fn(async () => false),
  isDbConfigured: () => true,
  persistScanReport: vi.fn(async () => null),
  persistTeamStandings: vi.fn(async () => false),
  reconcileListedRepos: vi.fn(async () => ({ marked: 0, cleared: 0 })),
  recordQuotaEvent: vi.fn(async () => {}),
  recordScanOutcome: vi.fn(async () => {}),
  setRepoSchedule: vi.fn(async () => {}),
  setRepoWatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn(), isAppConfigured: () => true }));
vi.mock("@/lib/github/list", () => ({
  listOrgRepos: vi.fn(async () => ({ repos: [], truncated: false })),
  isValidHandle: () => true,
  isValidRepoName: () => true,
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => true) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => false), getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  canMintInstallationToken: vi.fn(async () => false),
  requireFleetOrg: vi.fn(async () => null),
}));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 10, allowanceRemaining: 0 })),
  paymentRequired: vi.fn(),
  orgNotFound: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequestShared: vi.fn(async () => ({ ok: true })),
  tooManyRequests: vi.fn(),
  ORG_IMPORT_RATE_LIMIT: {},
}));
vi.mock("@/lib/public-scan-quota", () => ({
  peekPublicScanQuota: vi.fn(async () => ({ enforced: true, remaining: 5 })),
  consumePublicScanQuota: vi.fn(async () => ({ enforced: true, allowed: true, chargedAt: 1 })),
  refundPublicScanQuota: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { consumeScanCredit, setRepoSchedule, setRepoWatch } from "@/lib/db";
import { claimJobById, enqueueScanJob, listJobsForRun } from "@/lib/db/scan-jobs";
import { noteReadFailure } from "@/lib/org/degraded-read";
import { authGateEnabled } from "@/lib/access";
import { decodeImportReason } from "@/lib/scan-import-policy";

const realReport = {
  engine: { provider: "anthropic", model: "claude" },
  level: { id: "l2" },
  posture: { id: "balanced" },
  overallScore: 50,
  adoptionScore: 50,
  rigorScore: 50,
  contributors: [],
} as unknown as ScanReport;

async function collect(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/org/import", { method: "POST", body: JSON.stringify(body) }),
  );
  const events: { event: string; data: Record<string, unknown> }[] = [];
  for (const frame of (await res.text()).split("\n\n")) {
    const ev = frame.match(/^event: (.+)$/m)?.[1];
    const data = frame.match(/^data: (.+)$/m)?.[1];
    if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
  }
  return events;
}

const REPOS = ["acme/a", "acme/b", "acme/c"];

beforeEach(() => {
  vi.clearAllMocks();
  q.rows.length = 0;
  vi.mocked(scanRepository).mockResolvedValue(realReport);
  vi.mocked(consumeScanCredit).mockResolvedValue({ ok: true, balance: 9, unlimited: false, charged: true } as never);
  vi.mocked(authGateEnabled).mockReturnValue(false);
});

describe("POST /api/org/import: enqueue the batch, drain to the deadline, leave the tail queued", () => {
  it("writes EVERY selected repo as a queued row before the first scan starts", async () => {
    await collect({ org: "acme", repos: REPOS, mock: false, watch: false });
    expect(vi.mocked(enqueueScanJob)).toHaveBeenCalledTimes(3);
    const lastEnqueue = Math.max(...vi.mocked(enqueueScanJob).mock.invocationCallOrder);
    expect(lastEnqueue).toBeLessThan(vi.mocked(scanRepository).mock.invocationCallOrder[0]!);
  });

  it("an import stopped by its budget leaves the unstarted repos as QUEUED rows of its run", async () => {
    const events = await collect({ org: "acme", repos: REPOS, mock: false, watch: false });
    expect(vi.mocked(scanRepository)).toHaveBeenCalledTimes(1);
    expect(q.rows.map((r) => [r.repoFullName, r.state])).toEqual([
      ["acme/a", "done"],
      ["acme/b", "queued"],
      ["acme/c", "queued"],
    ]);
    const queuedFrames = events.filter((e) => e.event === "queued");
    // The opening handle, then the honest remainder (the sibling scan route's shape).
    expect(queuedFrames.at(-1)?.data).toMatchObject({ queued: 2, total: 3 });
    expect(events.find((e) => e.event === "result")?.data).toMatchObject({ scanned: 1, total: 3, queued: 2 });
  });

  it("reserves ONE credit per repo actually scanned; the queued tail reserves nothing here", async () => {
    await collect({ org: "acme", repos: REPOS, mock: false, watch: false });
    expect(vi.mocked(consumeScanCredit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(claimJobById)).toHaveBeenCalledTimes(1);
  });

  it("stamps the request's scan policy on every row, so the worker scans the tail the same way", async () => {
    await collect({ org: "acme", repos: REPOS, mock: true, watch: false });
    expect(q.rows).toHaveLength(3);
    for (const r of q.rows) expect(decodeImportReason(r.reason)).toEqual({ token: "none", mock: true, funnel: false });
  });

  it("guard: enrols the queued tail in the watchlist the caller asked for, not only the scanned head", async () => {
    await collect({ org: "acme", repos: REPOS, mock: false, watch: true, schedule: "weekly" });
    const watched = vi.mocked(setRepoWatch).mock.calls.map((c) => (c[1] as { fullName: string }).fullName);
    expect(watched.sort()).toEqual(REPOS);
    expect(vi.mocked(setRepoSchedule)).toHaveBeenCalledTimes(3);
  });

  it("a PUBLIC-FUNNEL tail is settled skipped, not queued: its allowance is metered per request", async () => {
    const events = await collect({ org: "acme", repos: REPOS, mock: false, watch: false, publicFunnel: true });
    expect(q.rows.map((r) => r.state)).toEqual(["done", "skipped", "skipped"]);
    expect(events.find((e) => e.event === "result")?.data).toMatchObject({ scanned: 1, queued: 0 });
  });
});

describe("POST /api/org/import: a failed remainder read is not an empty remainder", () => {
  it("goes through the door and sends the queued frame with the runId and queued: null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(listJobsForRun).mockRejectedValueOnce(new Error("read down"));

    const events = await collect({ org: "acme", repos: REPOS, mock: false, watch: false });

    expect(vi.mocked(noteReadFailure)).toHaveBeenCalledWith(expect.stringContaining("listJobsForRun"), expect.any(Error));
    const opening = events.find((e) => e.event === "queued")!;
    const last = events.filter((e) => e.event === "queued").at(-1)!;
    expect(last.data).toMatchObject({ runId: opening.data.runId, queued: null, total: 3 });
    expect(events.find((e) => e.event === "result")?.data).toMatchObject({ runId: opening.data.runId, queued: null });
  });
});
