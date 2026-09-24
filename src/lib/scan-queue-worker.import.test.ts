// The background worker finishing an IMPORT's tail (backlog develop-2026-09-17 row 26).
//
// /api/org/import now enqueues its whole batch first and leaves what its 300s budget did not reach as
// queued rows. The cron's drainLane("rescore") then runs those rows, so it must scan them exactly as
// the import would have: the same credential, the same free-vs-paid decision, and exactly ONE credit
// per imported repo across a kill + requeue. Each case below names what the default rescore path
// would have done instead.

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
  getInstallationIdForOwner: vi.fn(),
  getInstallationToken: vi.fn(),
  persistScanReport: vi.fn(),
}));

vi.mock("@/lib/scan", () => ({ scanRepository: h.scanRepository }));
vi.mock("@/lib/db", () => ({
  advanceScheduleAfterFailure: vi.fn(async () => {}),
  advanceToFullCadence: vi.fn(async () => {}),
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
vi.mock("@/lib/db/org-watch", () => ({ getRepoSchedule: vi.fn(async () => null) }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: h.getInstallationToken }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: vi.fn(async () => {}) }));
vi.mock("@/lib/scan-credit", () => ({
  refundScanCredit: h.refundScanCredit,
  reserveScanCredit: h.reserveScanCredit,
  shouldRefundScan: (r: { engine: { provider: string } }, p: { deduped: boolean } | null) =>
    r.engine.provider === "mock" || Boolean(p?.deduped),
}));
vi.mock("@/lib/scan-probe", () => ({ probeRepository: vi.fn() }));

import { drainLane } from "./scan-queue-worker";
import { importJobReason } from "./scan-import-policy";

const job = (over: Record<string, unknown> = {}) => ({
  id: "job_1",
  orgId: "org_1",
  repoId: null,
  repoFullName: "acme/api",
  lane: "rescore",
  reason: importJobReason({ token: "install", mock: false, funnel: false }),
  state: "claimed",
  priority: 10,
  runId: "run_1",
  idempotencyKey: "k",
  notBefore: "2026-09-24T00:00:00.000Z",
  claimedAt: "2026-09-24T00:00:00.000Z",
  claimedBy: "cron",
  leaseUntil: "2026-09-24T00:15:00.000Z",
  attempts: 1,
  creditCharged: false,
  resultJson: null,
  error: null,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
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
  h.markJobCredit.mockResolvedValue(undefined);
  h.scanRepository.mockResolvedValue(report());
});

/** The cron's shape: an unscoped drain of the whole lane, one queued row, then an empty lane. */
async function cronDrains(row: ReturnType<typeof job>) {
  h.claimJob.mockResolvedValueOnce(row).mockResolvedValue(null);
  return drainLane("rescore", { concurrency: 1, deadlineAt: Date.now() + 600_000, orgSlug: "acme" });
}

describe("the worker scans an import's tail under the import's own policy", () => {
  it("a MOCK import's queued repo stays free: mock scan, no credit reserved", async () => {
    // Default path: real inference plus a reserved credit, for a run the user asked to be a preview.
    h.scanRepository.mockResolvedValue(report("mock"));
    const out = await cronDrains(job({ reason: importJobReason({ token: "install", mock: true, funnel: false }) }));
    expect(out.done).toBe(1);
    expect(h.scanRepository.mock.calls[0]![1]).toMatchObject({ mock: true });
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
    expect(h.markJobCredit).not.toHaveBeenCalled();
  });

  it("a TOKEN-LESS import's queued repo never falls back to the ambient PAT", async () => {
    // Default path: `token: undefined` without noAmbientToken, which scanRepository resolves to
    // process.env.GITHUB_TOKEN: the confused deputy the import route closes for anonymous callers.
    await cronDrains(job({ reason: importJobReason({ token: "none", mock: true, funnel: false }) }));
    const opts = h.scanRepository.mock.calls[0]![1];
    expect(opts.token).toBeUndefined();
    expect(opts.noAmbientToken).toBe(true);
  });

  it("a token-less import is not skipped as a broken installation (it never used one)", async () => {
    h.getInstallationToken.mockResolvedValue(undefined);
    const out = await cronDrains(job({ reason: importJobReason({ token: "none", mock: true, funnel: false }) }));
    expect(out.skippedNoToken).toBe(0);
    expect(h.scanRepository).toHaveBeenCalledTimes(1);
  });

  it("an installation-token import scans with the org's token and reserves ONE credit", async () => {
    const out = await cronDrains(job());
    expect(out.done).toBe(1);
    expect(h.scanRepository.mock.calls[0]![1]).toMatchObject({ token: "tok" });
    expect(h.reserveScanCredit).toHaveBeenCalledTimes(1);
    expect(h.reserveScanCredit).toHaveBeenCalledWith("acme", "acme/api", { actor: "queue:import" });
    expect(h.markJobCredit).toHaveBeenCalledWith("job_1", true);
  });

  it("an auth-off (ambient) import scans with the env token, as the seeding path did", async () => {
    await cronDrains(job({ reason: importJobReason({ token: "ambient", mock: false, funnel: false }) }));
    const opts = h.scanRepository.mock.calls[0]![1];
    expect(opts.token).toBeUndefined();
    expect(opts.noAmbientToken).toBeUndefined();
  });

  it("a PUBLIC-FUNNEL import cannot be finished off-request: skipped, never scanned or billed", async () => {
    // The allowance is metered per request; the default path would scan unmetered or bill credits.
    const out = await cronDrains(job({ reason: importJobReason({ token: "none", mock: false, funnel: true }) }));
    expect(h.scanRepository).not.toHaveBeenCalled();
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
    expect(out.skipped).toBe(1);
    expect(h.settleJob).toHaveBeenCalledWith("job_1", expect.objectContaining({ state: "skipped" }));
  });
});

describe("one imported repo reserves exactly one credit, across a kill and a requeue", () => {
  it("guard: the route reserved and was killed; the cron's retry carries the row's credit", async () => {
    // What a 300s kill + reapExpiredLeases leaves: queued again, creditCharged still true (the route
    // stamps it before inference). The cron claims it through the unscoped lane, not by id.
    const out = await cronDrains(job({ creditCharged: true, attempts: 2 }));
    expect(out.done).toBe(1);
    expect(h.reserveScanCredit).not.toHaveBeenCalled();
    expect(h.markJobCredit).not.toHaveBeenCalled();
  });

  it("guard: a worker killed after ITS reservation is not charged again by the next worker", async () => {
    // First worker: reserves, stamps the row, then "dies" inside inference (the scan never returns
    // to settle). Its stamp is the only thing that survives.
    let stamped = false;
    h.markJobCredit.mockImplementation(async (_id: string, v: boolean) => {
      stamped = v;
    });
    h.scanRepository.mockImplementationOnce(() => new Promise(() => {}));
    void cronDrains(job());
    await vi.waitFor(() => expect(stamped).toBe(true));

    // Second worker, after the reaper: the row as the DB now holds it.
    h.claimJob.mockReset();
    h.scanRepository.mockResolvedValue(report());
    const retry = await cronDrains(job({ creditCharged: stamped, attempts: 2 }));
    expect(retry.done).toBe(1);
    expect(h.reserveScanCredit).toHaveBeenCalledTimes(1);
  });
});
