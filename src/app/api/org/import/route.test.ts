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
  CREDIT_REASON: { SCAN: "scan", GRANT: "grant", ADJUSTMENT: "adjustment", REFUND: "refund", POLAR_REFUND: "polar-refund" },
  consumeScanCredit: vi.fn(),
  getInstallationIdForOwner: vi.fn(async () => null),
  grantCredits: vi.fn(),
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
vi.mock("@/lib/github/app", () => ({
  getInstallationToken: vi.fn(async () => "app-installation-token"),
  isAppConfigured: () => true,
}));
vi.mock("@/lib/github/list", () => ({
  listOrgRepos: vi.fn(async () => ({ repos: [], truncated: false })),
  // The route now validates explicit repos[] coordinates via these before any fetch — the test's
  // repos use valid owner/name, so accept them (the real validators are unit-tested in list.test.ts).
  isValidHandle: (s: string) => /^[A-Za-z0-9-]+$/.test(s),
  isValidRepoName: (s: string) => /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith(".") && !s.includes(".."),
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => true) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => false), getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({
  // Default: the caller IS authorized for the org (gate passes) so these suites can focus on token
  // discipline + the credit cap. The gate's own deny logic is unit-tested in authz.test.ts; the
  // cross-tenant-block regression test below overrides this to return a denial Response.
  requireOrgAccess: vi.fn(async () => null),
  // Default: the caller may NOT mint this org's installation token. authz.test.ts pins the gate itself.
  canMintInstallationToken: vi.fn(async () => false),
  // Default: the target org IS a fleet org (not personal), so this suite's fleet-import scenarios pass
  // the gate unimpeded. requireFleetOrg's own deny logic is exercised where the personal-workspace tests live.
  requireFleetOrg: vi.fn(async () => null),
}));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: true, balance: 0 })),
  paymentRequired: vi.fn(),
}));
// `rateLimitRequestShared` is a vi.fn so the refusal suite below can make it deny, and
// `tooManyRequests` is the REAL helper (not a stub) so that suite asserts the response this route
// actually emits — scope included — rather than a stand-in the test authored itself.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    rateLimitRequest: () => ({ ok: true }),
    rateLimitRequestShared: vi.fn(async () => ({ ok: true })),
    tooManyRequests: actual.tooManyRequests,
    ORG_IMPORT_RATE_LIMIT: {},
  };
});
// G7-17: the token-less REAL public path is metered by the monthly free public-scan allowance rather
// than by credits. Default here to the module's own fail-open shape (`enforced: false`) so the token
// discipline / credit suites below are unaffected; the allowance behaviour has its own suite, which
// overrides these.
vi.mock("@/lib/public-scan-quota", () => ({
  peekPublicScanQuota: vi.fn(async () => ({ enforced: false, remaining: 5, limit: 5, resetAt: null, scope: "anon" })),
  consumePublicScanQuota: vi.fn(async () => ({
    enforced: false,
    allowed: true,
    remaining: 5,
    retryAfterSec: 0,
    resetAt: null,
    signedIn: false,
    chargedAt: null,
  })),
  refundPublicScanQuota: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled } from "@/lib/access";
import { canMintInstallationToken, requireOrgAccess } from "@/lib/authz";
import { getInstallationToken } from "@/lib/github/app";
import { consumeScanCredit, getInstallationIdForOwner, grantCredits, isByomActive, persistScanReport, reconcileListedRepos } from "@/lib/db";
import { listOrgRepos } from "@/lib/github/list";
import { checkScanEntitlement } from "@/lib/entitlement";
import { consumePublicScanQuota, peekPublicScanQuota, refundPublicScanQuota } from "@/lib/public-scan-quota";
import { rateLimitRequestShared } from "@/lib/rate-limit";
// Real (unmocked) process-local claim — the route imports it from the same sub-module, so a claim taken
// here is visible to the route, letting us simulate a concurrent in-flight run deterministically.
import { claimRepoScan, releaseRepoScan } from "@/lib/db/org-watch";

const mockScan = vi.mocked(scanRepository);
const mockAuthOn = vi.mocked(isAuthConfigured);
const mockGateEnabled = vi.mocked(authGateEnabled);
const mockGate = vi.mocked(requireOrgAccess);
const mockCanMint = vi.mocked(canMintInstallationToken);
const mockMintToken = vi.mocked(getInstallationToken);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockConsume = vi.mocked(consumeScanCredit);
const mockGrant = vi.mocked(grantCredits);
const mockEntitlement = vi.mocked(checkScanEntitlement);
const mockByom = vi.mocked(isByomActive);
const mockPersist = vi.mocked(persistScanReport);

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
  mockGateEnabled.mockReturnValue(false);
  mockCanMint.mockResolvedValue(false);
  mockMintToken.mockResolvedValue("app-installation-token");
  mockInstallId.mockResolvedValue(null);
  mockByom.mockResolvedValue(false);
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

  it("scans with the minted installation token when the caller may mint for the org", async () => {
    mockCanMint.mockResolvedValue(true);
    mockInstallId.mockResolvedValue("inst-1");
    await runImport({ org: "acme", repos: ["acme/app"], mock: true, watch: false });
    const opts = mockScan.mock.calls[0][1]!;
    expect(opts.token).toBe("app-installation-token");
    expect(opts.noAmbientToken).toBeUndefined();
  });

  it("PROD SHAPE: Supabase wall on, legacy OAuth off — an unauthorized caller never gets the operator PAT", async () => {
    // The regression. The escape hatch used to be `!isAuthConfigured()`, the DORMANT predicate, which
    // is TRUE in production — so every scan received the ambient operator PAT and an authorized-for-
    // "public" caller could exfiltrate a named private repo (the confused deputy the route documents).
    mockGateEnabled.mockReturnValue(true);
    mockAuthOn.mockReturnValue(false); // the production configuration
    mockCanMint.mockResolvedValue(false);
    await runImport({ org: "public", repos: ["victim/secret"], mock: true, watch: false });
    const opts = mockScan.mock.calls[0][1]!;
    expect(opts.token).toBeUndefined();
    expect(opts.noAmbientToken).toBe(true);
  });

  it("ignores a caller-supplied installationId that is not this org's (cross-tenant mint)", async () => {
    mockCanMint.mockResolvedValue(true);
    mockInstallId.mockResolvedValue("inst-1"); // the org's OWN stored installation
    await runImport({
      org: "acme",
      repos: ["acme/app"],
      mock: true,
      watch: false,
      installationId: "victim-install-99",
    });
    // Minted for the org's own installation — the supplied victim id is never honored.
    expect(mockMintToken).toHaveBeenCalledWith("inst-1");
    expect(mockMintToken).not.toHaveBeenCalledWith("victim-install-99");
  });

  it("keeps the env token on an auth-off (local/demo) deployment — the documented seeding path", async () => {
    mockAuthOn.mockReturnValue(false);
    mockGateEnabled.mockReturnValue(false); // no auth stack live at all
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

  // BYOM parity with /api/org/scan and /api/cron/rescan (org-import-scan-watchlist 2026-07-16 #1):
  // an org scanning on its OWN Bedrock is billed by AWS, so a real-LLM import must reserve ZERO
  // platform credits and never be truncated by the platform balance.
  it("exempts a BYOM org from metering — no entitlement gate, no credit reserved, full batch scans", async () => {
    mockByom.mockResolvedValue(true);
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 0, allowanceRemaining: 0 });
    const events = await collectImport({ org: "acme", repos: ["acme/a", "acme/b"], mock: false, watch: false });
    // Old behavior: metered = !mock && org !== "public" → balance 0 meant paymentRequired/slice(0,0).
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockEntitlement).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    expect(events.find((e) => e.event === "result")?.data).toMatchObject({ scanned: 2, skippedForCredits: 0 });
  });

  // G1-06: "the scan threw so nothing was billed" only holds BEFORE scanRepository returns. Once a
  // real report is in hand the inference is spent; refunding a persist failure hands back a credit
  // for work that ran, and the retry re-bills the same inference.
  it("does NOT refund when persistScanReport throws after a REAL scan — the inference was already paid for", async () => {
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
    mockPersist.mockRejectedValueOnce(new Error("could not serialize access"));
    const events = await collectImport({ org: "acme", repos: ["acme/ok"], mock: false, watch: false });
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockGrant).not.toHaveBeenCalled();
    // The importer is told it failed AND that it was charged — never a silent charge for nothing.
    expect(events.find((e) => e.event === "repo")?.data).toMatchObject({
      repo: "acme/ok",
      error: "could not serialize access",
      charged: true,
    });
  });

  it("DOES refund a MOCK-degraded scan whose persist throws — a mock run bills no inference", async () => {
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
    // mock:false enters the metered path, but the SCAN itself degraded to the mock provider.
    mockScan.mockResolvedValue(report); // `report` is provider:"mock"
    mockPersist.mockRejectedValueOnce(new Error("write failed"));
    const events = await collectImport({ org: "acme", repos: ["acme/deg"], mock: false, watch: false });
    expect(mockGrant).toHaveBeenCalledWith("acme", 1, { reason: "refund", actor: "system" });
    expect(events.find((e) => e.event === "repo")?.data).toMatchObject({ charged: false });
  });

  it("BYOM org: a post-inference persist failure neither refunds nor charges a platform credit", async () => {
    mockByom.mockResolvedValue(true);
    mockPersist.mockRejectedValueOnce(new Error("write failed"));
    const events = await collectImport({ org: "acme", repos: ["acme/byom"], mock: false, watch: false });
    expect(mockConsume).not.toHaveBeenCalled(); // unmetered — nothing reserved
    expect(mockGrant).not.toHaveBeenCalled(); // ...so a refund would MINT a credit
    expect(events.find((e) => e.event === "repo")?.data).toMatchObject({ charged: false });
  });

  it("passes orgSlug to scanRepository so a BYOM org's inference runs on ITS provider, not the platform's", async () => {
    // The scan route passes orgSlug (getProviderForOrg + standing decisions); import omitted it, so
    // scanRepository resolved the provider for `undefined` and fell back to the platform provider.
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
    await collectImport({ org: "acme", repos: ["acme/a"], mock: false, watch: false });
    expect(mockScan.mock.calls[0][1]).toMatchObject({ orgSlug: "acme" });
  });
});

