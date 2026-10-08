// The PUSH branch of the rescore worker (push-triggered-rescan part 2). A job enqueued with reason
// `webhook:push` is a rescan a webhook asked for, not a slot on the repo's schedule. What is pinned:
//
//   • NO CADENCE MOVEMENT on any branch — success, throw, credit skip, degrade, no token.
//   • THE FAILURE BACKOFF — a failed attempt younger than 6 h skips with no reserve and no outcome
//     write; a credit-skip error is exempt, so a topped-up org scans on its next push.
//   • THE PUSH PATH'S MONEY, KEPT — isMeteredScan (a BYOM org is still metered), the degrade guard
//     (no persist, no alert, refund, a failed outcome), and the creditCharged carry on a reaped row.
//   • A cadence job still settles its cadence (the branch is push-only).

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  scanRepository: vi.fn(),
  claimJobById: vi.fn(),
  markJobCredit: vi.fn(),
  reapExpiredLeases: vi.fn(),
  settleJob: vi.fn(),
  reserveScanCredit: vi.fn(),
  refundScanCredit: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
  getInstallationToken: vi.fn(),
  persistScanReport: vi.fn(),
  getRepoSchedule: vi.fn(),
  advanceToFullCadence: vi.fn(),
  advanceScheduleAfterFailure: vi.fn(),
  recordScanOutcome: vi.fn(),
  getLastScanAttempt: vi.fn(),
  getScanReportByCommit: vi.fn(),
  isByomActive: vi.fn(),
  isMeteredScan: vi.fn(),
  checkAndAlertRegression: vi.fn(),
}));

vi.mock("@/lib/scan", () => ({ scanRepository: h.scanRepository }));
vi.mock("@/lib/db", async () => {
  // The backoff DECISION is the real one: stubbing it would let this suite pass on the wrong rule.
  const { inFailureBackoff, CREDIT_SKIP_ERROR } = await vi.importActual<typeof import("@/lib/db/org-watch")>("@/lib/db/org-watch");
  return {
    advanceScheduleAfterFailure: h.advanceScheduleAfterFailure,
    advanceToFullCadence: h.advanceToFullCadence,
    getInstallationIdForOwner: h.getInstallationIdForOwner,
    getLastScanAttempt: h.getLastScanAttempt,
    getOrgId: vi.fn(async () => "org_1"),
    getScanReportByCommit: h.getScanReportByCommit,
    inFailureBackoff,
    CREDIT_SKIP_ERROR,
    isByomActive: h.isByomActive,
    persistScanReport: h.persistScanReport,
    recordScanOutcome: h.recordScanOutcome,
  };
});
vi.mock("@/lib/db/scan-jobs", () => ({
  claimJob: vi.fn(async () => null),
  claimJobById: h.claimJobById,
  markJobCredit: h.markJobCredit,
  reapExpiredLeases: h.reapExpiredLeases,
  settleJob: h.settleJob,
}));
vi.mock("@/lib/db/org-watch", () => ({ getRepoSchedule: h.getRepoSchedule }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: h.getInstallationToken }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: h.checkAndAlertRegression }));
vi.mock("@/lib/entitlement", () => ({ isMeteredScan: h.isMeteredScan }));
vi.mock("@/lib/scan-credit", () => ({
  refundScanCredit: h.refundScanCredit,
  reserveScanCredit: h.reserveScanCredit,
  shouldRefundScan: (r: { engine: { provider: string } }, p: { deduped: boolean } | null) =>
    r.engine.provider === "mock" || Boolean(p?.deduped),
}));
vi.mock("@/lib/scan-probe", () => ({ probeRepository: vi.fn() }));

import { drainLane, PUSH_DEGRADED_ERROR, PUSH_JOB_REASON } from "./scan-queue-worker";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

const job = (over: Record<string, unknown> = {}) => ({
  id: "job_1",
  orgId: "org_1",
  repoId: "repo_1",
  repoFullName: "acme/api",
  lane: "rescore",
  reason: PUSH_JOB_REASON,
  state: "claimed",
  priority: 5,
  runId: null,
  idempotencyKey: "k",
  notBefore: "2026-10-08T12:00:00.000Z",
  claimedAt: "2026-10-08T12:00:00.000Z",
  claimedBy: "webhook:d1",
  leaseUntil: "2026-10-08T12:15:00.000Z",
  attempts: 1,
  creditCharged: false,
  resultJson: null,
  error: null,
  createdAt: "2026-10-08T12:00:00.000Z",
  updatedAt: "2026-10-08T12:00:00.000Z",
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
  h.claimJobById.mockResolvedValue(job());
  h.getInstallationIdForOwner.mockResolvedValue(1);
  h.getInstallationToken.mockResolvedValue("tok");
  h.reserveScanCredit.mockResolvedValue({ skip: false, reserved: true });
  h.refundScanCredit.mockResolvedValue(undefined);
  h.persistScanReport.mockResolvedValue({ deduped: false });
  h.getRepoSchedule.mockResolvedValue("weekly");
  h.markJobCredit.mockResolvedValue(undefined);
  h.advanceToFullCadence.mockResolvedValue(undefined);
  h.advanceScheduleAfterFailure.mockResolvedValue(undefined);
  h.recordScanOutcome.mockResolvedValue(undefined);
  h.getLastScanAttempt.mockResolvedValue(null);
  h.getScanReportByCommit.mockResolvedValue(null);
  h.isByomActive.mockResolvedValue(false);
  h.isMeteredScan.mockReturnValue(true);
  h.checkAndAlertRegression.mockResolvedValue(undefined);
  h.scanRepository.mockResolvedValue(report());
});

