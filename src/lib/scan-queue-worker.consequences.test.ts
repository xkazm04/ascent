// The fleet worker runs the SAME post-scan consequences the interactive scan does
// (src/lib/scan-consequences.ts). What is pinned:
//
//   - A NEW CADENCE ROW feeds the adoption ledger and org memory, not only the alert.
//   - THE DEGRADE GUARD IS GENERAL: a cadence scan that came back as the mock floor (not requested)
//     is not persisted or alerted, records a failed outcome, settles `skipped` and backs the cadence
//     off (6h failure backoff) instead of taking the full slot. The credit refund is UNCHANGED.
//   - A REQUESTED mock (a preview import's tail) still persists.
//   - A throwing ledger reconcile leaves the job `done`.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  scanRepository: vi.fn(),
  claimJobById: vi.fn(),
  settleJob: vi.fn(),
  reserveScanCredit: vi.fn(),
  refundScanCredit: vi.fn(),
  persistScanReport: vi.fn(),
  getScanReportByCommit: vi.fn(),
  advanceToFullCadence: vi.fn(),
  advanceScheduleAfterFailure: vi.fn(),
  recordScanOutcome: vi.fn(),
  checkAndAlertRegression: vi.fn(),
  reconcilePracticeAdoption: vi.fn(),
  recordScanMemories: vi.fn(),
}));

vi.mock("@/lib/scan", () => ({ scanRepository: h.scanRepository }));
vi.mock("@/lib/db", () => ({
  advanceScheduleAfterFailure: h.advanceScheduleAfterFailure,
  advanceToFullCadence: h.advanceToFullCadence,
  getInstallationIdForOwner: vi.fn(async () => 1),
  getOrgId: vi.fn(async () => "org_1"),
  getScanReportByCommit: h.getScanReportByCommit,
  isByomActive: vi.fn(async () => false),
  persistScanReport: h.persistScanReport,
  recordScanOutcome: h.recordScanOutcome,
}));
vi.mock("@/lib/db/scan-jobs", () => ({
  claimJob: vi.fn(async () => null),
  claimJobById: h.claimJobById,
  markJobCredit: vi.fn(async () => {}),
  reapExpiredLeases: vi.fn(async () => 0),
  settleJob: h.settleJob,
}));
vi.mock("@/lib/db/org-watch", () => ({ getRepoSchedule: vi.fn(async () => "weekly") }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: h.checkAndAlertRegression }));
vi.mock("@/lib/db/practice-adoption", () => ({ reconcilePracticeAdoption: h.reconcilePracticeAdoption }));
vi.mock("@/lib/memory/scan-feed", () => ({ recordScanMemories: h.recordScanMemories }));
vi.mock("@/lib/scan-credit", async () => {
  // The REAL refund rule, so the "credit behaviour is unchanged" guard pins the policy, not a stub.
  const { shouldRefundScan } = await vi.importActual<typeof import("@/lib/scan-credit")>("@/lib/scan-credit");
  return { refundScanCredit: h.refundScanCredit, reserveScanCredit: h.reserveScanCredit, shouldRefundScan };
});
vi.mock("@/lib/scan-probe", () => ({ probeRepository: vi.fn() }));

import { drainLane, PUSH_DEGRADED_ERROR } from "./scan-queue-worker";
import { importJobReason } from "./scan-import-policy";

const job = (over: Record<string, unknown> = {}) => ({
  id: "job_1",
  orgId: "org_1",
  repoId: "repo_1",
  repoFullName: "acme/api",
  lane: "rescore",
  reason: "cadence",
  state: "claimed",
  creditCharged: false,
  ...over,
});

