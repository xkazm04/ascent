// Pins the bulk-scan refund policy (org-scanning 06-11 #1): a credit reserved before the scan is
// refunded when nothing billable was produced — the scan degraded to mock OR the commit was
// unchanged (persist deduped). A real-LLM scan that persists a NEW row keeps the debit. The DB /
// GitHub / scan boundaries are mocked; the SSE body is drained so the stream's work completes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  CREDIT_REASON: { SCAN: "scan", GRANT: "grant", ADJUSTMENT: "adjustment", REFUND: "refund", POLAR_REFUND: "polar-refund" },
  consumeScanCredit: vi.fn(),
  getInstallationIdForOwner: vi.fn(async () => "inst1"),
  grantCredits: vi.fn(async () => 5),
  isByomActive: vi.fn(async () => false),
  isDbConfigured: () => true,
  listWatchedRepos: vi.fn(),
  persistScanReport: vi.fn(),
  persistTeamStandings: vi.fn(async () => false),
  recordScanOutcome: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/app", () => ({
  getInstallationToken: vi.fn(async () => "tok"),
  isAppConfigured: () => true,
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  // Default: the target org IS a fleet org (not personal), so this suite's bulk-scan scenarios pass the
  // gate unimpeded. requireFleetOrg's own deny logic is exercised where the personal-workspace tests live.
  requireFleetOrg: vi.fn(async () => null),
}));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 })),
  paymentRequired: vi.fn(),
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { consumeScanCredit, grantCredits, listWatchedRepos, persistScanReport, recordScanOutcome } from "@/lib/db";
import { checkScanEntitlement } from "@/lib/entitlement";
// Real (unmocked) process-local claim — the route imports it from the same sub-module, so a claim taken
// here is visible to the route, letting us simulate a concurrent in-flight run deterministically.
import { claimRepoScan, releaseRepoScan } from "@/lib/db/org-watch";

const mockScan = vi.mocked(scanRepository);
const mockConsume = vi.mocked(consumeScanCredit);
const mockGrant = vi.mocked(grantCredits);
const mockList = vi.mocked(listWatchedRepos);
const mockPersist = vi.mocked(persistScanReport);
const mockEntitlement = vi.mocked(checkScanEntitlement);
const mockRecordOutcome = vi.mocked(recordScanOutcome);

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
  ({ scanId: "s1", deduped }) as Awaited<
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

describe("POST /api/org/scan — per-repo in-flight claim (no double-scan/charge)", () => {
  // The money defect (org-import-scan-watchlist #1): a bulk scan that overlaps another in-flight run
  // (a second tab / another member / an overlapping import) must NOT re-scan and re-charge a repo the
  // other run already owns. The route claims each repo before reserving/scanning and skips a live claim.
  it("skips a repo a concurrent run already claimed — no scan, no credit — then scans once released", async () => {
    mockScan.mockResolvedValue(report("gemini"));
    mockPersist.mockResolvedValue(persisted(false));
    // Stand in for the concurrent run: it already holds the claim for the org's single watched repo.
    const held = claimRepoScan("acme", "acme/repo");
    expect(held).not.toBeNull();

    const body1 = await runBulkScan();
    // Money invariant: the contended repo is neither scanned (no real inference) nor charged.
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockGrant).not.toHaveBeenCalled();
    expect(body1).toContain('"skipped":"in_progress"'); // the skip is surfaced, not silent
    // ambiguity-ui 2026-07-16 #4: the final result must not count the claim-skip as scanned — the
    // old shared counter reported { scanned: 1 } for a run in which zero scans happened.
    expect(body1).toContain('"scanned":0');
    expect(body1).toContain('"skippedInProgress":1');

    // The other run completes and frees the repo; a fresh scan now proceeds and bills exactly once.
    releaseRepoScan("acme", "acme/repo", held!);
    const body2 = await runBulkScan();
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(body2).not.toContain('"skipped":"in_progress"');
    expect(body2).toContain('"scanned":1');
  });

  it("releases the claim after a normal run, so a repo isn't locked out of the next scan", async () => {
    mockScan.mockResolvedValue(report("gemini"));
    mockPersist.mockResolvedValue(persisted(false));
    await runBulkScan(); // the route claims acme/repo, scans, and must release it in its finally
    expect(mockScan).toHaveBeenCalledTimes(1);
    // If the route leaked the claim, this second run would skip as in_progress. It must scan again.
    const body = await runBulkScan();
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(body).not.toContain('"skipped":"in_progress"');
  });
});

