// POST /api/org/scan — the route's OWN contract, after moonshot #10 moved the scan loop into the
// durable queue.
//
// What this file pins now: the gate, the credit-capacity slice, that every selected repo becomes a
// queued job under ONE runId BEFORE anything is scanned, that the drain is scoped to this run's jobs,
// that the worker's per-repo events reach the client as the same SSE frames they always did, and that
// a budget-stopped run emits `queued` (work still owed) where it used to emit `truncated` (work
// dropped).
//
// WHAT MOVED, so nothing here is silently lost: the reserve→scan→refund policy — dedupe/degrade
// refunds, the pre- vs post-inference boundary, BYOM/unmetered no-ops, never-scan-for-free, and the
// claim that stops two runs double-charging one repo — is now `src/lib/scan-queue-worker.ts` and is
// tested in `src/lib/scan-queue-worker.test.ts`. It is ONE implementation for the cron, the bulk scan
// and the import, instead of three copies that could drift.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isByomActive: vi.fn(async () => false),
  isDbConfigured: () => true,
  listWatchedRepos: vi.fn(),
  persistTeamStandings: vi.fn(async () => false),
}));
vi.mock("@/lib/db/scan-jobs", () => ({
  JOB_PRIORITY: { manual: 10, webhook: 5, cadence: 0 },
  enqueueScanJob: vi.fn(),
  listJobsForRun: vi.fn(async () => []),
}));
vi.mock("@/lib/scan-queue-worker", () => ({ drainLane: vi.fn() }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  // Default: the target org IS a fleet org (not personal), so this suite's scenarios pass the gate
  // unimpeded. requireFleetOrg's own deny logic is exercised where the personal-workspace tests live.
  requireFleetOrg: vi.fn(async () => null),
}));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 })),
  paymentRequired: vi.fn(() => new Response("{}", { status: 402 })),
}));

import { POST } from "./route";
import { listWatchedRepos } from "@/lib/db";
import { enqueueScanJob, listJobsForRun } from "@/lib/db/scan-jobs";
import { drainLane } from "@/lib/scan-queue-worker";
import { checkScanEntitlement } from "@/lib/entitlement";
import { requireOrgAccess } from "@/lib/authz";

const mockList = vi.mocked(listWatchedRepos);
const mockEnqueue = vi.mocked(enqueueScanJob);
const mockJobsForRun = vi.mocked(listJobsForRun);
const mockDrain = vi.mocked(drainLane);
const mockEntitlement = vi.mocked(checkScanEntitlement);
const mockGate = vi.mocked(requireOrgAccess);

const watched = (...names: string[]) =>
  names.map((fullName) => ({ fullName, lastScanAt: null })) as unknown as Awaited<ReturnType<typeof listWatchedRepos>>;

const summary = (over: Record<string, unknown> = {}) => ({
  claimed: 1,
  done: 1,
  failed: 0,
  skipped: 0,
  skippedForCredits: 0,
  skippedNoToken: 0,
  truncated: false,
  errors: [],
  ...over,
});

/** Drain the SSE body so the stream's work runs to completion; return it for assertions. */
async function runBulkScan(body: Record<string, unknown> = { org: "acme" }) {
  const res = await POST(
    new Request("http://localhost/api/org/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return res.text();
}

function frame(body: string, event: string): Record<string, unknown> | null {
  const f = body.split("\n\n").find((x) => x.includes(`event: ${event}`));
  if (!f) return null;
  return JSON.parse(f.match(/^data: (.+)$/m)![1]!) as Record<string, unknown>;
}

let n = 0;
beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue(watched("acme/repo"));
  mockEnqueue.mockImplementation(async () => ({ id: `job_${++n}`, created: true }));
  mockDrain.mockResolvedValue(summary());
  mockJobsForRun.mockResolvedValue([]);
  mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
  mockGate.mockResolvedValue(null);
});

