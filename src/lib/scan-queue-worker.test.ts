// The lane-agnostic drain (moonshot #10). The guards that matter:
//
//   • DOUBLE-BILLING ACROSS INSTANCES — two workers racing for one queued rescore job: exactly one
//     wins the claim, so exactly one `reserveScanCredit` happens. Against the deleted process-local
//     Map, two simulated processes each held their own claim and both reserved.
//   • THE REFUND BOUNDARY IS UNCHANGED — a pre-inference throw refunds; a post-inference throw keeps
//     the credit and says so.
//   • TRUNCATION IS NOT LOSS — a job the deadline never reached stays queued, and the next drain
//     completes exactly it, with no repo run twice.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  scanRepository: vi.fn(),
  claimJob: vi.fn(),
  claimJobById: vi.fn(),
  markJobCredit: vi.fn(),
  reapExpiredLeases: vi.fn(),
  settleJob: vi.fn(),
  reserveScanCredit: vi.fn(),
  refundScanCredit: vi.fn(),
  probeRepository: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
  getInstallationToken: vi.fn(),
  persistScanReport: vi.fn(),
  getRepoSchedule: vi.fn(),
  advanceToFullCadence: vi.fn(),
  advanceScheduleAfterFailure: vi.fn(),
}));

vi.mock("@/lib/scan", () => ({ scanRepository: h.scanRepository }));
vi.mock("@/lib/db", () => ({
  advanceScheduleAfterFailure: h.advanceScheduleAfterFailure,
  advanceToFullCadence: h.advanceToFullCadence,
  getInstallationIdForOwner: h.getInstallationIdForOwner,
  getOrgId: vi.fn(async () => "org_1"),
  getScanReportByCommit: vi.fn(async () => null),
  isByomActive: vi.fn(async () => false),
  persistScanReport: h.persistScanReport,
  recordScanOutcome: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/scan-jobs", () => ({
  claimJob: h.claimJob,
  claimJobById: h.claimJobById,
  markJobCredit: h.markJobCredit,
  reapExpiredLeases: h.reapExpiredLeases,
  settleJob: h.settleJob,
}));
vi.mock("@/lib/db/org-watch", () => ({ getRepoSchedule: h.getRepoSchedule }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: h.getInstallationToken }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: vi.fn(async () => {}) }));
vi.mock("@/lib/scan-credit", () => ({
  refundScanCredit: h.refundScanCredit,
  reserveScanCredit: h.reserveScanCredit,
  shouldRefundScan: (r: { engine: { provider: string } }, p: { deduped: boolean } | null) =>
    r.engine.provider === "mock" || Boolean(p?.deduped),
}));
vi.mock("@/lib/scan-probe", () => ({ probeRepository: h.probeRepository }));

import { drainLane } from "./scan-queue-worker";

const job = (over: Record<string, unknown> = {}) => ({
  id: "job_1",
  orgId: "org_1",
  repoId: "repo_1",
  repoFullName: "acme/api",
  lane: "rescore",
  reason: "cadence",
  state: "claimed",
  priority: 0,
  runId: null,
  idempotencyKey: "k",
  notBefore: "2026-08-30T00:00:00.000Z",
  claimedAt: "2026-08-30T00:00:00.000Z",
  claimedBy: "w",
  leaseUntil: "2026-08-30T00:15:00.000Z",
  attempts: 1,
  creditCharged: false,
  resultJson: null,
  error: null,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  settledAt: null,
  ...over,
});

const report = (provider = "sonnet") => ({
  engine: { provider },
  level: { id: "managed" },
  overallScore: 71,
  posture: { id: "steady" },
  adoptionScore: 60,
  rigorScore: 80,
});

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.reapExpiredLeases.mockResolvedValue(0);
  h.settleJob.mockResolvedValue(undefined);
  h.getInstallationIdForOwner.mockResolvedValue(1);
  h.getInstallationToken.mockResolvedValue("tok");
  h.reserveScanCredit.mockResolvedValue({ skip: false, reserved: true });
  h.refundScanCredit.mockResolvedValue(undefined);
  h.persistScanReport.mockResolvedValue({ deduped: false });
  h.getRepoSchedule.mockResolvedValue("weekly");
  h.markJobCredit.mockResolvedValue(undefined);
  h.advanceToFullCadence.mockResolvedValue(undefined);
  h.advanceScheduleAfterFailure.mockResolvedValue(undefined);
  h.probeRepository.mockResolvedValue({ fullName: "acme/api", written: 0, transitions: 0, unmeasurable: 0, present: true });
  h.scanRepository.mockResolvedValue(report());
});

