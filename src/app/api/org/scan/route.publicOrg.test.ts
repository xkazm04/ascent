// POST /api/org/scan and the shared "public" org (operator decision 2026-10-07, ask d0eb7d6c): the
// public org has no owner, so nobody is charged for a bulk scan of it. While the auth stack is live the
// route refuses it with a 403 BEFORE the watchlist is read or anything is enqueued; a tenant org and an
// auth-off (local, demo, seeding) deployment are untouched.

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
  listWatchedRepos: vi.fn(async () => []),
  persistTeamStandings: vi.fn(async () => false),
}));
vi.mock("@/lib/db/scan-jobs", () => ({
  JOB_PRIORITY: { manual: 10, webhook: 5, cadence: 0 },
  enqueueScanJob: vi.fn(),
  listJobsForRun: vi.fn(async () => []),
}));
vi.mock("@/lib/org/degraded-read", () => ({ noteReadFailure: vi.fn(), degradedRead: vi.fn((_r: string, f: unknown) => () => f) }));
vi.mock("@/lib/scan-queue-worker", () => ({ drainLane: vi.fn() }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireFleetOrg: vi.fn(async () => null) }));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: true, balance: 0, allowanceRemaining: 0 })),
  paymentRequired: vi.fn(),
  orgNotFound: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => false) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => true) }));

import { POST } from "./route";
import { listWatchedRepos } from "@/lib/db";
import { enqueueScanJob } from "@/lib/db/scan-jobs";
import { authGateEnabled } from "@/lib/access";

const post = (org: string) =>
  POST(new Request("http://localhost/api/org/scan", { method: "POST", body: JSON.stringify({ org }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authGateEnabled).mockReturnValue(true);
});

describe("POST /api/org/scan on the shared public org", () => {
  it("403s before the watchlist is read or anything is enqueued, naming why", async () => {
    const res = await post("public");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/no owner.*nobody is charged/i);
    expect(listWatchedRepos).not.toHaveBeenCalled();
    expect(enqueueScanJob).not.toHaveBeenCalled();
  });

  it("refuses a mixed-case slug the same way (the route canonicalizes first)", async () => {
    expect((await post(" Public ")).status).toBe(403);
    expect(listWatchedRepos).not.toHaveBeenCalled();
  });

  it("leaves a tenant org unchanged", async () => {
    const res = await post("acme");
    expect(res.status).toBe(200);
    expect(listWatchedRepos).toHaveBeenCalledWith("acme");
  });

  it("leaves an auth-off deployment unchanged", async () => {
    vi.mocked(authGateEnabled).mockReturnValue(false);
    const res = await post("public");
    expect(res.status).not.toBe(403);
    expect(listWatchedRepos).toHaveBeenCalledWith("public");
  });
});