const drain = () =>
  drainLane("rescore", {
    concurrency: 1,
    deadlineAt: NOW + 600_000,
    orgSlug: "acme",
    jobs: [{ id: "job_1", repo: "acme/api" }],
    workerId: "webhook:d1",
    now: () => NOW,
  });

const cadenceUntouched = () => {
  expect(h.getRepoSchedule).not.toHaveBeenCalled();
  expect(h.advanceToFullCadence).not.toHaveBeenCalled();
  expect(h.advanceScheduleAfterFailure).not.toHaveBeenCalled();
};

describe("push job: success and failure leave the cadence alone", () => {
  it("success records ok, settles done, alerts on a new row, and never calls settleCadence", async () => {
    const s = await drain();
    expect(s.done).toBe(1);
    expect(h.recordScanOutcome).toHaveBeenCalledWith("acme", "acme/api", { ok: true });
    expect(h.checkAndAlertRegression).toHaveBeenCalledTimes(1);
    expect(h.settleJob).toHaveBeenCalledWith("job_1", expect.objectContaining({ state: "done" }));
    cadenceUntouched();
  });

  it("the ledger actor is the queue's: queue:webhook:push", async () => {
    await drain();
    expect(h.reserveScanCredit).toHaveBeenCalledWith("acme", "acme/api", { actor: "queue:webhook:push" });
  });

  it("a scan that throws BEFORE inference records failed, refunds, and never backs the cadence off", async () => {
    h.scanRepository.mockRejectedValueOnce(new Error("token mint failed"));
    const s = await drain();
    expect(s.failed).toBe(1);
    expect(h.recordScanOutcome).toHaveBeenCalledWith("acme", "acme/api", { ok: false, error: "token mint failed" });
    expect(h.refundScanCredit).toHaveBeenCalledWith("acme", true, { actor: "queue:webhook:push", repoFullName: "acme/api" });
    expect(h.settleJob).toHaveBeenCalledWith("job_1", expect.objectContaining({ state: "failed", creditRefunded: true }));
    cadenceUntouched();
  });

  it("a throw AFTER a real report keeps the credit (the inference ran)", async () => {
    h.persistScanReport.mockRejectedValueOnce(new Error("persist failed"));
    const s = await drain();
    expect(s.failed).toBe(1);
    expect(h.refundScanCredit).not.toHaveBeenCalled();
    expect(h.recordScanOutcome).toHaveBeenCalledWith("acme", "acme/api", { ok: false, error: "persist failed" });
    cadenceUntouched();
  });

  it("a broken installation records its outcome but does not back the cadence off", async () => {
    h.getInstallationToken.mockRejectedValue(new Error("401"));
    const s = await drain();
    expect(s.skippedNoToken).toBe(1);
    expect(h.recordScanOutcome).toHaveBeenCalledWith("acme", "acme/api", { ok: false, error: "installation token unavailable" });
    cadenceUntouched();
  });
});

describe("push job: the degrade-to-mock guard", () => {
  it("does not persist, sends no alert, refunds, records a failed outcome and leaves the cadence alone", async () => {
    h.scanRepository.mockResolvedValueOnce(report("mock"));
    const s = await drain();
    expect(s.skipped).toBe(1);
    expect(h.persistScanReport).not.toHaveBeenCalled();
    expect(h.checkAndAlertRegression).not.toHaveBeenCalled();
    expect(h.refundScanCredit).toHaveBeenCalledWith("acme", true, { actor: "queue:webhook:push", repoFullName: "acme/api" });
    expect(h.recordScanOutcome).toHaveBeenCalledWith("acme", "acme/api", { ok: false, error: PUSH_DEGRADED_ERROR });
    expect(h.settleJob).toHaveBeenCalledWith("job_1", { state: "skipped", error: PUSH_DEGRADED_ERROR, creditRefunded: true });
    cadenceUntouched();
  });
});

