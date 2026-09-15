// #16 → #1 — the wire between the regression detector and the `control` alert kind.
//
// FAIL-BEFORE: this module did not exist. `detectControlRegressions`, `buildControlAlertMessage`,
// `controlCooldownKey` and `dispatchAlert` all shipped in earlier waves with no call site between
// them, so a repo's own doctor could report `guardrail.never-commit` flipping pass → fail and
// nothing left the database.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/org-conformance", () => ({ listConformanceReports: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getOrgAlertWebhook: vi.fn(async () => "https://hooks.example.dev/x"),
  recordAlertEvent: vi.fn(async () => true),
}));
// The message builder, the cooldown key and the detector stay REAL — they are the behaviour under
// test. Only the outbound dispatch and the cooldown clock are controlled.
vi.mock("@/lib/alerts", async (orig) => ({
  ...(await orig<typeof import("@/lib/alerts")>()),
  dispatchAlert: vi.fn(async () => true),
}));

import { alertConformanceRegressions } from "./conformance-alerts";
import { listConformanceReports } from "@/lib/db/org-conformance";
import { getOrgAlertWebhook, recordAlertEvent } from "@/lib/db";
import { __resetRegressionCooldowns, dispatchAlert } from "@/lib/alerts";
import type { ConformanceReportRow } from "@/lib/standard/control-matrix";

const mockList = vi.mocked(listConformanceReports);
const mockWebhook = vi.mocked(getOrgAlertWebhook);
const mockEvent = vi.mocked(recordAlertEvent);
const mockDispatch = vi.mocked(dispatchAlert);

function rep(at: string, findings: ConformanceReportRow["findings"], summaryOnly = false): ConformanceReportRow {
  return {
    id: at,
    repoFullName: "acme/billing",
    headSha: null,
    score: 80,
    fails: 0,
    warns: 0,
    unchecked: 0,
    scored: 3,
    specVersion: "0.3.0",
    runShape: "plain",
    summaryOnly,
    reportedAt: at,
    findings,
  };
}

const PASSING = rep("2026-08-01T00:00:00.000Z", [{ check: "guardrail.never-commit", level: "pass", message: "" }]);
const FAILING = rep("2026-08-02T00:00:00.000Z", [{ check: "guardrail.never-commit", level: "fail", message: "secret pattern matched" }]);

beforeEach(() => {
  vi.clearAllMocks();
  __resetRegressionCooldowns();
  mockWebhook.mockResolvedValue("https://hooks.example.dev/x");
  mockDispatch.mockResolvedValue(true);
  mockEvent.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("alertConformanceRegressions", () => {
  it("dispatches a control push when a check goes pass -> fail", async () => {
    mockList.mockResolvedValue([FAILING, PASSING]); // newest-first

    expect(await alertConformanceRegressions("acme", "acme/billing")).toBe(true);

    const [message] = mockDispatch.mock.calls[0]!;
    expect(message.text).toContain("acme/billing");
    expect(message.text).toContain("guardrail.never-commit");
    // The source is stated: this came from the repo's OWN doctor, a different chain of custody from
    // a scan- or webhook-observed control.
    expect(message.text).toContain("observed via conformance");
  });

  it("writes the AlertEvent row whether or not a sink existed", async () => {
    mockList.mockResolvedValue([FAILING, PASSING]);
    mockWebhook.mockResolvedValue(null);

    expect(await alertConformanceRegressions("acme", "acme/billing")).toBe(false);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockEvent).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ kind: "control", severity: "critical", delivered: false, suppressedReason: "no-sink" }),
    );
  });

  it("throttles per (repo, control): the second identical regression is recorded, not re-pushed", async () => {
    mockList.mockResolvedValue([FAILING, PASSING]);
    await alertConformanceRegressions("acme", "acme/billing");
    mockDispatch.mockClear();

    await alertConformanceRegressions("acme", "acme/billing");

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockEvent).toHaveBeenLastCalledWith("acme", expect.objectContaining({ suppressedReason: "cooldown" }));
  });

  it("a DIFFERENT control on the same repo is not starved by the first one's cooldown", async () => {
    mockList.mockResolvedValue([FAILING, PASSING]);
    await alertConformanceRegressions("acme", "acme/billing");
    mockDispatch.mockClear();

    const otherFail = rep("2026-08-03T00:00:00.000Z", [{ check: "control.prepush.lint", level: "fail", message: "" }]);
    const otherPass = rep("2026-08-02T00:00:00.000Z", [{ check: "control.prepush.lint", level: "pass", message: "" }]);
    mockList.mockResolvedValue([otherFail, otherPass]);

    expect(await alertConformanceRegressions("acme", "acme/billing")).toBe(true);
  });

  it("does NOT alert on unchecked -> fail: a repo that started looking has broken nothing", async () => {
    const before = rep("2026-08-01T00:00:00.000Z", [{ check: "guardrail.never-commit", level: "unchecked", message: "" }]);
    mockList.mockResolvedValue([FAILING, before]);

    expect(await alertConformanceRegressions("acme", "acme/billing")).toBe(false);
    expect(mockEvent).not.toHaveBeenCalled();
  });

  it("does NOT alert on a first report, or against a summary-only predecessor", async () => {
    mockList.mockResolvedValue([FAILING]);
    expect(await alertConformanceRegressions("acme", "acme/billing")).toBe(false);

    mockList.mockResolvedValue([FAILING, rep("2026-08-01T00:00:00.000Z", [], true)]);
    expect(await alertConformanceRegressions("acme", "acme/billing")).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("never throws — a telemetry failure must not redden a customer's CI step", async () => {
    mockList.mockRejectedValue(new Error("db down"));
    await expect(alertConformanceRegressions("acme", "acme/billing")).resolves.toBe(false);

    mockList.mockResolvedValue([FAILING, PASSING]);
    mockDispatch.mockRejectedValue(new Error("webhook exploded"));
    await expect(alertConformanceRegressions("acme", "acme/billing")).resolves.toBe(false);
  });

  it("returns false without a database rather than inventing history", async () => {
    mockList.mockResolvedValue(null);
    expect(await alertConformanceRegressions("acme", "acme/billing")).toBe(false);
  });
});
