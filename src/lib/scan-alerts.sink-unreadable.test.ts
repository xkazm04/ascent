// @vitest-environment node
//
// The scan-side pushes against the REAL alert-delivery resolver and the REAL cooldown pool.
//
// scan-alerts.test.ts mocks `resolveAlertWebhook` as `(url) => url || null`, which ignores the global
// ALERT_WEBHOOK_URL, so the defect this file pins could not be observed there: a sink lookup that
// THREW was swallowed into null, the resolver read that null as "no org sink, use the operator's
// global one", and a tenant's regression / credit alert was POSTed into the operator's channel (with
// a history row saying delivered=true). Here the resolver, the transport (down to `fetch`) and the
// claim pool are real; only the diff, the verdict and the storage are driven.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("@/lib/scoring/engine", () => ({ diffReports: vi.fn() }));
vi.mock("@/lib/alerts", async (orig) => ({
  ...(await orig<typeof import("@/lib/alerts")>()),
  detectRegression: vi.fn(),
  detectPromotion: vi.fn(() => ({ promoted: false, severity: null, reasons: [] })),
  buildRegressionMessage: vi.fn(() => ({ text: "regressed", blocks: [] })),
  buildPromotionMessage: vi.fn(() => ({ text: "promoted", blocks: [] })),
}));
vi.mock("@/lib/db", () => ({
  getOrgAlertThresholds: vi.fn(async () => ({ overallDrop: 5, dimensionDrop: 15 })),
  getOrgAlertWebhook: vi.fn(async () => null as string | null),
  recordAudit: vi.fn(async () => undefined),
  recordAlertEvent: vi.fn(async () => true),
  reportPermalink: vi.fn((fullName: string) => `/r/${fullName}`),
  getAuditLog: vi.fn(async () => ({ entries: [] })),
}));
vi.mock("@/lib/db/scans-audit", () => ({ claimOrgAuditOnce: vi.fn(), releaseAuditClaim: vi.fn() }));
vi.mock("@/lib/db/control-observations", () => ({ listObservationsSince: vi.fn(async () => []) }));

import { checkAndAlertRegression, maybeAlertLowCredits } from "./scan-alerts";
import { diffReports } from "@/lib/scoring/engine";
import { __resetRegressionCooldowns, detectPromotion, detectRegression } from "@/lib/alerts";
import { getOrgAlertWebhook, recordAlertEvent } from "@/lib/db";
import { listObservationsSince } from "@/lib/db/control-observations";

const GLOBAL = "https://global.example/hook";
const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
const mockWebhook = vi.mocked(getOrgAlertWebhook);
const mockRecord = vi.mocked(recordAlertEvent);

function report(): ScanReport {
  return { repo: { owner: "acme", name: "api", headSha: "abc" }, scannedAt: "2026-09-20T00:00:00.000Z" } as unknown as ScanReport;
}
const DIFF = { level: { before: { id: "L4" }, after: { id: "L3" } }, overall: { before: 70, after: 55 }, dimensions: [] };
const REGRESSED = { regressed: true, severity: "critical", reasons: [{ code: "level-demotion", message: "L4 to L3" }] };
const CLEAN = { regressed: false, severity: null, reasons: [] };

function rowsOf(kind: string) {
  return mockRecord.mock.calls.filter(([, input]) => input.kind === kind);
}
function fetchedUrls(): string[] {
  return (fetchMock.mock.calls as unknown as [string][]).map((c) => String(c[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRegressionCooldowns();
  vi.stubEnv("ALERT_WEBHOOK_URL", GLOBAL);
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(diffReports).mockReturnValue(DIFF as never);
  vi.mocked(detectRegression).mockReturnValue(REGRESSED as never);
  vi.mocked(detectPromotion).mockReturnValue({ promoted: false, severity: null, reasons: [] } as never);
  mockWebhook.mockResolvedValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a sink lookup that FAILS never routes a tenant's alert to the global sink", () => {
  it("regression: no POST to the global URL, dispatched:false, one sink-unreadable row", async () => {
    mockWebhook.mockRejectedValue(new Error("db connection reset"));
    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(fetchedUrls()).not.toContain(GLOBAL);
    expect(out).toMatchObject({ regressed: true, dispatched: false });
    const rows = rowsOf("regression");
    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).toMatchObject({ delivered: false, suppressedReason: "sink-unreadable" });
  });

  it("low credits: no POST to the global URL, a sink-unreadable row", async () => {
    mockWebhook.mockRejectedValue(new Error("db connection reset"));
    const sent = await maybeAlertLowCredits("acme", 6, 5);
    expect(sent).toBe(false);
    expect(fetchedUrls()).not.toContain(GLOBAL);
    const rows = rowsOf("low-credits");
    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).toMatchObject({ delivered: false, suppressedReason: "sink-unreadable" });
  });

  it("guard: a genuine null sink column (read OK) still falls back to ALERT_WEBHOOK_URL", async () => {
    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(out.dispatched).toBe(true);
    expect(fetchedUrls()).toEqual([GLOBAL]);
    expect(rowsOf("regression")[0]![1]).toMatchObject({ delivered: true, sinkKind: "webhook", suppressedReason: null });
  });
});

describe("guards kept through the door", () => {
  it("guard: promotion and regression share one cooldown pool (the second push is cooldown)", async () => {
    mockWebhook.mockResolvedValue("https://hooks.example/acme");
    vi.mocked(detectRegression).mockReturnValue(CLEAN as never);
    vi.mocked(detectPromotion).mockReturnValue({ promoted: true, severity: "celebration", reasons: [] } as never);
    const up = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(up).toMatchObject({ promoted: true, dispatched: true });

    vi.mocked(detectRegression).mockReturnValue(REGRESSED as never);
    const down = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });
    expect(down).toMatchObject({ regressed: true, dispatched: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rowsOf("regression")[0]![1]).toMatchObject({ delivered: false, suppressedReason: "cooldown" });
  });

  it("guard: a control batch of ONLY control-unmeasurable items records a reasonless undelivered row and never dispatches", async () => {
    mockWebhook.mockResolvedValue("https://hooks.example/acme");
    vi.mocked(listObservationsSince).mockResolvedValue([
      {
        controlId: "branch-protection",
        repoFullName: "acme/api",
        state: "unmeasurable",
        value: null,
        prevState: "pass",
        prevValue: null,
        occurredAt: "2026-09-20T00:00:00.000Z",
        actorLogin: null,
        source: "scan",
      },
    ] as never);
    await checkAndAlertRegression(null, report(), { orgSlug: "acme" });
    expect(fetchMock).not.toHaveBeenCalled();
    const rows = rowsOf("control");
    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).toMatchObject({ delivered: false, suppressedReason: null });
  });
});
