// Route test for the unattended autoscan cron (GET /api/cron/rescan). This is the only fully
// unattended scan path — no human watching an SSE stream — and every guard here is "fail-closed"
// or "claim-before-spend", precisely the logic that looks fine in review but only a FAILURE-path
// test catches when it silently flips. We pin three money/token invariants:
//   (1) AUTH GATE — a missing CRON_SECRET fails closed (503) and a wrong bearer/key is rejected
//       (401); in neither case does any scan/claim/listDue run (the gate already regressed to
//       fail-open once, so we pin it shut from both sides).
//   (2) CLAIM-BEFORE-SCAN — a repo is claimed (CAS) before scanRepository runs; an already-claimed
//       repo (claimRescan→false) is skipped and never scanned, so two cron passes can't double-bill.
//   (3) REFUND — when a claimed+charged scan throws, the reserved credit is refunded exactly once;
//       a successful real scan is NOT refunded.
// The db / github-app / scan / alert boundaries are mocked so we can assert exactly which spend
// primitives fire. The real mapPool is used (it's the fan-out under every fleet scan).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DueRescan } from "@/lib/db";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/scan-alerts", () => ({
  checkAndAlertRegression: vi.fn(),
  maybeAlertLowCredits: vi.fn(),
}));
vi.mock("@/lib/github/app", () => ({
  getInstallationToken: vi.fn(),
  isAppConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/db", () => ({
  CREDIT_REASON: { SCAN: "scan", GRANT: "grant", ADJUSTMENT: "adjustment", REFUND: "refund", POLAR_REFUND: "polar-refund" },
  isDbConfigured: vi.fn(() => true),
  listDueRescans: vi.fn(),
  claimRescan: vi.fn(),
  consumeScanCredit: vi.fn(),
  grantCredits: vi.fn(),
  advanceScheduleAfterFailure: vi.fn(),
  advanceToFullCadence: vi.fn(),
  recordScanOutcome: vi.fn(),
  persistScanReport: vi.fn(),
  getScanReportByCommit: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
  getOrgId: vi.fn(),
  isByomActive: vi.fn(async () => false),
}));

import { GET } from "./route";
import { scanRepository } from "@/lib/scan";
import {
  isDbConfigured,
  listDueRescans,
  claimRescan,
  consumeScanCredit,
  grantCredits,
  advanceScheduleAfterFailure,
  advanceToFullCadence,
  recordScanOutcome,
  persistScanReport,
  getScanReportByCommit,
  getInstallationIdForOwner,
  getOrgId,
  isByomActive,
} from "@/lib/db";
import { isAppConfigured, getInstallationToken } from "@/lib/github/app";
import { checkAndAlertRegression, maybeAlertLowCredits } from "@/lib/scan-alerts";

const mockScan = vi.mocked(scanRepository);
const mockIsDb = vi.mocked(isDbConfigured);
const mockListDue = vi.mocked(listDueRescans);
const mockClaim = vi.mocked(claimRescan);
const mockConsume = vi.mocked(consumeScanCredit);
const mockGrant = vi.mocked(grantCredits);
const mockAdvanceFail = vi.mocked(advanceScheduleAfterFailure);
const mockAdvanceCadence = vi.mocked(advanceToFullCadence);
const mockRecord = vi.mocked(recordScanOutcome);
const mockPersist = vi.mocked(persistScanReport);
const mockPrevReport = vi.mocked(getScanReportByCommit);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockOrgId = vi.mocked(getOrgId);
const mockByom = vi.mocked(isByomActive);
const mockIsApp = vi.mocked(isAppConfigured);
const mockToken = vi.mocked(getInstallationToken);

const SECRET = "cron-secret-xyz";

const dueRepo = (over: Partial<DueRescan> = {}): DueRescan => ({
  orgSlug: "acme",
  fullName: "acme/repo",
  repoId: "repo-1",
  scanSchedule: "daily",
  ...over,
});

// A real (non-mock, non-deduped) scan report so the success path bills and does NOT refund.
const realReport = () =>
  ({ engine: { provider: "gemini", model: "m" }, warnings: [] }) as unknown as Awaited<
    ReturnType<typeof scanRepository>
  >;

