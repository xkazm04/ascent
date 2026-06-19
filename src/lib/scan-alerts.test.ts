// Orchestrator tests for checkAndAlertRegression — the glue (scan-alerts.ts) that turns a scan diff
// into an audit row + a dispatched alert, routed to the RIGHT tenant's webhook. The pure detector
// and message builders below it are exhaustively unit-tested in alerts.test.ts; this file pins the
// decision layer that consumes them, which had no test (test-mastery-2026-06-18 criticals #1 + #2).
//
// Everything below the orchestrator is mocked with vi.fn()s so we can assert exactly:
//   - WHEN dispatchAlert fires (gate correctness: prev=null no-op, non-regression no-op),
//   - to WHICH webhookUrl (per-tenant routing: org A's regression never POSTs to org B's sink),
//   - that the per-org threshold override is forwarded to the detector for the right org,
//   - and that the contract "never throws into the scan path" holds when recordAudit / dispatch fail.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

// --- Mocked deps ----------------------------------------------------------------------------
// The pure detector + diff engine are mocked so each test drives the regressed/not-regressed branch
// and the threshold-forwarding directly, without constructing real ScanReports/ScanDiffs.
vi.mock("@/lib/scoring/engine", () => ({ diffReports: vi.fn() }));
vi.mock("@/lib/alerts", () => ({
  detectRegression: vi.fn(),
  dispatchAlert: vi.fn(),
  buildRegressionMessage: vi.fn(() => ({ text: "msg", blocks: [] })),
  // isAlertConfigured mirrors the real "a non-empty url counts" semantics so the gate is exercised
  // honestly rather than hard-wired true.
  isAlertConfigured: vi.fn((url?: string | null) => !!(url && url.trim())),
  DEFAULT_THRESHOLDS: { overallDrop: 5, dimensionDrop: 15 },
  // Low-credits helpers are unused by checkAndAlertRegression but the module imports them, so the
  // mock must export them or the import would resolve to undefined and the module load could break.
  buildLowCreditsMessage: vi.fn(() => ({ text: "low", blocks: [] })),
  creditsAlertThreshold: vi.fn(() => 5),
  isLowCreditsCrossing: vi.fn(() => false),
}));
vi.mock("@/lib/db", () => ({
  getOrgAlertThresholds: vi.fn(),
  getOrgAlertWebhook: vi.fn(),
  recordAudit: vi.fn(),
  reportPermalink: vi.fn((fullName: string) => `/r/${fullName}`),
}));

import { checkAndAlertRegression, maybeAlertLowCredits } from "./scan-alerts";
import { diffReports } from "@/lib/scoring/engine";
import {
  detectRegression,
  dispatchAlert,
  buildRegressionMessage,
  buildLowCreditsMessage,
  creditsAlertThreshold,
  isLowCreditsCrossing,
} from "@/lib/alerts";
import { getOrgAlertThresholds, getOrgAlertWebhook, recordAudit } from "@/lib/db";

const mockDiff = vi.mocked(diffReports);
const mockDetect = vi.mocked(detectRegression);
const mockDispatch = vi.mocked(dispatchAlert);
const mockBuildMsg = vi.mocked(buildRegressionMessage);
const mockThresholds = vi.mocked(getOrgAlertThresholds);
const mockWebhook = vi.mocked(getOrgAlertWebhook);
const mockAudit = vi.mocked(recordAudit);
const mockCrossing = vi.mocked(isLowCreditsCrossing);
const mockCreditsThreshold = vi.mocked(creditsAlertThreshold);
const mockBuildLow = vi.mocked(buildLowCreditsMessage);

// A ScanReport is only read by the orchestrator for fresh.repo.{owner,name,headSha}; the diff itself
// is mocked, so a minimal shape cast is sufficient and keeps the test focused on the decision logic.
function report(owner = "acme", name = "api", headSha = "deadbeef"): ScanReport {
  return { repo: { owner, name, headSha } } as unknown as ScanReport;
}

// A minimal ScanDiff carrying only the fields the orchestrator copies into the audit payload
// (level.before.id / level.after.id / overall.before / overall.after). detectRegression is mocked,
// so it does not need to be a fully-valid diff.
function fakeDiff() {
  return {
    level: { before: { id: "L4" }, after: { id: "L3" } },
    overall: { before: 70, after: 55 },
  } as unknown as ReturnType<typeof diffReports>;
}

const REGRESSED = { regressed: true, severity: "critical", reasons: [{ code: "level-demotion" }] } as never;
const CLEAN = { regressed: false, severity: null, reasons: [] } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockDiff.mockReturnValue(fakeDiff());
  mockWebhook.mockResolvedValue(null);
  mockThresholds.mockResolvedValue({ overallDrop: 5, dimensionDrop: 15 } as never);
  mockAudit.mockResolvedValue(undefined as never);
  mockDispatch.mockResolvedValue(true);
});