// ---------------------------------------------------------------------------
// Time-budget truncation. The whole batch runs inside one request's ReadableStream under
// `maxDuration = 300`, and the platform kill is a PROCESS kill — no throw, no `finally`, no final
// frame — so a fleet that outgrew one invocation used to reach the user as a bare "Network error."
// for a run that had actually scanned and PERSISTED most of it. These pin the honest alternative:
// stop issuing new repos in time, name the remainder, and leave it untouched (not failed).
describe("POST /api/org/scan — time-budget truncation", () => {
  const REPOS = ["acme/a", "acme/b", "acme/c", "acme/d", "acme/e", "acme/f"];
  let clock = 0;
  let nowSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    clock = 0;
    // Synthetic clock: only a scan advances it, so the deadline arithmetic is fully deterministic
    // (no sleeps, no real timers). Four lanes claim before any observation exists; each "costs"
    // 100s, so the first completion projects past the 300s ceiling and the tail is never issued.
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    mockList.mockResolvedValue(
      REPOS.map((fullName) => ({ fullName, lastScanAt: null })) as unknown as Awaited<
        ReturnType<typeof listWatchedRepos>
      >,
    );
    // Unlimited plan: the credit slice must not confound the deadline arithmetic.
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: true, balance: 0, allowanceRemaining: 0 });
    mockScan.mockImplementation(async () => {
      clock += 100_000;
      return report("gemini");
    });
    mockPersist.mockResolvedValue(persisted(false));
  });

  afterEach(() => {
    nowSpy?.mockRestore();
  });

  it("emits an explicit truncation frame with scanned/remaining counts and the remainder's names", async () => {
    const body = await runBulkScan();

    expect(body).toContain("event: truncated");
    const frame = body.split("\n\n").find((f) => f.includes("event: truncated"))!;
    const data = JSON.parse(frame.match(/^data: (.+)$/m)![1]!) as {
      reason: string;
      scanned: number;
      remaining: number;
      total: number;
      repos: string[];
    };
    expect(data.reason).toBe("time_budget");
    expect(data.total).toBe(REPOS.length);
    // 4 lanes were issued before the guard fired; the tail is the exact, contiguous remainder.
    expect(data.scanned).toBe(4);
    expect(data.remaining).toBe(2);
    expect(data.repos).toEqual(["acme/e", "acme/f"]);
    // The final result carries the same verdict, so a machine consumer isn't left inferring it.
    expect(body).toContain('"truncated":true');
  });

  it("does NOT mark the unreached repos failed — no scan, no outcome row, no error frame", async () => {
    const body = await runBulkScan();

    // The tail was never issued: no inference, and critically no persisted failure that would make a
    // healthy repo look broken on the dashboard (or take the 6h autoscan backoff).
    expect(mockScan).toHaveBeenCalledTimes(4);
    const scannedRepos = mockScan.mock.calls.map((c) => c[0]);
    expect(scannedRepos).not.toContain("acme/e");
    expect(scannedRepos).not.toContain("acme/f");
    const outcomeRepos = mockRecordOutcome.mock.calls.map((c) => c[1]);
    expect(outcomeRepos).not.toContain("acme/e");
    expect(outcomeRepos).not.toContain("acme/f");
    // A truncation is not a stream failure: the generic error surface must stay clear.
    expect(body).not.toContain("event: error");
  });

  it("reports NO truncation when the whole fleet fits the budget (small fleets are never stopped early)", async () => {
    mockScan.mockImplementation(async () => {
      clock += 100; // fast repos — the projection always fits
      return report("gemini");
    });
    const body = await runBulkScan();
    expect(mockScan).toHaveBeenCalledTimes(REPOS.length);
    expect(body).not.toContain("event: truncated");
    expect(body).toContain('"truncated":false');
  });
});

// The "Continue" affordance is only honest if continuing is genuinely cheap. Two mechanisms make it
// so, and both are verified here against the ACTUAL code rather than assumed by the UI copy:
//   • the continuation is scoped to the named remainder, so finished repos aren't re-driven at all;
//   • should one be re-driven anyway (an overlapping run, a stale remainder), the unchanged-commit
//     dedup refunds the credit — a dedup run is free.
describe("POST /api/org/scan — continuing a truncated run does not re-charge", () => {
  async function scanScoped(repos: string[]) {
    const res = await POST(
      new Request("http://localhost/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: "acme", repos }),
      }),
    );
    return res.text();
  }

  beforeEach(() => {
    mockList.mockResolvedValue([
      { fullName: "acme/done", lastScanAt: null },
      { fullName: "acme/left", lastScanAt: null },
    ] as unknown as Awaited<ReturnType<typeof listWatchedRepos>>);
    mockEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5, allowanceRemaining: 0 });
    mockScan.mockResolvedValue(report("gemini"));
    mockPersist.mockResolvedValue(persisted(false));
  });

  it("walks ONLY the named remainder — the repos the truncated run already scanned are not re-scanned", async () => {
    const body = await scanScoped(["acme/left"]);
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(mockScan.mock.calls[0][0]).toBe("acme/left");
    expect(mockConsume).toHaveBeenCalledTimes(1); // exactly one repo billed — nothing double-charged
    expect(body).toContain('"total":1');
  });

  it("refunds rather than re-charges when a continued repo dedupes on an unchanged commit", async () => {
    mockPersist.mockResolvedValue(persisted(true)); // unchanged commit ⇒ no new scored row
    await scanScoped(["acme/done"]);
    expect(mockConsume).toHaveBeenCalledTimes(1);
    // Net zero: the reservation is handed straight back, which is what makes "click to continue" safe
    // to offer even when the remainder overlaps work another run already finished.
    expect(mockGrant).toHaveBeenCalledWith("acme", 1, { reason: "refund", actor: "system" });
  });

  it("skips a repo another in-flight run still owns instead of re-scanning it", async () => {
    const held = claimRepoScan("acme", "acme/left");
    const body = await scanScoped(["acme/left"]);
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    expect(body).toContain('"skipped":"in_progress"');
    releaseRepoScan("acme", "acme/left", held!);
  });
});