function req(opts: { auth?: string; key?: string } = {}) {
  const url = opts.key ? `http://localhost/api/cron/rescan?key=${opts.key}` : "http://localhost/api/cron/rescan";
  return new Request(url, {
    method: "GET",
    headers: opts.auth ? { authorization: opts.auth } : {},
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/cron/rescan — auth gate, claim-before-scan, refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;

    // Sane "everything configured, one org, public-ish token path" defaults; individual tests override.
    mockIsApp.mockReturnValue(true);
    mockIsDb.mockReturnValue(true);
    mockListDue.mockResolvedValue([dueRepo()]);
    mockInstallId.mockResolvedValue(null); // no install → tokenless public path, never "broken"
    mockToken.mockResolvedValue(undefined);
    mockClaim.mockResolvedValue(true);
    mockConsume.mockResolvedValue({ ok: true, unlimited: false, balance: 4, charged: true } as never);
    mockScan.mockResolvedValue(realReport());
    mockPersist.mockResolvedValue({ scanId: "s1", deduped: false } as never);
    mockPrevReport.mockResolvedValue(null as never);
    mockOrgId.mockResolvedValue("org-1" as never);
    mockByom.mockResolvedValue(false); // metered org by default; BYOM tests override
    mockGrant.mockResolvedValue(undefined as never);
    mockRecord.mockResolvedValue(undefined as never);
    mockAdvanceFail.mockResolvedValue(undefined as never);
    mockAdvanceCadence.mockResolvedValue(undefined as never);
    vi.mocked(maybeAlertLowCredits).mockResolvedValue(undefined as never);
    vi.mocked(checkAndAlertRegression).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  // ---- (1) AUTH GATE ------------------------------------------------------

  it("fails CLOSED with 503 when CRON_SECRET is unset — and runs no scan/claim/listDue", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
    expect(mockListDue).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer with 401 — and runs no scan/claim/listDue", async () => {
    const res = await GET(req({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(mockListDue).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it("rejects a wrong ?key= with 401 — and runs no scan/claim/listDue", async () => {
    const res = await GET(req({ key: "nope" }));
    expect(res.status).toBe(401);
    expect(mockListDue).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("rejects a request with NO credential at all with 401", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockListDue).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("accepts a correct Bearer secret and proceeds to scan", async () => {
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    expect(res.status ?? 200).toBe(200);
    expect(mockListDue).toHaveBeenCalledTimes(1);
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it("accepts a correct ?key= secret and proceeds to scan", async () => {
    const res = await GET(req({ key: SECRET }));
    const body = await bodyOf(res);
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(body.scanned).toBe(1);
  });

  // ---- (2) CLAIM-BEFORE-SCAN ---------------------------------------------

  it("claims the repo BEFORE scanning it (CAS gate precedes the spend)", async () => {
    const order: string[] = [];
    mockClaim.mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    mockScan.mockImplementation(async () => {
      order.push("scan");
      return realReport();
    });
    await GET(req({ auth: `Bearer ${SECRET}` }));
    expect(order).toEqual(["claim", "scan"]);
    // and the claim is keyed to the specific due repo + its schedule
    expect(mockClaim).toHaveBeenCalledWith("repo-1", "daily");
  });

  it("skips an already-claimed repo: claimRescan=false → no scan, no charge, counted as skippedAlreadyClaimed", async () => {
    mockClaim.mockResolvedValue(false);
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
    expect(body.scanned).toBe(0);
    expect(body.skippedAlreadyClaimed).toBe(1);
  });

  it("with two overlapping due entries for the same repo, only the claimed one scans (no double-scan)", async () => {
    mockListDue.mockResolvedValue([dueRepo(), dueRepo()]);
    // First claim wins, second loses the CAS.
    mockClaim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(mockClaim).toHaveBeenCalledTimes(2);
    expect(mockScan).toHaveBeenCalledTimes(1); // claimed once → scanned once
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(body.skippedAlreadyClaimed).toBe(1);
  });

  // ---- (3) REFUND ---------------------------------------------------------

  it("refunds the reserved credit exactly once when a charged scan THROWS", async () => {
    mockScan.mockRejectedValue(new Error("boom"));
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith(
      "acme",
      1,
      expect.objectContaining({ reason: "refund" }),
    );
    expect(mockAdvanceFail).toHaveBeenCalledWith("repo-1"); // failure backoff applied
    expect(body.scanned).toBe(0);
    expect(Array.isArray(body.errors) && (body.errors as unknown[]).length).toBe(1);
  });

  it("does NOT refund a successful real (non-mock, non-deduped) scan", async () => {
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(body.scanned).toBe(1);
  });

  // ---- (3b) LEASE-THEN-SETTLE — a successful scan advances to the FULL cadence ----

  it("settles a successful scan to the full cadence (claim only LEASES; success advances)", async () => {
    // claimRescan now leases the repo for a short window so a timed-out run re-qualifies soon; a
    // successful scan must then advance it to its real cadence (and NOT take the failure backoff).
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(body.scanned).toBe(1);
    expect(mockAdvanceCadence).toHaveBeenCalledWith("repo-1", "daily");
    expect(mockAdvanceFail).not.toHaveBeenCalled();
  });

  it("does NOT advance to the full cadence when the scan THROWS (the short lease + 6h backoff stand)", async () => {
    mockScan.mockRejectedValue(new Error("boom"));
    await GET(req({ auth: `Bearer ${SECRET}` }));
    expect(mockAdvanceCadence).not.toHaveBeenCalled();
    expect(mockAdvanceFail).toHaveBeenCalledWith("repo-1");
  });

  it("a failed token mint gets the 6h failure backoff, NOT a full-cadence skip (ambiguity-ui #2)", async () => {
    // The org HAS an install id but the mint failed — which can be a GitHub blip / 5xx / rate limit,
    // not only a revoked install. Settling to the full cadence turned one transient bad minute into
    // a silent month-long skip for a monthly fleet; the failure backoff self-heals next pass while a
    // genuinely-revoked org still sits off the front of the queue.
    mockInstallId.mockResolvedValue("inst-1" as never);
    mockToken.mockResolvedValue(undefined); // mint failed
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(body.skippedNoToken).toBe(1);
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled(); // no credit reserved for a scan that can't run
    expect(mockAdvanceFail).toHaveBeenCalledWith("repo-1"); // transient-friendly 6h backoff
    expect(mockAdvanceCadence).not.toHaveBeenCalled(); // NOT a whole-cadence settle
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/repo", { ok: false, error: "installation token unavailable" });
  });

  it("does NOT refund when the scan was never charged (no reservation → no scan, no refund)", async () => {
    mockConsume.mockResolvedValue({ ok: false, unlimited: false, balance: 0 } as never);
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockGrant).not.toHaveBeenCalled();
    expect(body.skippedForCredits).toBe(1);
  });

  // ---- (4) UNMETERED PATHS (BYOM / public) — mirror the manual scan route's gate ----------

  it("does NOT charge a BYOM org (own Bedrock) — the autoscan still runs, free", async () => {
    mockByom.mockResolvedValue(true);
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    // reserveScanCredit (→ consumeScanCredit) is skipped entirely for a BYOM org, so no platform
    // credit is debited; the scan still happens and there's nothing to refund.
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(body.scanned).toBe(1);
    expect(body.skippedForCredits).toBe(0);
  });

  it("does NOT charge the shared public org — the autoscan still runs, free", async () => {
    mockListDue.mockResolvedValue([dueRepo({ orgSlug: "public", repoId: "pub-1" })]);
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    const body = await bodyOf(res);
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(body.scanned).toBe(1);
    expect(body.skippedForCredits).toBe(0);
  });

  // ---- (5) TIME BUDGET — the cron shares the 300s ceiling with /api/org/scan ----------------
  // Unattended, so the ONLY record of a pass is this JSON body. A run killed at the ceiling wrote
  // nothing at all; a run that stops itself must say how much of the due queue it never reached,
  // and must leave those repos genuinely untouched (unclaimed ⇒ still due ⇒ next pass takes them).

  it("stops issuing new repos at the budget and reports the untouched remainder honestly", async () => {
    let clock = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const due = ["r1", "r2", "r3", "r4", "r5", "r6"].map((id) => dueRepo({ repoId: id, fullName: `acme/${id}` }));
      mockListDue.mockResolvedValue(due);
      mockScan.mockImplementation(async () => {
        clock += 100_000; // 100s per repo — the first completion projects past the 300s ceiling
        return realReport();
      });

      const body = await bodyOf(await GET(req({ auth: `Bearer ${SECRET}` })));

      expect(body.due).toBe(6);
      expect(body.truncated).toBe(true);
      expect(body.scanned).toBe(4); // the four lanes that were already in flight
      expect(body.remaining).toBe(2);
      // The unreached repos were never CLAIMED — so nextScanAt is untouched, they stay due for the
      // next pass, and they are neither counted as failures nor pushed into the 6h backoff.
      expect(mockClaim).toHaveBeenCalledTimes(4);
      expect(mockAdvanceFail).not.toHaveBeenCalled();
      expect(body.errors).toEqual([]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("reports truncated:false for a pass that drained the whole due queue", async () => {
    mockListDue.mockResolvedValue([dueRepo(), dueRepo({ repoId: "repo-2", fullName: "acme/two" })]);
    const body = await bodyOf(await GET(req({ auth: `Bearer ${SECRET}` })));
    expect(body.truncated).toBe(false);
    expect(body.remaining).toBe(0);
    expect(body.scanned).toBe(2);
  });
});
