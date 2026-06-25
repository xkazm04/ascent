// Pins the import funnel's token discipline (org-scanning 06-11 #2): the route is a deliberately
// anonymous public funnel that accepts an explicit `repos[]` list, so its SCANS must be token-less
// by construction unless a session-gated installation token was minted — the ambient GITHUB_TOKEN
// (an operator PAT, often with private `repo` scope) must never become a confused deputy that
// ingests an attacker-named private repo into the open org. Auth-off (local/demo) deployments keep
// the prior open behavior (the documented seeding path).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
// The metered (non-unlimited) credit path reaches maybeAlertLowCredits after a reserved debit; the
// ambient-token suite never enters that branch (it pins unlimited:true) so it omits this mock. The
// credit-cap suite below DOES enter it, so stub the alert glue to keep the test hermetic.
vi.mock("@/lib/scan-alerts", () => ({ maybeAlertLowCredits: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({
  consumeScanCredit: vi.fn(),
  getInstallationIdForOwner: vi.fn(async () => null),
  grantCredits: vi.fn(),
  isDbConfigured: () => true,
  persistScanReport: vi.fn(async () => null),
  recordScanOutcome: vi.fn(async () => {}),
  setRepoSchedule: vi.fn(async () => {}),
  setRepoWatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/app", () => ({
  getInstallationToken: vi.fn(async () => "app-installation-token"),
  isAppConfigured: () => true,
}));
vi.mock("@/lib/github/list", () => ({
  listOrgRepos: vi.fn(async () => []),
  // The route now validates explicit repos[] coordinates via these before any fetch — the test's
  // repos use valid owner/name, so accept them (the real validators are unit-tested in list.test.ts).
  isValidHandle: (s: string) => /^[A-Za-z0-9-]+$/.test(s),
  isValidRepoName: (s: string) => /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith(".") && !s.includes(".."),
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => true) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({
  // Default: the caller IS authorized for the org (gate passes) so these suites can focus on token
  // discipline + the credit cap. The gate's own deny logic is unit-tested in authz.test.ts; the
  // cross-tenant-block regression test below overrides this to return a denial Response.
  requireOrgAccess: vi.fn(async () => null),
  sessionHasInstallation: vi.fn(async () => false),
  sessionOwnsOrg: vi.fn(async () => false),
}));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: true, balance: 0 })),
  paymentRequired: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: () => ({ ok: true }),
  tooManyRequests: vi.fn(),
  ORG_IMPORT_RATE_LIMIT: {},
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { isAuthConfigured } from "@/lib/auth";
import { requireOrgAccess, sessionOwnsOrg } from "@/lib/authz";
import { consumeScanCredit, getInstallationIdForOwner, grantCredits } from "@/lib/db";
import { checkScanEntitlement } from "@/lib/entitlement";

const mockScan = vi.mocked(scanRepository);
const mockAuthOn = vi.mocked(isAuthConfigured);
const mockGate = vi.mocked(requireOrgAccess);
const mockOwnsOrg = vi.mocked(sessionOwnsOrg);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockConsume = vi.mocked(consumeScanCredit);
const mockGrant = vi.mocked(grantCredits);
const mockEntitlement = vi.mocked(checkScanEntitlement);

const report = {
  engine: { provider: "mock", model: "m" },
  level: { id: "l2" },
  posture: { id: "balanced" },
  overallScore: 50,
  adoptionScore: 50,
  rigorScore: 50,
  contributors: [],
} as unknown as ScanReport;

async function runImport(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/org/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  await res.text(); // drain the SSE stream so the scan work runs to completion
}

const savedToken = process.env.GITHUB_TOKEN;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = "operator-pat-with-repo-scope";
  mockScan.mockResolvedValue(report);
  mockAuthOn.mockReturnValue(true);
  mockOwnsOrg.mockResolvedValue(false);
  mockInstallId.mockResolvedValue(null);
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
});

