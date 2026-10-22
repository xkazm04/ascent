// The import HEAD (the repos this request scans inline) runs the same post-scan consequences as the
// worker that scans its queued tail, through src/lib/scan-consequences.ts. Before 2026-10-22 one
// import alerted, reconciled and fed memory for the repos its 300s budget did NOT reach, and for none
// of the ones it did. Pinned here:
//
//   - A new row reads the regression baseline BEFORE persisting, then alerts and reconciles.
//   - A scan that degraded to the mock floor (mock:false requested) is not persisted, its `repo`
//     frame carries `error` (not a level), its job does not settle `done`, and the credit refund is
//     the one it always was.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanReport } from "@/lib/types";

const h = vi.hoisted(() => ({
  scanRepository: vi.fn(),
  persistScanReport: vi.fn(),
  getScanReportByCommit: vi.fn(),
  grantCredits: vi.fn(),
  consumeScanCredit: vi.fn(),
  settleJob: vi.fn(),
  checkAndAlertRegression: vi.fn(),
  reconcilePracticeAdoption: vi.fn(),
  recordScanMemories: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: h.scanRepository }));
vi.mock("@/lib/scan-alerts", () => ({
  maybeAlertLowCredits: vi.fn(async () => {}),
  checkAndAlertRegression: h.checkAndAlertRegression,
}));
vi.mock("@/lib/db/practice-adoption", () => ({ reconcilePracticeAdoption: h.reconcilePracticeAdoption }));
vi.mock("@/lib/memory/scan-feed", () => ({ recordScanMemories: h.recordScanMemories }));
vi.mock("@/lib/db/forge-installations", () => ({ getForgeInstallation: vi.fn(async () => null), hostFromBase: vi.fn() }));
let claimCounter = 0;
vi.mock("@/lib/db/scan-jobs", () => ({
  JOB_PRIORITY: { manual: 10, webhook: 5, cadence: 0 },
  enqueueScanJob: vi.fn(async (i: { repoFullName: string }) => ({ id: `job_${++claimCounter}`, created: true, repo: i.repoFullName })),
  claimJobById: vi.fn(async (id: string) => ({ id, repoFullName: "", creditCharged: false })),
  listJobsForRun: vi.fn(async () => []),
  markJobCredit: vi.fn(async () => {}),
  settleJob: h.settleJob,
}));
vi.mock("@/lib/db", () => ({
  CREDIT_REASON: { SCAN: "scan", GRANT: "grant", ADJUSTMENT: "adjustment", REFUND: "refund", POLAR_REFUND: "polar-refund" },
  consumeScanCredit: h.consumeScanCredit,
  getInstallationIdForOwner: vi.fn(async () => 42),
  getOrgId: vi.fn(async () => "org_1"),
  getScanReportByCommit: h.getScanReportByCommit,
  grantCredits: h.grantCredits,
  isByomActive: vi.fn(async () => false),
  isDbConfigured: () => true,
  persistScanReport: h.persistScanReport,
  persistTeamStandings: vi.fn(async () => false),
  reconcileListedRepos: vi.fn(async () => ({ marked: 0, cleared: 0 })),
  recordQuotaEvent: vi.fn(async () => {}),
  recordScanOutcome: vi.fn(async () => {}),
  setRepoSchedule: vi.fn(async () => {}),
  setRepoWatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/app", () => ({
  getInstallationToken: vi.fn(async () => "app-installation-token"),
  isAppConfigured: () => true,
}));
vi.mock("@/lib/github/list", () => ({
  listOrgRepos: vi.fn(async () => ({ repos: [], truncated: false })),
  isValidHandle: (s: string) => /^[A-Za-z0-9-]+$/.test(s),
  isValidRepoName: (s: string) => /^[A-Za-z0-9._-]+$/.test(s),
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => true) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => false), getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  // The token IS minted: a member importing their own org through the installed App.
  canMintInstallationToken: vi.fn(async () => true),
  requireFleetOrg: vi.fn(async () => null),
}));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 })),
  paymentRequired: vi.fn(),
  orgNotFound: vi.fn(),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    rateLimitRequest: () => ({ ok: true }),
    rateLimitRequestShared: vi.fn(async () => ({ ok: true })),
    tooManyRequests: actual.tooManyRequests,
    ORG_IMPORT_RATE_LIMIT: {},
  };
});
vi.mock("@/lib/public-scan-quota", () => ({
  peekPublicScanQuota: vi.fn(async () => ({ enforced: false, remaining: 5, limit: 5, resetAt: null, scope: "anon" })),
  consumePublicScanQuota: vi.fn(async () => ({ enforced: false, allowed: true, remaining: 5, retryAfterSec: 0, resetAt: null, signedIn: false, chargedAt: null })),
  refundPublicScanQuota: vi.fn(async () => {}),
}));