describe("POST /api/org/scan — enqueue then drain", () => {
  it("enqueues one rescore job per selected repo under ONE runId, before anything is scanned", async () => {
    mockList.mockResolvedValue(watched("acme/a", "acme/b"));
    await runBulkScan();

    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    const [first, second] = mockEnqueue.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ orgSlug: "acme", repoFullName: "acme/a", lane: "rescore", reason: "manual", priority: 10 });
    // ONE runId for the batch — it is both the idempotency bucket (a double-clicked "Scan all"
    // enqueues nothing new) and the handle the client polls its own remainder with.
    expect(first!.runId).toBe(second!.runId);
    expect(first!.bucket).toBe(first!.runId);
    // Enqueue happens BEFORE the drain: whatever this invocation cannot finish is already durable.
    expect(mockEnqueue.mock.invocationCallOrder[0]!).toBeLessThan(mockDrain.mock.invocationCallOrder[0]!);
  });

  it("drains ONLY this run's jobs, in this org — not the whole lane", async () => {
    mockList.mockResolvedValue(watched("acme/a", "acme/b"));
    await runBulkScan();

    const opts = mockDrain.mock.calls[0]![1];
    expect(mockDrain.mock.calls[0]![0]).toBe("rescore");
    expect(opts.orgSlug).toBe("acme");
    expect(opts.jobs?.map((j) => j.repo)).toEqual(["acme/a", "acme/b"]);
  });

  it("narrows the enqueue to an explicit repo scope", async () => {
    mockList.mockResolvedValue(watched("acme/a", "acme/b"));
    await runBulkScan({ org: "acme", repos: ["acme/b"] });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0]![0].repoFullName).toBe("acme/b");
  });

  it("never enqueues for a caller the org gate refused", async () => {
    mockGate.mockResolvedValue(new Response("nope", { status: 403 }));
    await runBulkScan();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/scan — the worker's events reach the client unchanged", () => {
  it("maps a scored repo onto the same `repo` + `progress` frames the war-room already reads", async () => {
    mockDrain.mockImplementation(async (_lane, opts) => {
      opts.onRepo?.({ repo: "acme/repo", stage: "start" });
      opts.onScanProgress?.("acme/repo", { stage: "analyze", pct: 62 } as Parameters<NonNullable<typeof opts.onScanProgress>>[1]);
      opts.onRepo?.({ repo: "acme/repo", stage: "done", level: "l2", overall: 50, posture: "balanced", adoption: 40, rigor: 60 });
      return summary();
    });

    const body = await runBulkScan();

    expect(frame(body, "repo")).toMatchObject({ repo: "acme/repo", level: "l2", overall: 50 });
    // The sub-stage frame carries the SAME index/total as its boundary frame, so a consumer that
    // assigns `done = index` can never inflate the denominator with sub-progress.
    const sub = body.split("\n\n").find((f) => f.includes('"stage":"analyze"'))!;
    expect(sub).toContain('"index":0');
  });

  it("says `charged` on a post-inference failure instead of charging silently", async () => {
    mockDrain.mockImplementation(async (_lane, opts) => {
      opts.onRepo?.({ repo: "acme/repo", stage: "error", error: "persist blew up", charged: true });
      return summary({ done: 0, failed: 1 });
    });

    const body = await runBulkScan();
    expect(frame(body, "repo")).toMatchObject({ repo: "acme/repo", error: "persist blew up", charged: true });
  });

  it("surfaces a mid-run credit skip rather than dropping it", async () => {
    mockDrain.mockImplementation(async (_lane, opts) => {
      opts.onRepo?.({ repo: "acme/repo", stage: "skipped", reason: "insufficient_credits" });
      return summary({ done: 0, skippedForCredits: 1 });
    });

    const body = await runBulkScan();
    expect(frame(body, "repo")).toMatchObject({ skipped: "insufficient_credits" });
    expect(frame(body, "result")).toMatchObject({ skippedForCredits: 1, scanned: 0 });
  });
});