const opts = (over: Record<string, unknown> = {}) => ({
  concurrency: 1,
  deadlineAt: Date.now() + 600_000,
  orgSlug: "acme",
  ...over,
});

describe("double-billing across instances", () => {
  it("two workers racing one queued job: the loser's claim returns null, so ONE credit is reserved", async () => {
    // The DB serializes the claim: the first worker's conditional update matches, the second's
    // matches zero rows. Simulated here as the two answers claimJobById actually gives.
    h.claimJobById.mockResolvedValueOnce(job()).mockResolvedValueOnce(null);

    const a = await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));
    const b = await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    expect(a.done).toBe(1);
    expect(b.claimed).toBe(0);
    expect(b.skipped).toBe(1);
    expect(h.reserveScanCredit).toHaveBeenCalledTimes(1);
    expect(h.reserveScanCredit).toHaveBeenCalledWith("acme", "acme/api", { actor: "queue:cadence" });
    expect(h.scanRepository).toHaveBeenCalledTimes(1);
  });
});

describe("the refund boundary is carried over unedited", () => {
  it("a PRE-inference throw refunds, and the job records the refund", async () => {
    h.claimJobById.mockResolvedValue(job());
    h.scanRepository.mockRejectedValue(new Error("github exploded"));

    const s = await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    expect(s.failed).toBe(1);
    // Attributed: the refund names the repo it reverses and the queue reason that spent the credit
    // ("cadence" here — a scheduled rescan), so ledger spend is joinable rather than an anonymous +1.
    expect(h.refundScanCredit).toHaveBeenCalledWith("acme", true, { actor: "queue:cadence", repoFullName: "acme/api" });
    expect(h.settleJob.mock.calls[0]![1]).toMatchObject({ state: "failed", creditRefunded: true });
    // A failed scan backs off 6h rather than waiting a whole cadence.
    expect(h.advanceScheduleAfterFailure).toHaveBeenCalledWith("repo_1");
  });

  it("a POST-inference throw KEEPS the credit and names it in the error", async () => {
    h.claimJobById.mockResolvedValue(job());
    h.persistScanReport.mockRejectedValue(new Error("serialization conflict"));

    const s = await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    expect(h.refundScanCredit).not.toHaveBeenCalled();
    expect(s.errors[0]).toContain("credit kept, inference already ran");
    expect(h.settleJob.mock.calls[0]![1]).toMatchObject({ creditRefunded: false });
  });

  it("a mock-degraded scan refunds — no inference was billed", async () => {
    h.claimJobById.mockResolvedValue(job());
    h.scanRepository.mockResolvedValue(report("mock"));

    await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    // Attributed: the refund names the repo it reverses and the queue reason that spent the credit
    // ("cadence" here — a scheduled rescan), so ledger spend is joinable rather than an anonymous +1.
    expect(h.refundScanCredit).toHaveBeenCalledWith("acme", true, { actor: "queue:cadence", repoFullName: "acme/api" });
    expect(h.settleJob.mock.calls[0]![1]).toMatchObject({ state: "done", creditRefunded: true });
  });

  it("the credit is recorded ON THE JOB ROW before any inference runs", async () => {
    h.claimJobById.mockResolvedValue(job());
    await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));
    expect(h.markJobCredit).toHaveBeenCalledWith("job_1", true);
    expect(h.markJobCredit.mock.invocationCallOrder[0]!).toBeLessThan(h.scanRepository.mock.invocationCallOrder[0]!);
  });

  it("an exhausted balance skips the repo, settles the cadence, and never scans", async () => {
    h.claimJobById.mockResolvedValue(job());
    h.reserveScanCredit.mockResolvedValue({ skip: true, reserved: false });

    const s = await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    expect(s.skippedForCredits).toBe(1);
    expect(h.scanRepository).not.toHaveBeenCalled();
    expect(h.advanceToFullCadence).toHaveBeenCalledWith("repo_1", "weekly");
  });

  it("a broken installation token backs off 6h instead of burning a whole cadence", async () => {
    h.claimJobById.mockResolvedValue(job());
    h.getInstallationToken.mockResolvedValue(undefined);

    const s = await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    expect(s.skippedNoToken).toBe(1);
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
    expect(h.advanceScheduleAfterFailure).toHaveBeenCalledWith("repo_1");
  });
});