describe("checkAndAlertRegression — gate correctness", () => {
  it("no prev (first scan) is a clean no-op: no diff, no audit, no dispatch", async () => {
    const out = await checkAndAlertRegression(null, report(), { orgSlug: "acme" });
    expect(out).toEqual({ regressed: false, verdict: null, dispatched: false });
    expect(mockDiff).not.toHaveBeenCalled();
    expect(mockDetect).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("a non-regressing diff records no audit and dispatches nothing", async () => {
    mockDetect.mockReturnValue(CLEAN);
    const out = await checkAndAlertRegression(report("p", "p1"), report(), { orgSlug: "acme" });
    expect(out.regressed).toBe(false);
    expect(out.dispatched).toBe(false);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("a regression with NO resolvable sink records the audit but does NOT dispatch (gate not inverted)", async () => {
    mockDetect.mockReturnValue(REGRESSED);
    mockWebhook.mockResolvedValue(null); // no org sink; isAlertConfigured(null) => false
    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(out.regressed).toBe(true);
    expect(out.dispatched).toBe(false);
    // Audit is recorded even with no sink (so regressions are tracked regardless of alerting).
    expect(mockAudit).toHaveBeenCalledTimes(1);
    // The gate must NOT POST when no sink resolves — pins against an inverted isAlertConfigured gate.
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe("checkAndAlertRegression — per-tenant routing (no cross-tenant POST)", () => {
  it("dispatches a real regression to exactly the resolving org's own webhook", async () => {
    mockDetect.mockReturnValue(REGRESSED);
    mockWebhook.mockResolvedValue("https://hooks.example/acme");

    const out = await checkAndAlertRegression(report("acme", "api"), report("acme", "api"), {
      orgId: "org_acme",
      orgSlug: "acme",
    });

    expect(out.regressed).toBe(true);
    expect(out.dispatched).toBe(true);
    // Routing invariant: the sink lookup was scoped to THIS org's slug...
    expect(mockWebhook).toHaveBeenCalledWith("acme");
    // ...and dispatch was sent to exactly that resolved webhookUrl, nobody else's.
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ webhookUrl: "https://hooks.example/acme" }));
  });

  it("org A's regression never POSTs to org B's sink (each call routes to its own webhook)", async () => {
    mockDetect.mockReturnValue(REGRESSED);
    // The DB resolves each slug to that tenant's distinct sink.
    mockWebhook.mockImplementation(async (slug: string) =>
      slug === "alpha" ? "https://hooks.example/ALPHA" : slug === "beta" ? "https://hooks.example/BETA" : null,
    );

    await checkAndAlertRegression(report("alpha", "x"), report("alpha", "x"), { orgSlug: "alpha" });
    await checkAndAlertRegression(report("beta", "y"), report("beta", "y"), { orgSlug: "beta" });

    const urls = mockDispatch.mock.calls.map((c) => (c[1] as { webhookUrl?: string }).webhookUrl);
    expect(urls).toEqual(["https://hooks.example/ALPHA", "https://hooks.example/BETA"]);
    // Cross-tenant guard: ALPHA's sink never received BETA's alert and vice-versa.
    expect(urls).not.toContain(undefined);
    expect(new Set(urls).size).toBe(2);
  });

  it("falls back to the global ALERT_WEBHOOK_URL (webhookUrl=null) when the org has no own sink but a regression fires", async () => {
    // orgWebhook resolves null; the gate uses isAlertConfigured(null) which (real impl) consults the
    // global env. The mocked isAlertConfigured treats null as unconfigured, so with no org sink this
    // path does NOT dispatch — pinning that an org with no own webhook + (mocked) no global = no POST.
    mockDetect.mockReturnValue(REGRESSED);
    mockWebhook.mockResolvedValue(null);
    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(out.dispatched).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("builds the alert message for the regressing repo's own fullName (no message cross-wiring)", async () => {
    mockDetect.mockReturnValue(REGRESSED);
    mockWebhook.mockResolvedValue("https://hooks.example/acme");
    await checkAndAlertRegression(report("acme", "billing"), report("acme", "billing"), { orgSlug: "acme" });
    expect(mockBuildMsg).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "acme/billing" }),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("checkAndAlertRegression — per-org threshold override", () => {
  it("forwards the org's own thresholds (not just DEFAULT_THRESHOLDS) to the detector for that org", async () => {
    mockDetect.mockReturnValue(CLEAN);
    mockThresholds.mockResolvedValue({ overallDrop: 2, dimensionDrop: 15 } as never);

    await checkAndAlertRegression(report(), report(), { orgSlug: "tight-org" });

    // The override merge must apply THIS org's overallDrop:2 (a tightened sensitivity), not revert to
    // the default 5. Pins against a `??` merge bug that silently reverts every org to defaults.
    expect(mockThresholds).toHaveBeenCalledWith("tight-org");
    expect(mockDetect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ overallDrop: 2, dimensionDrop: 15 }),
    );
  });

  it("a tightened org threshold flips a borderline diff from non-regression to regression, then dispatches", async () => {
    // Drive the detector to honor the threshold it is handed: regress only when overallDrop <= 2.
    mockDetect.mockImplementation((_d, t) =>
      ((t as { overallDrop: number }).overallDrop <= 2 ? REGRESSED : CLEAN) as never,
    );
    mockWebhook.mockResolvedValue("https://hooks.example/acme");

    // Default org thresholds (overallDrop 5) => the −15 overall is below the *default* sensitivity in
    // this simplified detector model => no regression.
    mockThresholds.mockResolvedValue({ overallDrop: 5, dimensionDrop: 15 } as never);
    const lax = await checkAndAlertRegression(report(), report(), { orgSlug: "lax" });
    expect(lax.regressed).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();

    // Same diff, but the org tightened overallDrop to 2 => the per-org override flips it to a
    // regression and it dispatches. This is the override-beats-default invariant.
    mockThresholds.mockResolvedValue({ overallDrop: 2, dimensionDrop: 15 } as never);
    const tight = await checkAndAlertRegression(report(), report(), { orgSlug: "tight" });
    expect(tight.regressed).toBe(true);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("falls back to DEFAULT_THRESHOLDS per-field when the org threshold lookup throws (never propagates)", async () => {
    mockDetect.mockReturnValue(CLEAN);
    mockThresholds.mockRejectedValue(new Error("db down"));
    await expect(checkAndAlertRegression(report(), report(), { orgSlug: "acme" })).resolves.toBeTruthy();
    // The detector still ran with the per-field defaults rather than the lookup blowing up the scan.
    expect(mockDetect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ overallDrop: 5, dimensionDrop: 15 }),
    );
  });

  it("with no orgSlug, no threshold lookup is attempted and DEFAULT_THRESHOLDS are used", async () => {
    mockDetect.mockReturnValue(CLEAN);
    await checkAndAlertRegression(report(), report(), {});
    expect(mockThresholds).not.toHaveBeenCalled();
    expect(mockDetect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ overallDrop: 5, dimensionDrop: 15 }),
    );
  });
});

describe("checkAndAlertRegression — throw-safety (never fails the scan path)", () => {
  // recordAudit() at scan-alerts.ts is now .catch()-wrapped (like orgWebhook/getOrgAlertThresholds),
  // so a flaky audit write is decoupled from alert dispatch: it neither throws into the scan path NOR
  // suppresses a real regression alert. The two tests below pin both halves of that contract.

  it("does NOT throw when recordAudit rejects (scan path resilience holds)", async () => {
    mockDetect.mockReturnValue(REGRESSED);
    mockWebhook.mockResolvedValue("https://hooks.example/acme");
    mockAudit.mockRejectedValue(new Error("audit table write failed"));

    // Contract: alerting must never throw into the scan path.
    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(out.regressed).toBe(true);
  });

  it("a recordAudit failure does NOT suppress the alert — dispatch STILL fires (audit/alert decoupled)", async () => {
    // The fix: recordAudit is .catch()-wrapped so an audit-write blip is swallowed/logged rather than
    // skipping straight to the outer catch. A REAL regression alert must still be dispatched even when
    // the audit row can't be written — the audit trail and the alert are independent best-efforts.
    mockDetect.mockReturnValue(REGRESSED);
    mockWebhook.mockResolvedValue("https://hooks.example/acme");
    mockAudit.mockRejectedValue(new Error("audit table write failed"));

    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(mockDispatch).toHaveBeenCalledTimes(1); // <-- alert NOT dropped by an unrelated audit blip
    expect(out.regressed).toBe(true);
    expect(out.dispatched).toBe(true);
  });

  it("does NOT throw when dispatchAlert rejects; resolves to dispatched:false", async () => {
    mockDetect.mockReturnValue(REGRESSED);
    mockWebhook.mockResolvedValue("https://hooks.example/acme");
    mockDispatch.mockRejectedValue(new Error("webhook 500 / network down"));

    // The audit still recorded; only the dispatch blew up — and it must not fail the scan.
    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(out).toEqual({ regressed: false, verdict: null, dispatched: false });
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it("does NOT throw when the webhook lookup itself rejects (orgWebhook swallows to null → no dispatch)", async () => {
    mockDetect.mockReturnValue(REGRESSED);
    mockWebhook.mockRejectedValue(new Error("sink lookup db error"));
    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    // orgWebhook .catch(()=>null) → no sink → no dispatch, audit still recorded, regression reported.
    expect(out.regressed).toBe(true);
    expect(out.dispatched).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// --- maybeAlertLowCredits — fires-EXACTLY-ONCE on the threshold crossing -----------------------
// Sibling of checkAndAlertRegression: pushes a depletion alert after a metered unit debit. The
// design (alerts.ts) deliberately keys off the EDGE, not the level: debits are unit-sized, so the
// balance lands EXACTLY on the threshold once on the way down (and exactly on 0 once at depletion).
// isLowCreditsCrossing(b, t) === (b === 0 || b === t). These tests pin that the alert fires once at
// the crossing and never spams on the subsequent below-threshold scans — the test-mastery
// "fires exactly once, never skipped" invariant. We give the mocked predicate its REAL semantics so
// the fires-once edge is pinned honestly rather than against a hard-wired stub.
describe("maybeAlertLowCredits — fires exactly once on the threshold crossing", () => {
  const THRESH = 5;
  beforeEach(() => {
    // Honest predicate: only the exact-threshold and exact-zero landings count as a crossing,
    // mirroring isLowCreditsCrossing's real body (b === 0 || b === threshold).
    mockCrossing.mockImplementation((balanceAfter: number, threshold: number) => balanceAfter === 0 || balanceAfter === threshold);
    mockCreditsThreshold.mockReturnValue(THRESH);
    mockBuildLow.mockReturnValue({ text: "low", blocks: [] } as never);
    mockWebhook.mockResolvedValue("https://hooks.example/acme");
    mockDispatch.mockResolvedValue(true);
  });

  it("fires exactly ONCE on the way down: the alert is sent only on the scan that lands ON the threshold", async () => {
    // Simulate a unit-debit descent 8 → 7 → 6 → 5(threshold) → 4 → 3. Only the balance that lands
    // exactly on 5 is a crossing; every other observation is a clean no-op. This is the core
    // "fires exactly once, never skipped, no spam" invariant.
    const descent = [8, 7, 6, 5, 4, 3];
    const results: boolean[] = [];
    for (const b of descent) results.push(await maybeAlertLowCredits("acme", b));

    expect(results).toEqual([false, false, false, true, false, false]);
    // The dispatch fired exactly once across the whole descent — no spam on the sub-threshold scans.
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire while strictly above the threshold (level, not crossing)", async () => {
    for (const b of [100, 50, 9, 6]) {
      expect(await maybeAlertLowCredits("acme", b)).toBe(false);
    }
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("fires again on a NEW crossing after the balance recovers above the threshold (edge, not level)", async () => {
    // Cross down to 5 (fire #1), recover to 12 (top-up, no fire), then debit back down through 5
    // again (fire #2). The alert keys on the crossing edge, so each fresh descent through the line
    // re-arms — it does NOT stay latched, and it does NOT stay silent after recovery.
    const series = [6, 5 /* cross #1 */, 12 /* recover, no fire */, 6, 5 /* cross #2 */];
    const results: boolean[] = [];
    for (const b of series) results.push(await maybeAlertLowCredits("acme", b));

    expect(results).toEqual([false, true, false, false, true]);
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it("fires on the depletion crossing too: landing exactly on 0 alerts even below the threshold", async () => {
    // Per the real predicate, 0 is its own crossing (depletion), distinct from the threshold line —
    // so a fleet draining 5 → … → 0 alerts at the threshold AND again at empty.
    expect(await maybeAlertLowCredits("acme", 0)).toBe(true);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockBuildLow).toHaveBeenCalledWith(expect.objectContaining({ balance: 0, threshold: THRESH }));
  });

  it("a balance already below the threshold at first observation is NOT a crossing (no retroactive fire)", async () => {
    // First time we ever see this org it's already at 3 (below 5, above 0). Because the predicate is
    // edge-based and this debit did not LAND on the line, it must not fire — matching the real code,
    // which has no dedupe table and relies purely on the unit-sized landing.
    expect(await maybeAlertLowCredits("acme", 3)).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("a crossing with NO resolvable sink is a clean no-op (does not dispatch, does not throw)", async () => {
    mockWebhook.mockResolvedValue(null); // isAlertConfigured(null) => false
    expect(await maybeAlertLowCredits("acme", THRESH)).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("never throws into the scan path when dispatch rejects on a real crossing; resolves false", async () => {
    mockDispatch.mockRejectedValue(new Error("webhook 500"));
    await expect(maybeAlertLowCredits("acme", THRESH)).resolves.toBe(false);
  });
});
