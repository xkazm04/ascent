// The queue worker never mints a GitHub credential for a non-GitHub row (src/lib/forge/scan-credential.ts).
//
// Before: `scanCredential` returned `{ token: await ctx.token(slug) }` for every non-import row, so a
// watched `gitlab:` repo was rescanned on cadence with the org's GitHub App installation token, which
// GitLabSource sends as `Authorization: Bearer` to gitlab.com. The job's forge comes from its persisted
// fullName; a non-GitHub row scans token-less and refuses the ambient fallback, without minting.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { importJobReason } from "./scan-import-policy";

const h = vi.hoisted(() => ({
  scanRepository: vi.fn(),
  claimJob: vi.fn(),
  settleJob: vi.fn(),
  reserveScanCredit: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
  getInstallationToken: vi.fn(),
}));

vi.mock("@/lib/scan", () => ({ scanRepository: h.scanRepository }));
vi.mock("@/lib/db", () => ({
  advanceScheduleAfterFailure: vi.fn(async () => {}),
  advanceToFullCadence: vi.fn(async () => {}),
  getInstallationIdForOwner: h.getInstallationIdForOwner,
  getLastScanAttempt: vi.fn(async () => null),
  getOrgId: vi.fn(async () => "org_1"),
  getScanReportByCommit: vi.fn(async () => null),
  inFailureBackoff: () => false,
  isByomActive: vi.fn(async () => false),
  persistScanReport: vi.fn(async () => ({ deduped: false })),
  recordScanOutcome: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/scan-jobs", () => ({
  claimJob: h.claimJob,
  claimJobById: vi.fn(),
  markJobCredit: vi.fn(async () => {}),
  reapExpiredLeases: vi.fn(async () => 0),
  settleJob: h.settleJob,
}));
vi.mock("@/lib/db/org-watch", () => ({ getRepoSchedule: vi.fn(async () => null) }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: h.getInstallationToken }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: vi.fn(async () => {}) }));
vi.mock("@/lib/scan-credit", () => ({
  refundScanCredit: vi.fn(async () => {}),
  reserveScanCredit: h.reserveScanCredit,
  shouldRefundScan: () => false,
}));
vi.mock("@/lib/scan-probe", () => ({ probeRepository: vi.fn() }));

import { drainLane } from "./scan-queue-worker";

const job = (over: Record<string, unknown> = {}) => ({
  id: "job_1",
  orgId: "org_1",
  repoId: null,
  repoFullName: "gitlab:group/proj",
  lane: "rescore",
  reason: "cadence",
  state: "claimed",
  priority: 10,
  runId: null,
  idempotencyKey: "k",
  notBefore: "2026-10-22T00:00:00.000Z",
  claimedAt: "2026-10-22T00:00:00.000Z",
  claimedBy: "cron",
  leaseUntil: "2026-10-22T00:15:00.000Z",
  attempts: 1,
  creditCharged: false,
  resultJson: null,
  error: null,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  settledAt: null,
  ...over,
});

const report = { repo: { owner: "group", name: "proj" }, engine: { provider: "sonnet" }, level: { id: "managed" }, overallScore: 71, posture: { id: "steady" }, adoptionScore: 60, rigorScore: 80 };

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.settleJob.mockResolvedValue(undefined);
  h.getInstallationIdForOwner.mockResolvedValue(1);
  h.getInstallationToken.mockResolvedValue("ghs_install");
  h.reserveScanCredit.mockResolvedValue({ skip: false, reserved: true });
  h.scanRepository.mockResolvedValue(report);
});

async function cronDrains(row: ReturnType<typeof job>) {
  h.claimJob.mockResolvedValueOnce(row).mockResolvedValue(null);
  return drainLane("rescore", { concurrency: 1, deadlineAt: Date.now() + 600_000, orgSlug: "acme" });
}

describe("the rescore worker binds its credential to the job's forge", () => {
  it("a watched gitlab row (no import policy) mints nothing and scans token-less with the ambient fallback refused", async () => {
    const out = await cronDrains(job());
    expect(out.done).toBe(1);
    expect(h.getInstallationIdForOwner).not.toHaveBeenCalled();
    expect(h.getInstallationToken).not.toHaveBeenCalled();
    const opts = h.scanRepository.mock.calls[0]![1];
    expect(opts.token).toBeUndefined();
    expect(opts.noAmbientToken).toBe(true);
  });

  it("a gitlab row is not skipped as a broken installation it never used", async () => {
    h.getInstallationToken.mockResolvedValue(undefined);
    const out = await cronDrains(job());
    expect(out.skippedNoToken).toBe(0);
    expect(h.scanRepository).toHaveBeenCalledTimes(1);
  });

  it("an installation-token IMPORT row for a gitlab coordinate does not mint either", async () => {
    await cronDrains(job({ reason: importJobReason({ token: "install", mock: false, funnel: false }) }));
    expect(h.getInstallationToken).not.toHaveBeenCalled();
    const opts = h.scanRepository.mock.calls[0]![1];
    expect(opts.token).toBeUndefined();
    expect(opts.noAmbientToken).toBe(true);
  });

  it("guard: a GitHub row still scans with the org's installation token", async () => {
    await cronDrains(job({ repoFullName: "acme/api" }));
    expect(h.scanRepository.mock.calls[0]![1]).toMatchObject({ token: "ghs_install" });
  });
});