describe("push job: credits", () => {
  it("a credit skip records the credit copy, settles skipped, and leaves the cadence alone", async () => {
    h.reserveScanCredit.mockResolvedValueOnce({ skip: true, reserved: false });
    const s = await drain();
    expect(s.skippedForCredits).toBe(1);
    expect(h.recordScanOutcome).toHaveBeenCalledWith("acme", "acme/api", { ok: false, error: "insufficient credits" });
    expect(h.settleJob).toHaveBeenCalledWith("job_1", { state: "skipped", error: "insufficient credits" });
    expect(h.scanRepository).not.toHaveBeenCalled();
    cadenceUntouched();
  });

  it("a requeued row that already holds a credit (creditCharged) does not reserve again", async () => {
    h.claimJobById.mockResolvedValueOnce(job({ creditCharged: true, attempts: 2 }));
    const s = await drain();
    expect(s.done).toBe(1);
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
    expect(h.scanRepository).toHaveBeenCalledTimes(1);
  });

  it("a BYOM org's push job is still metered: isMeteredScan(slug, false) decides, not the BYOM check", async () => {
    h.isByomActive.mockResolvedValue(true);
    await drain();
    expect(h.isMeteredScan).toHaveBeenCalledWith("acme", false);
    expect(h.reserveScanCredit).toHaveBeenCalledTimes(1);
  });

  it("an unmetered deployment (isMeteredScan false) reserves nothing and still scans", async () => {
    h.isMeteredScan.mockReturnValue(false);
    const s = await drain();
    expect(s.done).toBe(1);
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
  });
});

describe("push job: the failure backoff", () => {
  const failedAgo = (ms: number, error = "boom") => ({ status: "error", error, attemptAt: new Date(NOW - ms).toISOString() });

  it("a failure younger than 6 h skips: no reserve, no scan, NO outcome write", async () => {
    h.getLastScanAttempt.mockResolvedValueOnce(failedAgo(60 * 60_000));
    const s = await drain();
    expect(s.skipped).toBe(1);
    expect(h.settleJob).toHaveBeenCalledWith("job_1", { state: "skipped", error: "failure backoff" });
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
    expect(h.scanRepository).not.toHaveBeenCalled();
    expect(h.recordScanOutcome).not.toHaveBeenCalled();
    cadenceUntouched();
  });

  it("a failure older than 6 h scans", async () => {
    h.getLastScanAttempt.mockResolvedValueOnce(failedAgo(7 * 60 * 60_000));
    expect((await drain()).done).toBe(1);
  });

  it("a recent credit-skip error does NOT trigger the backoff (a topped-up org scans)", async () => {
    h.getLastScanAttempt.mockResolvedValueOnce(failedAgo(60_000, "insufficient credits"));
    const s = await drain();
    expect(s.done).toBe(1);
    expect(h.reserveScanCredit).toHaveBeenCalledTimes(1);
  });

  it("a failed backoff read is reported and fails toward scanning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.getLastScanAttempt.mockRejectedValueOnce(new Error("db blip"));
    const s = await drain();
    expect(s.done).toBe(1);
    expect(warn).toHaveBeenCalledWith("[degraded-read] queue-worker last-attempt read (push backoff) failed", "db blip");
    warn.mockRestore();
  });

  it("the backoff never applies to a cadence job", async () => {
    h.claimJobById.mockResolvedValueOnce(job({ reason: "cadence" }));
    h.getLastScanAttempt.mockResolvedValue(failedAgo(60_000));
    expect((await drain()).done).toBe(1);
    expect(h.getLastScanAttempt).not.toHaveBeenCalled();
  });
});

describe("push job: the regression baseline", () => {
  it("a failed baseline read is reported and the scan proceeds (persisted, alerted against no baseline)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.getScanReportByCommit.mockRejectedValueOnce(new Error("read timeout"));
    const s = await drain();
    expect(s.done).toBe(1);
    expect(warn).toHaveBeenCalledWith("[degraded-read] queue-worker previous-report read failed", "read timeout");
    expect(h.persistScanReport).toHaveBeenCalledTimes(1);
    expect(h.checkAndAlertRegression).toHaveBeenCalledWith(null, expect.anything(), expect.anything());
    warn.mockRestore();
  });
});

describe("a cadence job is unchanged by the push branch", () => {
  it("still settles its cadence on success, and is metered by the worker's own rule", async () => {
    h.claimJobById.mockResolvedValueOnce(job({ reason: "cadence" }));
    const s = await drain();
    expect(s.done).toBe(1);
    expect(h.getRepoSchedule).toHaveBeenCalledWith("repo_1");
    expect(h.advanceToFullCadence).toHaveBeenCalledWith("repo_1", "weekly");
    expect(h.isMeteredScan).not.toHaveBeenCalled();
    expect(h.reserveScanCredit).toHaveBeenCalledWith("acme", "acme/api", { actor: "queue:cadence" });
  });
});