const report = (provider = "sonnet") => ({
  engine: { provider },
  repo: { owner: "acme", name: "api", headSha: "sha_new" },
  practiceShape: { v: 2, artifacts: [] },
  confidence: 0.9,
  level: { id: "managed" },
  overallScore: 71,
  posture: { id: "steady" },
  adoptionScore: 60,
  rigorScore: 80,
});
const PREV = { overallScore: 80 };
const OUTCOME = { regressed: true, verdict: null };

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.claimJobById.mockResolvedValue(job());
  h.settleJob.mockResolvedValue(undefined);
  h.reserveScanCredit.mockResolvedValue({ skip: false, reserved: true });
  h.refundScanCredit.mockResolvedValue({ refunded: true, balance: 5 });
  h.persistScanReport.mockResolvedValue({ deduped: false });
  h.getScanReportByCommit.mockResolvedValue(PREV);
  h.advanceToFullCadence.mockResolvedValue(undefined);
  h.advanceScheduleAfterFailure.mockResolvedValue(undefined);
  h.recordScanOutcome.mockResolvedValue(undefined);
  h.checkAndAlertRegression.mockResolvedValue(OUTCOME);
  h.reconcilePracticeAdoption.mockResolvedValue(null);
  h.recordScanMemories.mockResolvedValue(undefined);
  h.scanRepository.mockResolvedValue(report());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const drain = () =>
  drainLane("rescore", { concurrency: 1, deadlineAt: Date.now() + 600_000, orgSlug: "acme", jobs: [{ id: "job_1", repo: "acme/api" }] });

describe("a cadence rescore runs the full consequence set", () => {
  it("a NEW live row reconciles the adoption ledger and feeds org memory with the alert's outcome", async () => {
    const r = report();
    h.scanRepository.mockResolvedValue(r);
    await drain();
    expect(h.reconcilePracticeAdoption).toHaveBeenCalledTimes(1);
    expect(h.reconcilePracticeAdoption).toHaveBeenCalledWith("org_1", "acme/api", "sha_new", r.practiceShape);
    expect(h.checkAndAlertRegression).toHaveBeenCalledTimes(1);
    expect(h.recordScanMemories).toHaveBeenCalledTimes(1);
    expect(h.recordScanMemories).toHaveBeenCalledWith("org_1", PREV, r, OUTCOME);
  });

  it("a throwing reconcile still alerts, still feeds memory, and the job still settles done", async () => {
    h.reconcilePracticeAdoption.mockRejectedValue(new Error("ledger down"));
    const s = await drain();
    expect(h.checkAndAlertRegression).toHaveBeenCalledTimes(1);
    expect(h.recordScanMemories).toHaveBeenCalledTimes(1);
    expect(h.settleJob.mock.calls[0]![1]).toMatchObject({ state: "done" });
    expect(s.done).toBe(1);
  });
});

describe("the degrade-to-mock guard holds for every reason, not just push", () => {
  it("a cadence scan that degraded to mock is not persisted or alerted and backs off instead of taking the slot", async () => {
    h.scanRepository.mockResolvedValue(report("mock"));
    const s = await drain();
    expect(h.persistScanReport).not.toHaveBeenCalled();
    expect(h.checkAndAlertRegression).not.toHaveBeenCalled();
    expect(h.recordScanOutcome).toHaveBeenCalledWith("acme", "acme/api", { ok: false, error: PUSH_DEGRADED_ERROR });
    expect(h.settleJob.mock.calls[0]![1]).toMatchObject({ state: "skipped", error: PUSH_DEGRADED_ERROR });
    expect(h.advanceScheduleAfterFailure).toHaveBeenCalledWith("repo_1");
    expect(h.advanceToFullCadence).not.toHaveBeenCalled();
    expect(s.skipped).toBe(1);
  });

  it("credit handling is unchanged: the degraded cadence scan refunds exactly once, as before", async () => {
    h.scanRepository.mockResolvedValue(report("mock"));
    await drain();
    expect(h.refundScanCredit).toHaveBeenCalledTimes(1);
    expect(h.refundScanCredit).toHaveBeenCalledWith("acme", true, { actor: "queue:cadence", repoFullName: "acme/api" });
    expect(h.settleJob.mock.calls[0]![1]).toMatchObject({ creditRefunded: true });
  });

  it("a mock-REQUESTED import row still persists (free preview path unchanged)", async () => {
    h.claimJobById.mockResolvedValue(job({ reason: importJobReason({ token: "install", mock: true, funnel: false }) }));
    h.scanRepository.mockResolvedValue(report("mock"));
    await drain();
    expect(h.persistScanReport).toHaveBeenCalledTimes(1);
    expect(h.settleJob.mock.calls[0]![1]).toMatchObject({ state: "done" });
  });
});