describe("truncation is not loss", () => {
  it("the deadline stops the drain, and the NEXT drain completes exactly the untouched job", async () => {
    const queue = [job({ id: "job_1" }), job({ id: "job_2", repoFullName: "acme/web" })];
    h.claimJob.mockImplementation(async () => queue.shift() ?? null);
    // A clock that jumps a minute per item, against a deadline only one item wide.
    let t = 0;
    const now = () => (t += 60_000);

    const first = await drainLane("rescore", opts({ deadlineAt: 90_000, now, orgSlug: "acme" }));

    expect(first.truncated).toBe(true);
    expect(first.done).toBe(1);
    // job_2 was never claimed — it is still in the queue, neither failed nor settled.
    expect(h.settleJob).toHaveBeenCalledTimes(1);
    expect(queue.map((j) => j.id)).toEqual(["job_2"]);

    const second = await drainLane("rescore", opts({ orgSlug: "acme" }));
    expect(second.done).toBe(1);
    expect(h.scanRepository).toHaveBeenCalledTimes(2);
    expect(h.scanRepository.mock.calls.map((c) => c[0])).toEqual(["acme/api", "acme/web"]);
  });

  it("reaps expired leases at the head of every drain, so a killed worker self-heals", async () => {
    h.claimJob.mockResolvedValue(null);
    await drainLane("probe", opts());
    expect(h.reapExpiredLeases).toHaveBeenCalledTimes(1);
  });
});

describe("the probe lane spends nothing", () => {
  it("runs no scan and touches no credit path", async () => {
    h.claimJob.mockResolvedValueOnce(job({ lane: "probe" })).mockResolvedValue(null);
    h.probeRepository.mockResolvedValue({ fullName: "acme/api", written: 2, transitions: 1, unmeasurable: 0, present: true });

    const s = await drainLane("probe", opts());

    expect(s.done).toBe(1);
    expect(h.scanRepository).not.toHaveBeenCalled();
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
    expect(h.settleJob.mock.calls[0]![1]).toMatchObject({ state: "done", result: { written: 2, transitions: 1 } });
  });
});

// ── DOUBLE-BILLING ACROSS RETRIES ───────────────────────────────────────────────────────────────
// The suite above pins the CONCURRENT race (two workers, one claim, one reservation). The other half
// is SEQUENTIAL and is the case this queue exists for: a worker reserves a credit, starts inference,
// and is process-killed at the 300s ceiling — no finally, no settleJob, no refund. Fifteen minutes
// later reapExpiredLeases returns the row to the queue with `creditCharged` still true, because
// settleJob is the ONLY path that clears it and it never ran.
//
// `creditCharged` is written precisely so that reservation survives the kill — runRescoreJob's own
// comment calls it "the single record of the reservation - a process kill leaves it attributable".
// Nothing read it, so the retry reserved a second credit for a job already holding one, up to
// MAX_JOB_ATTEMPTS times.
describe("a requeued job does not buy its credit twice", () => {
  it("reuses the credit the row already holds instead of reserving another", async () => {
    // What the reaper leaves behind: queued again, lease cleared, creditCharged untouched.
    h.claimJobById.mockResolvedValueOnce(job({ creditCharged: true, attempts: 2 }));

    const out = await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    expect(out.done).toBe(1);
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
    // Nothing to re-mark: the row already says so.
    expect(h.markJobCredit).not.toHaveBeenCalled();
    expect(h.scanRepository).toHaveBeenCalledTimes(1);
  });

  it("still refunds that carried credit when the retry fails BEFORE inference", async () => {
    // The carried credit must behave exactly like a freshly reserved one at the refund boundary —
    // otherwise skipping the reservation would silently strand it.
    h.claimJobById.mockResolvedValueOnce(job({ creditCharged: true }));
    h.scanRepository.mockRejectedValueOnce(new Error("github 502"));

    const out = await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    expect(out.failed).toBe(1);
    expect(h.refundScanCredit).toHaveBeenCalledWith("acme", true, { actor: "queue:cadence", repoFullName: "acme/api" });
    expect(h.settleJob).toHaveBeenCalledWith("job_1", expect.objectContaining({ state: "failed", creditRefunded: true }));
  });

  it("still reserves for a first attempt — the row says it holds nothing", async () => {
    // The control: creditCharged false is the normal path and must be untouched by the guard.
    h.claimJobById.mockResolvedValueOnce(job({ creditCharged: false }));

    await drainLane("rescore", opts({ jobs: [{ id: "job_1", repo: "acme/api" }] }));

    expect(h.reserveScanCredit).toHaveBeenCalledTimes(1);
    expect(h.markJobCredit).toHaveBeenCalledWith("job_1", true);
  });
});