describe("POST /api/org/scan — truncation is no longer loss", () => {
  it("emits a `queued` frame naming the run's remainder, NOT a `truncated` one", async () => {
    mockList.mockResolvedValue(watched("acme/a", "acme/b"));
    mockDrain.mockResolvedValue(summary({ truncated: true, done: 1 }));
    mockJobsForRun.mockResolvedValue([
      { state: "done", repoFullName: "acme/a" },
      { state: "queued", repoFullName: "acme/b" },
    ] as unknown as Awaited<ReturnType<typeof listJobsForRun>>);

    const body = await runBulkScan();

    // The old frame promised the CLIENT would have to finish the job. The new one promises we will.
    expect(body).not.toContain("event: truncated");
    expect(frame(body, "queued")).toMatchObject({ queued: 1, total: 2 });
    expect(frame(body, "result")).toMatchObject({ queued: 1 });
    expect(frame(body, "result")!.runId).toEqual(frame(body, "queued")!.runId);
  });

  it("emits NO queued frame when the run drained everything", async () => {
    const body = await runBulkScan();
    expect(body).not.toContain("event: queued");
    expect(frame(body, "result")).toMatchObject({ queued: 0, scanned: 1 });
  });
});

describe("POST /api/org/scan — credit capacity is still decided up front", () => {
  it("surfaces an out-of-credits error (not a silent 0/0 success) when the balance slices the list to empty", async () => {
    mockList.mockResolvedValue(watched("acme/a", "acme/b"));
    // Allowance spent AND no credits ⇒ capacity 0 ⇒ the scan list slices to empty.
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 0, allowanceRemaining: 0 });

    const body = await runBulkScan();

    expect(body).toContain("Out of scan credits");
    // Nothing was queued — an unaffordable repo must not sit in the queue looking like owed work.
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it("queues an org's INCLUDED free allowance even at a zero prepaid balance (allowance-cap fix)", async () => {
    mockList.mockResolvedValue(watched("acme/a", "acme/b"));
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 0, allowanceRemaining: 2 });

    const body = await runBulkScan();

    expect(body).not.toContain("Out of scan credits");
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  it("discloses an up-front partial slice before the run starts", async () => {
    mockList.mockResolvedValue(watched("acme/a", "acme/b", "acme/c"));
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 1, allowanceRemaining: 0 });

    const body = await runBulkScan();

    expect(frame(body, "notice")).toMatchObject({ reason: "insufficient_credits", scanning: 1, skipped: 2 });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("refuses the whole batch with 402 when the org has no entitlement at all", async () => {
    mockEntitlement.mockResolvedValue({ allowed: false, unlimited: false, balance: 0, allowanceRemaining: 0 });
    const res = await POST(
      new Request("http://localhost/api/org/scan", { method: "POST", body: JSON.stringify({ org: "acme" }) }),
    );
    expect(res.status).toBe(402);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// A BROKEN INSTALLATION is not a successful scan. The worker emits three skip reasons —
// insufficient_credits, in_progress, no_token — and the result frame carried only the first two, so
// an org whose GitHub App install was revoked/suspended saw every repo skip, the client's mid-run
// count get overwritten by `skippedForCredits: 0`, and the button settle on a clean N/N with no
// failures, no skips and no error: a completed scan that produced nothing.
describe("POST /api/org/scan — a token-less fleet says so", () => {
  it("reports skippedNoToken on the result frame", async () => {
    mockDrain.mockImplementation(async (_lane, opts) => {
      opts.onRepo?.({ repo: "acme/repo", stage: "skipped", reason: "no_token" });
      return summary({ done: 0, skippedNoToken: 1 });
    });

    const body = await runBulkScan();
    expect(frame(body, "repo")).toMatchObject({ skipped: "no_token" });
    // Without this the client's only signal was the per-repo frame, which its `result` handler then
    // overwrote with skippedForCredits (0) — so the run settled as a clean, empty success.
    expect(frame(body, "result")).toMatchObject({ skippedNoToken: 1, scanned: 0, skippedForCredits: 0 });
  });

  it("keeps the two skip reasons apart on the wire", async () => {
    mockDrain.mockImplementation(async () => summary({ done: 0, skippedNoToken: 2, skippedForCredits: 3 }));

    const body = await runBulkScan();
    expect(frame(body, "result")).toMatchObject({ skippedNoToken: 2, skippedForCredits: 3 });
  });
});