import { POST } from "./route";

const report = (provider: string) =>
  ({
    engine: { provider, model: "m" },
    repo: { owner: "acme", name: "api", headSha: "sha_new" },
    practiceShape: { v: 2, artifacts: [] },
    confidence: 0.9,
    level: { id: "l3" },
    posture: { id: "balanced" },
    overallScore: 62,
    adoptionScore: 50,
    rigorScore: 50,
    contributors: [],
  }) as unknown as ScanReport;
const PREV = { overallScore: 80 } as unknown as ScanReport;

async function collect(): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const res = await POST(
    new Request("http://localhost/api/org/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: "acme", repos: ["acme/api"], mock: false, watch: false }),
    }),
  );
  const events: { event: string; data: Record<string, unknown> }[] = [];
  for (const frame of (await res.text()).split("\n\n")) {
    const ev = frame.match(/^event: (.+)$/m)?.[1];
    const data = frame.match(/^data: (.+)$/m)?.[1];
    if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
  }
  return events;
}

const savedToken = process.env.GITHUB_TOKEN;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = "operator-pat";
  h.consumeScanCredit.mockResolvedValue({ ok: true, balance: 4, unlimited: false, charged: true });
  h.grantCredits.mockResolvedValue(0);
  h.getScanReportByCommit.mockResolvedValue(PREV);
  h.persistScanReport.mockResolvedValue({ deduped: false });
  h.checkAndAlertRegression.mockResolvedValue({ regressed: false, verdict: null });
  h.reconcilePracticeAdoption.mockResolvedValue(null);
  h.recordScanMemories.mockResolvedValue(undefined);
  h.settleJob.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.env.GITHUB_TOKEN = savedToken;
});

describe("POST /api/org/import - the scanned head runs the post-scan consequences", () => {
  it("reads the baseline BEFORE persisting, then alerts and reconciles the new row", async () => {
    const r = report("anthropic");
    h.scanRepository.mockResolvedValue(r);
    await collect();
    expect(h.getScanReportByCommit).toHaveBeenCalledWith("acme", "api", { orgSlug: "acme" });
    expect(h.getScanReportByCommit.mock.invocationCallOrder[0]!).toBeLessThan(h.persistScanReport.mock.invocationCallOrder[0]!);
    expect(h.checkAndAlertRegression).toHaveBeenCalledWith(PREV, r, { orgId: "org_1", orgSlug: "acme" });
    expect(h.reconcilePracticeAdoption).toHaveBeenCalledWith("org_1", "acme/api", "sha_new", r.practiceShape);
    expect(h.recordScanMemories).toHaveBeenCalledTimes(1);
  });

  it("a scan that degraded to mock is not persisted, reports an error frame and does not settle done", async () => {
    h.scanRepository.mockResolvedValue(report("mock"));
    const events = await collect();
    expect(h.persistScanReport).not.toHaveBeenCalled();
    expect(h.checkAndAlertRegression).not.toHaveBeenCalled();
    const frame = events.find((e) => e.event === "repo")!.data;
    expect(frame).toMatchObject({ repo: "acme/api", charged: false });
    expect(typeof frame.error).toBe("string");
    expect(String(frame.error)).not.toContain(String.fromCharCode(0x2014));
    expect(frame.level).toBeUndefined();
    const outcome = h.settleJob.mock.calls.at(-1)![1] as { state: string };
    expect(outcome.state).not.toBe("done");
  });

  it("credit handling is unchanged: the degraded scan's reserved credit is refunded once", async () => {
    h.scanRepository.mockResolvedValue(report("mock"));
    await collect();
    expect(h.grantCredits).toHaveBeenCalledTimes(1);
    expect(h.grantCredits).toHaveBeenCalledWith("acme", 1, expect.objectContaining({ reason: "refund", repoFullName: "acme/api" }));
  });
});