// ---------------------------------------------------------------------------
// Per-repo in-flight claim (org-import-scan-watchlist #1): a metered import that overlaps another
// in-flight run (a second import tab, another member, or an overlapping /api/org/scan) must NOT re-scan
// and re-charge a repo the other run already owns. The route claims each repo before reserving/scanning.
describe("POST /api/org/import — schedule validation (ambiguity-ui 2026-07-16 #3)", () => {
  async function rawImport(body: Record<string, unknown>) {
    return POST(
      new Request("http://localhost/api/org/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("rejects an invalid schedule with 400 (parity with /api/org/schedule) instead of coercing to weekly", async () => {
    // The old fallback silently rewrote "biweekly" (or any typo/case variant) to WEEKLY recurring,
    // credit-spending autoscans behind a 200/SSE success — the caller's explicit cadence intent lost.
    const res = await rawImport({ org: "public", repos: ["acme/web"], mock: true, schedule: "biweekly" });
    expect(res.status).toBe(400);
    const d = (await res.json()) as { error?: string };
    expect(d.error).toMatch(/schedule/i);
    expect(mockScan).not.toHaveBeenCalled(); // rejected before any work
  });

  it("rejects a case-variant like \"Weekly\" too — the value must be the exact vocabulary", async () => {
    const res = await rawImport({ org: "public", repos: ["acme/web"], mock: true, schedule: "Weekly" });
    expect(res.status).toBe(400);
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("still accepts an omitted schedule (documented weekly default) and runs the import", async () => {
    await runImport({ org: "public", repos: ["acme/web"], mock: true, watch: false });
    expect(mockScan).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/org/import — per-repo in-flight claim (no double-scan/charge)", () => {
  beforeEach(() => {
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
    mockConsume.mockResolvedValue({ ok: true, balance: 4, unlimited: false, charged: true });
    mockScan.mockResolvedValue(realReport);
    mockGrant.mockResolvedValue(0);
  });

  it("skips a repo a concurrent run already claimed — no scan, no credit — then imports once released", async () => {
    // Stand in for the concurrent run holding the claim for (acme, acme/dup).
    const held = claimRepoScan("acme", "acme/dup");
    expect(held).not.toBeNull();

    const first = await collectImport({ org: "acme", repos: ["acme/dup"], mock: false, watch: false });
    // Money invariant: no real inference and no credit reserved for the contended repo.
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockGrant).not.toHaveBeenCalled();
    expect(first.find((e) => e.event === "repo")?.data).toMatchObject({ repo: "acme/dup", skipped: "in_progress" });
    // ambiguity-ui 2026-07-16 #4: the machine-readable summary must not report the claim-skipped
    // repo as scanned — the old shared counter emitted a perfect-looking { scanned: 1 } for a run
    // in which zero scans happened. The skip now has its own outcome bucket.
    expect(first.find((e) => e.event === "result")?.data).toMatchObject({ scanned: 0, total: 1, skippedInProgress: 1 });

    // The other run completes and frees the repo; the import now scans + bills exactly once.
    releaseRepoScan("acme", "acme/dup", held!);
    const second = await collectImport({ org: "acme", repos: ["acme/dup"], mock: false, watch: false });
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(second.find((e) => e.event === "repo")?.data).not.toMatchObject({ skipped: "in_progress" });
    expect(second.find((e) => e.event === "result")?.data).toMatchObject({ scanned: 1, skippedInProgress: 0 });
  });

  it("releases the claim after a normal import, so a repo isn't locked out of the next run", async () => {
    await collectImport({ org: "acme", repos: ["acme/again"], mock: false, watch: false });
    expect(mockScan).toHaveBeenCalledTimes(1);
    // If the route leaked the claim, this second import would skip as in_progress. It must scan again.
    const events = await collectImport({ org: "acme", repos: ["acme/again"], mock: false, watch: false });
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(events.find((e) => e.event === "repo")?.data).not.toMatchObject({ skipped: "in_progress" });
  });
});

// ---------------------------------------------------------------------------
// Watchlist reconciliation against the org listing (org-scan direction 4). The import is the only
// place the app re-reads "what repos does this org actually have", so it is the only place a repo
// that was renamed, transferred, deleted or turned private can be noticed. Absence is evidence ONLY
// when the listing is complete — every incomplete-listing shape below must mark NOTHING, because a
// false flag would point the user at unwatching a live repo.
describe("POST /api/org/import — missing-repo reconciliation", () => {
  const mockList = vi.mocked(listOrgRepos);
  const mockReconcile = vi.mocked(reconcileListedRepos);

  const listed = (names: string[]) =>
    names.map((fullName) => {
      const [owner = "", name = ""] = fullName.split("/");
      return { owner, name, fullName, url: `https://github.com/${fullName}` };
    }) as unknown as Awaited<ReturnType<typeof listOrgRepos>>["repos"];

  beforeEach(() => {
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: true, balance: 0, allowanceRemaining: 0 });
  });

  it("reconciles against a COMPLETE listing, passing exactly the repos GitHub returned", async () => {
    mockList.mockResolvedValue({ repos: listed(["acme/a", "acme/b"]), truncated: false });
    await runImport({ org: "acme", mock: true, watch: false });
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile).toHaveBeenCalledWith("acme", ["acme/a", "acme/b"]);
  });

  it("marks NOTHING when the listing was page-budget TRUNCATED (absence is not evidence)", async () => {
    // A fork/archive-heavy org beyond the 5-page walk: the repos past the cap are still there, they
    // were just never fetched. Flagging them would be pure fabrication.
    mockList.mockResolvedValue({ repos: listed(["acme/a"]), truncated: true });
    await runImport({ org: "acme", mock: true, watch: false });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("marks NOTHING when the listing filled the caller's `count` window (a silent second truncation)", async () => {
    // `count: 2` with 2 results means the walk stopped at the window, not at the end of the org —
    // indistinguishable from "there are exactly 2", so the whole tail must not be flagged.
    mockList.mockResolvedValue({ repos: listed(["acme/a", "acme/b"]), truncated: false });
    await runImport({ org: "acme", count: 2, mock: true, watch: false });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("marks NOTHING for an explicit repos[] import — a caller's hand-picked list says nothing about the org", async () => {
    await runImport({ org: "acme", repos: ["acme/a"], mock: true, watch: false });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("marks NOTHING when the listing THROWS — a GitHub outage must not empty the watchlist's meaning", async () => {
    mockList.mockRejectedValue(new Error("GitHub 502"));
    await runImport({ org: "acme", mock: true, watch: false });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("does not fail the import when the reconcile write fails (bookkeeping is best-effort)", async () => {
    mockList.mockResolvedValue({ repos: listed(["acme/a"]), truncated: false });
    mockReconcile.mockRejectedValueOnce(new Error("db down"));
    await runImport({ org: "acme", mock: true, watch: false });
    expect(mockScan).toHaveBeenCalledTimes(1); // the scan still ran
  });
});

// ── G7-17: the PUBLIC FUNNEL runs REAL scans, metered by the free monthly allowance ──────────────
//
// The onboarding wizard's public-handle path used to be documented in-code as "always a preview": it
// could not mint an installation token, so the money gate refused a real scan and the product's
// highest-intent first run showed deterministic numbers no model produced — numbers that then land in
// the public corpus the public register ranks. It now runs for real, billed against the SAME monthly
// public-scan allowance `/report?repo=` uses, and never against org credits.
//
// The safety property pinned here is that the mode is opt-in AND token-bound: asking for it on a run
// that minted an installation token (i.e. one that CAN read private repos) is ignored.
describe("POST /api/org/import — public funnel (real scan, allowance-metered)", () => {
  it("runs a REAL token-less scan without touching credits or entitlement", async () => {
    mockScan.mockResolvedValue(realReport);
    const events = await collectImport({
      org: "facebook",
      repos: ["facebook/react"],
      mock: false,
      watch: false,
      publicFunnel: true,
    });

    // Real inference…
    expect(mockScan.mock.calls[0][1]!.mock).toBe(false);
    // …on a token-less scan, so a private repo could only ever 404 here.
    expect(mockScan.mock.calls[0][1]!.noAmbientToken).toBe(true);
    // …and NOT a credit draw: no entitlement check, no consume, no 402 dead-end.
    expect(mockEntitlement).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    // It IS metered — one allowance slot per repo.
    expect(vi.mocked(consumePublicScanQuota)).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.event === "result")?.data).toMatchObject({ scanned: 1 });
  });

  it("IGNORES the flag when an installation token was minted (no free private scans)", async () => {
    mockCanMint.mockResolvedValue(true);
    mockInstallId.mockResolvedValue("inst-1");
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: true, balance: 0, allowanceRemaining: 0 });
    mockScan.mockResolvedValue(realReport);

    await collectImport({ org: "acme", repos: ["acme/app"], mock: false, watch: false, publicFunnel: true });

    // Credit-metered as before; the allowance is untouched.
    expect(mockEntitlement).toHaveBeenCalled();
    expect(vi.mocked(consumePublicScanQuota)).not.toHaveBeenCalled();
  });

  it("caps the batch at the remaining allowance and DISCLOSES the shortfall", async () => {
    vi.mocked(peekPublicScanQuota).mockResolvedValue({
      enforced: true,
      remaining: 1,
      limit: 5,
      resetAt: null,
      scope: "anon",
    });
    mockScan.mockResolvedValue(realReport);

    const events = await collectImport({
      org: "facebook",
      repos: ["facebook/react", "facebook/jest"],
      mock: false,
      watch: false,
      publicFunnel: true,
    });

    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.event === "notice")?.data).toMatchObject({
      reason: "monthly_quota",
      scanning: 1,
      skipped: 1,
    });
  });

  it("REFUSES rather than silently downgrading to a preview when the allowance is spent", async () => {
    vi.mocked(peekPublicScanQuota).mockResolvedValue({
      enforced: true,
      remaining: 0,
      limit: 5,
      resetAt: null,
      scope: "anon",
    });

    const events = await collectImport({
      org: "facebook",
      repos: ["facebook/react"],
      mock: false,
      watch: false,
      publicFunnel: true,
    });

    expect(mockScan).not.toHaveBeenCalled();
    expect(String((events.find((e) => e.event === "error")?.data as { error?: string })?.error)).toMatch(
      /free public scans/i,
    );
  });

  it("refunds the allowance slot when the scan degraded to mock (nothing chargeable)", async () => {
    // `mockResolvedValue` survives clearAllMocks (it clears calls, not implementations), so restore the
    // allowance explicitly — the preceding cases deliberately exhaust it.
    vi.mocked(peekPublicScanQuota).mockResolvedValue({
      enforced: true,
      remaining: 5,
      limit: 5,
      resetAt: null,
      scope: "anon",
    });
    vi.mocked(consumePublicScanQuota).mockResolvedValue({
      enforced: true,
      allowed: true,
      remaining: 4,
      retryAfterSec: 0,
      resetAt: null,
      signedIn: false,
      chargedAt: 1_700_000_000_000,
    });
    // A degrade-to-mock report: real inference was requested but never happened.
    mockScan.mockResolvedValue(report);
    mockPersist.mockResolvedValue({ deduped: false } as never);
    await collectImport({
      org: "facebook",
      repos: ["facebook/react"],
      mock: false,
      watch: false,
      publicFunnel: true,
    });
    expect(vi.mocked(refundPublicScanQuota)).toHaveBeenCalled();
  });
});

// The refusal has to be actionable on its own. A bulk import is driven by an operator or a CI job
// that cannot read our logs: "you called too often" (fix: slow down), "the fleet budget is spent by
// someone else" (slowing down may not clear it) and "the shared limiter never answered, nothing was
// counted" are three different situations that used to render as one identical sentence.
describe("POST /api/org/import — the 429 names the scope that refused", () => {
  const post = () =>
    POST(
      new Request("http://localhost/api/org/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: "facebook", repos: ["facebook/react"] }),
      }),
    );

  it("per-IP refusal states the scope, the limiter, and the budget the caller must fit", async () => {
    vi.mocked(rateLimitRequestShared).mockResolvedValue({
      ok: false,
      retryAfterSec: 30,
      scope: "ip",
      limiter: "org-import",
      limit: 3,
      windowSec: 60,
      evaluated: true,
    });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toMatchObject({ code: "rate_limited", scope: "ip", limiter: "org-import", limit: 3, windowSec: 60 });
  });

  it("global refusal names the scope but never echoes the fleet ceiling", async () => {
    vi.mocked(rateLimitRequestShared).mockResolvedValue({
      ok: false,
      retryAfterSec: 12,
      scope: "global",
      limiter: "org-import",
      evaluated: true,
    });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("global");
    const body = await res.json();
    expect(body).toMatchObject({ code: "rate_limited", scope: "global" });
    // The fleet ceiling and its headroom stay withheld: this endpoint must not double as a
    // capacity probe for whoever is hammering it.
    expect(body.limit).toBeUndefined();
    expect(body.windowSec).toBeUndefined();
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBeNull();
  });

  it("an unevaluated refusal says so rather than claiming the caller overspent", async () => {
    vi.mocked(rateLimitRequestShared).mockResolvedValue({
      ok: false,
      retryAfterSec: 5,
      scope: "unavailable",
      limiter: "org-import",
      evaluated: false,
    });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("unavailable");
    expect(await res.json()).toMatchObject({ code: "rate_limit_unavailable", scope: "unavailable", evaluated: false });
  });
});
