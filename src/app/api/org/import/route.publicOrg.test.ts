// The shared "public" org is the wizard's landing place for a signed-in user who scans a public
// organization they do not own (operator decision, ask d0eb7d6c, 2026-10-07). Pinned here:
//   - a REAL import into "public" needs a signed-in viewer (401 before anything is listed or scanned);
//   - it is ALWAYS charged to that viewer's own public-scan allowance - never unmetered, never a
//     credit of any org - whether or not the body sets publicFunnel;
//   - it is capped at 10 repos per request (400 naming the cap; the listing mode is capped to 10);
//   - mock imports, tenant orgs and auth-off deployments are untouched, except that the public org takes
//     no autoscan cadence (nobody is charged for it): the schedule defaults to 'off', an explicit cadence
//     is a 400, and nothing calls setRepoSchedule - real or mock, head or tail.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/scan-credit", () => ({
  reserveScanCredit: vi.fn(async () => ({ skip: false, reserved: false })),
  refundScanCredit: vi.fn(async () => {}),
  shouldRefundScan: () => false,
}));
vi.mock("@/lib/db/forge-installations", () => ({
  getForgeInstallation: vi.fn(async () => null),
  hostFromBase: (base: string) => ({ apiBase: base, webBase: base }),
}));
vi.mock("@/lib/db/scan-jobs", () => ({
  JOB_PRIORITY: { manual: 10, webhook: 5, cadence: 0 },
  enqueueScanJob: vi.fn(async (i: { repoFullName: string }) => ({ id: `job_${i.repoFullName}`, created: true })),
  claimJobById: vi.fn(async (id: string) => ({ id, repoFullName: "", creditCharged: false })),
  listJobsForRun: vi.fn(async () => []),
  markJobCredit: vi.fn(async () => {}),
  settleJob: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => null),
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
  isValidHandle: (s: string) => /^[A-Za-z0-9-]+$/.test(s),
  isValidRepoName: (s: string) => /^[A-Za-z0-9._-]+$/.test(s),
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => true) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => true), getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null), // "public" is open to everyone, exactly as authz.ts answers
  canMintInstallationToken: vi.fn(async () => false),
  requireFleetOrg: vi.fn(async () => null),
}));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: true, balance: 0 })),
  paymentRequired: vi.fn(),
  orgNotFound: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequestShared: vi.fn(async () => ({ ok: true })),
  tooManyRequests: vi.fn(),
  ORG_IMPORT_RATE_LIMIT: {},
}));
vi.mock("@/lib/public-scan-quota", () => ({
  peekPublicScanQuota: vi.fn(async () => ({ enforced: false, remaining: 50, limit: 50, resetAt: null, scope: "user" })),
  consumePublicScanQuota: vi.fn(async () => ({
    enforced: true,
    allowed: true,
    remaining: 49,
    retryAfterSec: 0,
    resetAt: null,
    signedIn: true,
    chargedAt: 1,
  })),
  refundPublicScanQuota: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { authGateEnabled, getViewer } from "@/lib/access";
import { isAuthConfigured } from "@/lib/auth";
import { listOrgRepos } from "@/lib/github/list";
import { checkScanEntitlement } from "@/lib/entitlement";
import { reserveScanCredit } from "@/lib/scan-credit";
import { enqueueScanJob } from "@/lib/db/scan-jobs";
import { consumePublicScanQuota } from "@/lib/public-scan-quota";
import { setRepoSchedule, setRepoWatch } from "@/lib/db";

const realReport = {
  engine: { provider: "anthropic", model: "m" },
  level: { id: "l2" },
  posture: { id: "balanced" },
  overallScore: 50,
  adoptionScore: 50,
  rigorScore: 50,
  contributors: [],
} as unknown as ScanReport;

const viewer = { id: "u-1", login: "alice" } as never;
const names = (n: number) => Array.from({ length: n }, (_, i) => `facebook/r${i}`);

async function post(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/org/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { res, text };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scanRepository).mockResolvedValue(realReport);
  vi.mocked(authGateEnabled).mockReturnValue(true);
  vi.mocked(isAuthConfigured).mockReturnValue(true);
  vi.mocked(getViewer).mockResolvedValue(null);
});

describe("POST /api/org/import - real import into the shared public org", () => {
  it("401s a signed-out caller before anything is listed, enqueued or scanned", async () => {
    const { res, text } = await post({ org: "public", repos: names(2), mock: false, watch: false, publicFunnel: true });
    expect(res.status).toBe(401);
    expect(text).toContain("Sign in to scan a public organization.");
    expect(listOrgRepos).not.toHaveBeenCalled();
    expect(enqueueScanJob).not.toHaveBeenCalled();
    expect(scanRepository).not.toHaveBeenCalled();
  });

  it("charges a signed-in caller's own allowance even when the body omits publicFunnel, and moves no credit", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    const { res } = await post({ org: "public", repos: names(2), mock: false, watch: false });
    expect(res.status).toBe(200);
    expect(scanRepository).toHaveBeenCalledTimes(2);
    expect(vi.mocked(scanRepository).mock.calls[0][1]).toMatchObject({ mock: false, noAmbientToken: true });
    expect(consumePublicScanQuota).toHaveBeenCalledTimes(2);
    expect(vi.mocked(consumePublicScanQuota).mock.calls[0][1]).toEqual({ viewerId: "u-1" });
    expect(checkScanEntitlement).not.toHaveBeenCalled();
    expect(reserveScanCredit).not.toHaveBeenCalled();
  });

  it("400s more than 10 repos and names the cap", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    const { res, text } = await post({ org: "public", repos: names(11), mock: false, watch: false });
    expect(res.status).toBe(400);
    expect(text).toMatch(/10/);
    expect(scanRepository).not.toHaveBeenCalled();
  });

  it("accepts exactly 10 repos", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    const { res } = await post({ org: "public", repos: names(10), mock: false, watch: false });
    expect(res.status).toBe(200);
    expect(scanRepository).toHaveBeenCalledTimes(10);
  });

  it("caps the listing mode (no repos[]) at 10", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    await post({ org: "public", count: 50, mock: false, watch: false });
    expect(vi.mocked(listOrgRepos).mock.calls[0][1]).toBe(10);
  });

  it("leaves a MOCK import into public alone (no sign-in, no cap)", async () => {
    const { res } = await post({ org: "public", repos: names(11), mock: true, watch: false });
    expect(res.status).toBe(200);
    expect(scanRepository).toHaveBeenCalledTimes(11);
  });

  it("writes no schedule for a real public import that names none (default off, watch kept)", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    const { res } = await post({ org: "public", repos: names(2), mock: false, watch: true });
    expect(res.status).toBe(200);
    expect(setRepoWatch).toHaveBeenCalledTimes(2);
    expect(setRepoSchedule).not.toHaveBeenCalled();
  });

  it("400s an explicit cadence into public, naming the rule, before any scan", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    const { res, text } = await post({ org: "public", repos: names(2), mock: false, watch: true, schedule: "weekly" });
    expect(res.status).toBe(400);
    expect(text).toMatch(/no autoscan cadence.*nobody is charged/i);
    expect(listOrgRepos).not.toHaveBeenCalled();
    expect(enqueueScanJob).not.toHaveBeenCalled();
    expect(scanRepository).not.toHaveBeenCalled();
    expect(setRepoSchedule).not.toHaveBeenCalled();
  });

  it("accepts schedule 'off' explicitly", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    expect((await post({ org: "public", repos: names(1), mock: false, schedule: "off" })).res.status).toBe(200);
  });

  it("writes no schedule for a MOCK public import with watch true", async () => {
    const { res } = await post({ org: "public", repos: names(2), mock: true, watch: true });
    expect(res.status).toBe(200);
    expect(setRepoWatch).toHaveBeenCalledTimes(2);
    expect(setRepoSchedule).not.toHaveBeenCalled();
  });

  it("still defaults a tenant import to weekly", async () => {
    const { res } = await post({ org: "acme", repos: ["acme/a"], mock: true, watch: true });
    expect(res.status).toBe(200);
    expect(setRepoSchedule).toHaveBeenCalledWith("acme", "acme/a", "weekly");
  });

  it("leaves auth-off public on today's weekly default and accepts an explicit cadence", async () => {
    vi.mocked(authGateEnabled).mockReturnValue(false);
    vi.mocked(isAuthConfigured).mockReturnValue(false);
    expect((await post({ org: "public", repos: ["facebook/a"], mock: true, watch: true })).res.status).toBe(200);
    expect(setRepoSchedule).toHaveBeenCalledWith("public", "facebook/a", "weekly");
    vi.mocked(setRepoSchedule).mockClear();
    expect((await post({ org: "public", repos: ["facebook/b"], mock: true, watch: true, schedule: "daily" })).res.status).toBe(200);
    expect(setRepoSchedule).toHaveBeenCalledWith("public", "facebook/b", "daily");
  });

  it("leaves an auth-off deployment unchanged: no viewer needed, no cap, unmetered", async () => {
    vi.mocked(authGateEnabled).mockReturnValue(false);
    vi.mocked(isAuthConfigured).mockReturnValue(false);
    const { res } = await post({ org: "public", repos: names(11), mock: false, watch: false });
    expect(res.status).toBe(200);
    expect(scanRepository).toHaveBeenCalledTimes(11);
    expect(consumePublicScanQuota).not.toHaveBeenCalled();
  });
});
