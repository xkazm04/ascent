// @vitest-environment node
//
// The scan-side alert glue degrades four best-effort reads by design — and each must stay degraded:
//   - the org's low-balance preference (getAuditLog) → the GLOBAL credits line,
//   - the whole control push (alertControlTransitions) → skipped, the regression path still runs,
//   - the org's alert thresholds (getOrgAlertThresholds) → DEFAULT_THRESHOLDS,
//   - the control ledger (listObservationsSince) → no transitions, nothing raised.
// The door sweep made every one of them visible (reportDegradedRead / degradeTo → console.warn +
// telemetry naming the read). Same harness as scan-alerts.sink-unreadable.test.ts: the alert door,
// the resolver and the transport (down to `fetch`) are real; the diff, verdict and storage are driven.

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
  getOrgAlertThresholds: vi.fn(async () => ({ overallDrop: 2, dimensionDrop: 3 })),
  getOrgAlertWebhook: vi.fn(async () => null as string | null),
  recordAudit: vi.fn(async () => undefined),
  recordAlertEvent: vi.fn(async () => true),
  reportPermalink: vi.fn((fullName: string) => `/r/${fullName}`),
  getAuditLog: vi.fn(async () => ({ entries: [] })),
}));
vi.mock("@/lib/db/scans-audit", () => ({ claimOrgAuditOnce: vi.fn(), releaseAuditClaim: vi.fn() }));
vi.mock("@/lib/db/control-observations", () => ({ listObservationsSince: vi.fn(async () => []) }));
// Real transitionsFromRows by default; one test makes it throw to reject alertControlTransitions.
vi.mock("@/lib/controls/transitions", async (orig) => {
  const actual = await orig<typeof import("@/lib/controls/transitions")>();
  return { ...actual, transitionsFromRows: vi.fn(actual.transitionsFromRows) };
});
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import { alertControlTransitions, checkAndAlertRegression, maybeAlertLowCredits } from "./scan-alerts";
import { diffReports } from "@/lib/scoring/engine";
import { __resetRegressionCooldowns, DEFAULT_THRESHOLDS, detectRegression } from "@/lib/alerts";
import { getAuditLog, getOrgAlertThresholds, recordAlertEvent } from "@/lib/db";
import { listObservationsSince } from "@/lib/db/control-observations";
import { transitionsFromRows } from "@/lib/controls/transitions";
import { reportHandledError } from "@/lib/api/respond";

const GLOBAL = "https://global.example/hook";
const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
const mockRecord = vi.mocked(recordAlertEvent);
const mockReport = vi.mocked(reportHandledError);
const mockDetect = vi.mocked(detectRegression);

function report(): ScanReport {
  return { repo: { owner: "acme", name: "api", headSha: "abc" }, scannedAt: "2026-09-20T00:00:00.000Z" } as unknown as ScanReport;
}
const DIFF = { level: { before: { id: "L4" }, after: { id: "L3" } }, overall: { before: 70, after: 55 }, dimensions: [] };
const REGRESSED = { regressed: true, severity: "critical", reasons: [{ code: "level-demotion", message: "L4 to L3" }] };

const rowsOf = (kind: string) => mockRecord.mock.calls.filter(([, input]) => input.kind === kind);
const doorFor = (read: string, err: unknown) =>
  expect(mockReport).toHaveBeenCalledWith(err, { message: expect.stringContaining(read) });

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetRegressionCooldowns();
  vi.stubEnv("ALERT_WEBHOOK_URL", GLOBAL);
  vi.stubEnv("CREDITS_ALERT_THRESHOLD", "5");
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(diffReports).mockReturnValue(DIFF as never);
  mockDetect.mockReturnValue(REGRESSED as never);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getOrgAlertThresholds door (checkAndAlertRegression)", () => {
  it("a thrown threshold read falls back to DEFAULT_THRESHOLDS, the regression still dispatches, the door fires", async () => {
    const boom = new Error("thresholds read failed");
    vi.mocked(getOrgAlertThresholds).mockRejectedValueOnce(boom);

    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });

    expect(mockDetect).toHaveBeenCalledWith(DIFF, {
      overallDrop: DEFAULT_THRESHOLDS.overallDrop,
      dimensionDrop: DEFAULT_THRESHOLDS.dimensionDrop,
    });
    expect(out).toMatchObject({ regressed: true, dispatched: true });
    doorFor("scan alerts: getOrgAlertThresholds", boom);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scan alerts: getOrgAlertThresholds"), boom);
  });

  it("guard: a healthy read forwards the org's own thresholds and opens no door", async () => {
    await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });

    expect(mockDetect).toHaveBeenCalledWith(DIFF, { overallDrop: 2, dimensionDrop: 3 });
    expect(mockReport).not.toHaveBeenCalled();
  });
});

describe("listObservationsSince door (alertControlTransitions)", () => {
  it("a thrown ledger read raises nothing (false, no control row) and reaches the door", async () => {
    const boom = new Error("ledger unreachable");
    vi.mocked(listObservationsSince).mockRejectedValueOnce(boom);

    await expect(alertControlTransitions(null, report(), { orgSlug: "acme" })).resolves.toBe(false);

    expect(rowsOf("control")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    doorFor("scan alerts: listObservationsSince", boom);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scan alerts: listObservationsSince"), boom);
  });
});

describe("alertControlTransitions door (checkAndAlertRegression's control push)", () => {
  it("a control push that throws is reported and does not suppress the regression path", async () => {
    const boom = new Error("transition fold blew up");
    vi.mocked(transitionsFromRows).mockImplementationOnce(() => {
      throw boom;
    });

    const out = await checkAndAlertRegression(report(), report(), { orgSlug: "acme" });

    expect(out).toMatchObject({ regressed: true, dispatched: true });
    expect(rowsOf("regression")).toHaveLength(1);
    expect(mockReport).toHaveBeenCalledTimes(1);
    doorFor("scan alerts: alertControlTransitions", boom);
  });
});

describe("org low-balance threshold door (maybeAlertLowCredits)", () => {
  it("guard: an opted-in org line (20) fires on 25 -> 18 when the preference reads fine", async () => {
    vi.mocked(getAuditLog).mockResolvedValueOnce({
      entries: [{ meta: { enabled: true, threshold: 20, packProductId: null } }],
    } as never);

    await expect(maybeAlertLowCredits("acme", 25, 18)).resolves.toBe(true);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("a thrown preference read falls back to the GLOBAL line (5) and reaches the door", async () => {
    const boom = new Error("audit log down");
    vi.mocked(getAuditLog).mockRejectedValue(boom);

    // 25 -> 18 crosses only the org's (unreadable) line, so on the global line it does not fire...
    await expect(maybeAlertLowCredits("acme", 25, 18)).resolves.toBe(false);
    // ...while 6 -> 5 crosses the global line and is pushed, titled with that line.
    await expect(maybeAlertLowCredits("acme", 6, 5)).resolves.toBe(true);
    expect(rowsOf("low-credits")[0]![1]).toMatchObject({ title: expect.stringContaining("(line: 5)") });

    expect(mockReport).toHaveBeenCalledTimes(2); // one door per failed read
    doorFor("scan alerts: org low-balance threshold", boom);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scan alerts: org low-balance threshold"), boom);
  });
});
