// Pins the bulk-scan refund policy (org-scanning 06-11 #1): a credit reserved before the scan is
// refunded when nothing billable was produced — the scan degraded to mock OR the commit was
// unchanged (persist deduped). A real-LLM scan that persists a NEW row keeps the debit. The DB /
// GitHub / scan boundaries are mocked; the SSE body is drained so the stream's work completes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/db", () => ({
  consumeScanCredit: vi.fn(),
  getInstallationIdForOwner: vi.fn(async () => "inst1"),
  grantCredits: vi.fn(async () => 5),
  isByomActive: vi.fn(async () => false),
  isDbConfigured: () => true,
  listWatchedRepos: vi.fn(),
  persistScanReport: vi.fn(),
  recordScanOutcome: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/app", () => ({
  getInstallationToken: vi.fn(async () => "tok"),
  isAppConfigured: () => true,
}));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null) }));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 })),
  paymentRequired: vi.fn(),
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { consumeScanCredit, grantCredits, listWatchedRepos, persistScanReport } from "@/lib/db";
import { checkScanEntitlement } from "@/lib/entitlement";

const mockScan = vi.mocked(scanRepository);
const mockConsume = vi.mocked(consumeScanCredit);
const mockGrant = vi.mocked(grantCredits);
const mockList = vi.mocked(listWatchedRepos);
const mockPersist = vi.mocked(persistScanReport);
const mockEntitlement = vi.mocked(checkScanEntitlement);

const report = (provider: string) =>
  ({
    engine: { provider, model: "m" },
    level: { id: "l2" },
    posture: { id: "balanced" },
    overallScore: 50,
    adoptionScore: 50,
    rigorScore: 50,
  }) as unknown as ScanReport;

const persisted = (deduped: boolean) =>
  ({ scanId: "s1", deduped, failures: { audit: false, contributors: 0 } }) as Awaited<
    ReturnType<typeof persistScanReport>
  >;

async function runBulkScan() {
  const res = await POST(
    new Request("http://localhost/api/org/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: "acme" }),
    }),
  );
  return res.text(); // drain the SSE stream so the scan work runs to completion; return body for assertions
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([
    { fullName: "acme/repo", lastScanAt: null } as unknown as Awaited<
      ReturnType<typeof listWatchedRepos>
    >[number],
  ]);
  mockConsume.mockResolvedValue({ ok: true, balance: 4, unlimited: false, charged: true });
});

describe("POST /api/org/scan — dedupe/degrade refund policy", () => {
  it("refunds the reserved credit when the persist deduped (unchanged commit)", async () => {
    mockScan.mockResolvedValue(report("gemini"));
    mockPersist.mockResolvedValue(persisted(true));
    await runBulkScan();
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith("acme", 1, { reason: "refund", actor: "system" });
  });

  it("refunds the reserved credit when the scan degraded to mock", async () => {
    mockScan.mockResolvedValue(report("mock"));
    mockPersist.mockResolvedValue(persisted(false));
    await runBulkScan();
    expect(mockGrant).toHaveBeenCalledWith("acme", 1, { reason: "refund", actor: "system" });
  });

  it("keeps the debit for a real-LLM scan that persisted a new row", async () => {
    mockScan.mockResolvedValue(report("gemini"));
    mockPersist.mockResolvedValue(persisted(false));
    await runBulkScan();
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockGrant).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/scan — never-scans-for-free + out-of-credits surfacing", () => {
  // INVARIANT (never-free): a watched repo is scanned IFF a credit was actually reserved. If the
  // per-repo atomic reservation comes back ok:false mid-pool (balance exhausted by a concurrent
  // batch between the up-front check and this debit), the route must SKIP the repo — never run real
  // LLM inference with no credit reserved (a free scan). Regressing this leaks money on every batch.
  it("does NOT scan a repo whose mid-pool credit reservation was lost (never scans for free)", async () => {
    // Up-front entitlement allows the batch (balance covers the single repo) so we reach the pool,
    // but the authoritative per-repo debit loses the race and returns ok:false.
    mockEntitlement.mockResolvedValueOnce({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
    mockConsume.mockResolvedValueOnce({ ok: false, balance: 0, unlimited: false });

    const body = await runBulkScan();

    // The money-protecting gate: scanRepository is the real-inference call. If a credit could not be
    // reserved, it must not run at all — and nothing billable can follow it.
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    // No reserved credit means nothing to refund — a refund here would mask a missing debit.
    expect(mockGrant).not.toHaveBeenCalled();
    // The skip is surfaced to the client, not silently dropped.
    expect(body).toContain('"skipped":"insufficient_credits"');
  });

  it("surfaces an out-of-credits error (not a silent 0/0 success) when the balance slices the scan list to empty", async () => {
    // Non-empty watchlist (2 repos) but the up-front prepaid balance is 0 → scanList sliced to empty.
    mockList.mockResolvedValueOnce([
      { fullName: "acme/repo-a", lastScanAt: null },
      { fullName: "acme/repo-b", lastScanAt: null },
    ] as unknown as Awaited<ReturnType<typeof listWatchedRepos>>);
    // allowance spent AND no credits ⇒ capacity 0 ⇒ scanList sliced to empty (the defensive branch).
    mockEntitlement.mockResolvedValueOnce({ allowed: true, unlimited: false, balance: 0, allowanceRemaining: 0 });

    const body = await runBulkScan();

    // The customer sees a clear out-of-credits surface, not a misleading success-looking empty result.
    expect(body).toContain("event: error");
    expect(body).toContain("Out of scan credits");
    // No repo was scanned and no credit was touched — nothing scored, nothing reserved.
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    expect(body).not.toContain('"overall"'); // no per-repo scored events leaked
  });

  it("scans an org's INCLUDED free allowance even at a zero prepaid balance (allowance-cap fix)", async () => {
    // A Free org (0 purchased credits) with 2 of its monthly free scans left must scan BOTH watched
    // repos — capping on balance alone wrongly sliced this to empty and surfaced a false "out of credits".
    mockList.mockResolvedValueOnce([
      { fullName: "acme/repo-a", lastScanAt: null },
      { fullName: "acme/repo-b", lastScanAt: null },
    ] as unknown as Awaited<ReturnType<typeof listWatchedRepos>>);
    mockEntitlement.mockResolvedValueOnce({ allowed: true, unlimited: false, balance: 0, allowanceRemaining: 2 });
    mockConsume.mockResolvedValue({ ok: true, balance: 0, unlimited: false, charged: false }); // within allowance ⇒ free
    mockScan.mockResolvedValue(report("gemini"));
    mockPersist.mockResolvedValue(persisted(false));

    const body = await runBulkScan();

    expect(body).not.toContain("Out of scan credits");
    expect(mockScan).toHaveBeenCalledTimes(2); // both included free scans ran
    expect(body).toContain('"skippedForCredits":0');
  });
});