describe("POST /api/org/import — ambient-token discipline", () => {
  it("scans token-less (noAmbientToken) for an anonymous caller naming explicit repos", async () => {
    await runImport({ org: "public", repos: ["victim/secret"], mock: true, watch: false });
    expect(mockScan).toHaveBeenCalledTimes(1);
    const opts = mockScan.mock.calls[0][1]!;
    expect(opts.token).toBeUndefined();
    expect(opts.noAmbientToken).toBe(true);
  });

  it("scans with the minted installation token when the session owns the org", async () => {
    mockOwnsOrg.mockResolvedValue(true);
    mockInstallId.mockResolvedValue("inst-1");
    await runImport({ org: "acme", repos: ["acme/app"], mock: true, watch: false });
    const opts = mockScan.mock.calls[0][1]!;
    expect(opts.token).toBe("app-installation-token");
    expect(opts.noAmbientToken).toBeUndefined();
  });

  it("keeps the env token on an auth-off (local/demo) deployment — the documented seeding path", async () => {
    mockAuthOn.mockReturnValue(false);
    await runImport({ org: "public", repos: ["some/repo"], mock: true, watch: false });
    const opts = mockScan.mock.calls[0][1]!;
    expect(opts.token).toBe("operator-pat-with-repo-scope");
    expect(opts.noAmbientToken).toBeUndefined();
  });

  it("returns the requireOrgAccess denial and scans nothing when the caller isn't a member (cross-tenant block)", async () => {
    // The fix: import is a tenant-scoped mutation (spends credits, writes the watchlist), so a
    // non-member's request must be refused BEFORE any scan/credit work — like its sibling routes.
    mockGate.mockResolvedValueOnce(Response.json({ error: "no access" }, { status: 403 }) as never);
    const res = await POST(
      new Request("http://localhost/api/org/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: "victim", repos: ["victim/secret"], mock: false, watch: true }),
      }),
    );
    expect(res.status).toBe(403);
    expect(mockScan).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Credit-cap slice + per-repo refund (watchlist HIGH #4). The ambient-token suite above pins
// checkScanEntitlement → {unlimited:true}, so the metered branch (the entire credit dimension of the
// import funnel) is out of its frame. This suite enters the metered path — a real-inference import
// (mock:false) into a PRIVATE org (org !== "public") — and pins the money-protecting invariants:
//   • the up-front cap scans only the affordable SLICE (exactly `balance` repos, never balance+1);
//   • the import surfaces an honest "N of M scanned, capped at balance" result (a notice + a non-zero
//     skippedForCredits), not a silent partial;
//   • a per-repo scan FAILURE refunds that repo's reserved credit (never charge for a non-product).
// A non-mock report is used so the refund-on-degrade branch (provider === "mock") doesn't fire and
// confound the cap test — here every scanned repo produces billable real inference.

// A real-LLM (non-mock) report — so a successful scan is genuinely billable and NOT auto-refunded.
const realReport = { ...(report as object), engine: { provider: "anthropic", model: "claude" } } as unknown as ScanReport;

/** Drain the SSE stream and return the decoded `event: …\ndata: …` frames as {event,data} pairs. */
async function collectImport(body: Record<string, unknown>): Promise<{ event: string; data: unknown }[]> {
  const res = await POST(
    new Request("http://localhost/api/org/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  const events: { event: string; data: unknown }[] = [];
  for (const frame of text.split("\n\n")) {
    const ev = frame.match(/^event: (.+)$/m)?.[1];
    const dataLine = frame.match(/^data: (.+)$/m)?.[1];
    if (ev && dataLine) events.push({ event: ev, data: JSON.parse(dataLine) });
  }
  return events;
}

describe("POST /api/org/import — credit-cap slice + per-repo refund (metered)", () => {
  beforeEach(() => {
    // Metered path = real inference into a private org. Default each reserve to a successful debit;
    // the unaffordable tail never reaches consumeScanCredit because the up-front slice drops it.
    mockScan.mockResolvedValue(realReport);
    mockConsume.mockResolvedValue({ ok: true, balance: 1, unlimited: false, charged: true });
    mockGrant.mockResolvedValue(0);
  });

  it("caps the batch to the credit balance — scans exactly `balance` repos (the affordable slice), not balance+1", async () => {
    // balance:2, three watched repos → only the first 2 are affordable; the 3rd must never scan.
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 2, allowanceRemaining: 0 });
    const events = await collectImport({
      org: "acme",
      repos: ["acme/a", "acme/b", "acme/c"],
      mock: false,
      watch: false,
    });

    // SLICE BOUNDARY pinned: exactly 2 scans (balance), never the 3rd (balance+1).
    expect(mockScan).toHaveBeenCalledTimes(2);
    const scannedRepos = mockScan.mock.calls.map((c) => c[0]);
    expect(scannedRepos).toEqual(["acme/a", "acme/b"]);
    expect(scannedRepos).not.toContain("acme/c");
    // A credit is reserved per scanned repo — never for the capped-out tail.
    expect(mockConsume).toHaveBeenCalledTimes(2);

    // HONEST partial: an up-front notice AND a non-zero skippedForCredits in the result — not a
    // silent 0-skipped success.
    const notice = events.find((e) => e.event === "notice");
    expect(notice?.data).toMatchObject({ reason: "insufficient_credits", scanning: 2, skipped: 1 });
    const result = events.find((e) => e.event === "result");
    expect(result?.data).toMatchObject({ org: "acme", scanned: 2, total: 2, skippedForCredits: 1 });
  });

  it("does NOT cap when the balance covers the whole batch — scans every repo, no skip notice", async () => {
    // Guard the lower edge of the boundary: balance:3 for 3 repos → no slice, all three scan.
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 3, allowanceRemaining: 0 });
    const events = await collectImport({
      org: "acme",
      repos: ["acme/a", "acme/b", "acme/c"],
      mock: false,
      watch: false,
    });
    expect(mockScan).toHaveBeenCalledTimes(3);
    expect(events.find((e) => e.event === "notice")).toBeUndefined();
    expect(events.find((e) => e.event === "result")?.data).toMatchObject({ scanned: 3, skippedForCredits: 0 });
  });

  it("refunds the reserved credit when a per-repo scan throws — never charge for a non-product", async () => {
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
    mockScan.mockRejectedValueOnce(new Error("github 500"));
    const events = await collectImport({ org: "acme", repos: ["acme/boom"], mock: false, watch: false });

    // The reservation was made (consumeScanCredit) and then refunded exactly once on the throw.
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith("acme", 1, { reason: "refund", actor: "system" });
    // The failure is surfaced honestly on the repo event, not swallowed.
    expect(events.find((e) => e.event === "repo")?.data).toMatchObject({ repo: "acme/boom", error: "github 500" });
  });

  it("does not refund a successful, genuinely-billable scan — a real product is charged", async () => {
    // Pins the other side of the refund invariant: a non-mock, non-deduped scan keeps its debit.
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
    await collectImport({ org: "acme", repos: ["acme/ok"], mock: false, watch: false });
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("never reserves a credit on the free mock funnel into a private org (mock is free)", async () => {
    // mock:true → metered = !mock && … = false: the credit dimension is skipped entirely.
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 2, allowanceRemaining: 0 });
    await collectImport({ org: "acme", repos: ["acme/a", "acme/b"], mock: true, watch: false });
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockEntitlement).not.toHaveBeenCalled();
  });
});
