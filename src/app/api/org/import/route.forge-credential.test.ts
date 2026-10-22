// /api/org/import binds the scan credential per entry (src/lib/forge/scan-credential.ts).
//
// Before: one `scanOpts` for the whole batch, so a run that minted the org's GitHub App installation
// token handed it to every entry, `gitlab:` coordinates included, and GitLabSource sends it as
// `Authorization: Bearer` to gitlab.com. A non-GitHub entry now scans token-less with the ambient
// fallback refused; the GitHub entries keep the minted token.

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
vi.mock("@/lib/org/degraded-read", () => ({ noteReadFailure: vi.fn(), degradedRead: vi.fn((_read: string, fallback: unknown) => () => fallback) }));
vi.mock("@/lib/scan-alerts", () => ({ maybeAlertLowCredits: vi.fn(async () => {}) }));
vi.mock("@/lib/pool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pool")>();
  return { ...actual, SCAN_CONCURRENCY: 1, fleetDeadlineAt: vi.fn(() => Date.now() + 600_000) };
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
  getInstallationIdForOwner: vi.fn(async () => 1),
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
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn(async () => "ghs_install"), isAppConfigured: () => true }));
vi.mock("@/lib/github/list", () => ({
  listOrgRepos: vi.fn(async () => ({ repos: [], truncated: false })),
  isValidHandle: () => true,
  isValidRepoName: () => true,
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => true) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => false), getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  canMintInstallationToken: vi.fn(async () => true),
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
import { consumeScanCredit } from "@/lib/db";
import { authGateEnabled } from "@/lib/access";

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
  const res = await POST(new Request("http://localhost/api/org/import", { method: "POST", body: JSON.stringify(body) }));
  return res.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  q.rows.length = 0;
  vi.mocked(scanRepository).mockResolvedValue(realReport);
  vi.mocked(consumeScanCredit).mockResolvedValue({ ok: true, balance: 9, unlimited: false, charged: true } as never);
  vi.mocked(authGateEnabled).mockReturnValue(false);
});

const optsFor = (repo: string) => vi.mocked(scanRepository).mock.calls.find((c) => c[0] === repo)?.[1];

describe("POST /api/org/import: the minted GitHub token rides GitHub entries only", () => {
  it("a gitlab entry scans token-less with the ambient fallback refused; the GitHub entry keeps the minted token", async () => {
    await collect({ org: "acme", repos: ["gitlab:group/proj", "acme/api"], mock: false, watch: false });
    expect(vi.mocked(scanRepository)).toHaveBeenCalledTimes(2);
    const gl = optsFor("gitlab:group/proj");
    expect(gl?.token).toBeUndefined();
    expect(gl?.noAmbientToken).toBe(true);
    expect(optsFor("acme/api")?.token).toBe("ghs_install");
  });

  it("guard: an all-GitHub batch is unchanged (one minted token for every entry)", async () => {
    await collect({ org: "acme", repos: ["acme/a", "acme/b"], mock: false, watch: false });
    expect(optsFor("acme/a")).toMatchObject({ token: "ghs_install", orgSlug: "acme" });
    expect(optsFor("acme/b")).toMatchObject({ token: "ghs_install", orgSlug: "acme" });
  });
});
