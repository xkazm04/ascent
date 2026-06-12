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
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 5 })),
  paymentRequired: vi.fn(),
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { consumeScanCredit, grantCredits, listWatchedRepos, persistScanReport } from "@/lib/db";

const mockScan = vi.mocked(scanRepository);
const mockConsume = vi.mocked(consumeScanCredit);
const mockGrant = vi.mocked(grantCredits);
const mockList = vi.mocked(listWatchedRepos);
const mockPersist = vi.mocked(persistScanReport);

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
  await res.text(); // drain the SSE stream so the scan work runs to completion
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([
    { fullName: "acme/repo", lastScanAt: null } as unknown as Awaited<
      ReturnType<typeof listWatchedRepos>
    >[number],
  ]);
  mockConsume.mockResolvedValue({ ok: true, balance: 4, unlimited: false });
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
