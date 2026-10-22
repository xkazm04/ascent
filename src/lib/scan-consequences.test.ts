// The one consequence seam (src/lib/scan-consequences.ts). What it must hold:
//
//   - NEVER REJECTS, STEP BY STEP: a throwing ledger reconcile costs neither the alert nor the memory
//     feed, and the caller's own bookkeeping (settleJob 'done') is untouched by it.
//   - A DEDUP IS NOT A NEW ROW: persistFleetScan over a deduped persist runs no consequence at all.
//   - THE FLOOR IS REFUSED: a degraded-to-mock report is never persisted; a REQUESTED mock is.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  getOrgId: vi.fn(),
  getScanReportByCommit: vi.fn(),
  persistScanReport: vi.fn(),
  checkAndAlertRegression: vi.fn(),
  recordScanMemories: vi.fn(),
  reconcilePracticeAdoption: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getOrgId: h.getOrgId,
  getScanReportByCommit: h.getScanReportByCommit,
  persistScanReport: h.persistScanReport,
}));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: h.checkAndAlertRegression }));
vi.mock("@/lib/memory/scan-feed", () => ({ recordScanMemories: h.recordScanMemories }));
vi.mock("@/lib/db/practice-adoption", () => ({ reconcilePracticeAdoption: h.reconcilePracticeAdoption }));
vi.mock("@/lib/scan-read-door", () => ({ degradeTo: (_: string, fallback: unknown) => () => fallback }));

import { persistFleetScan, runScanConsequences } from "./scan-consequences";
import type { ScanReport } from "@/lib/types";

const report = (provider = "sonnet") =>
  ({
    engine: { provider },
    repo: { owner: "acme", name: "api", headSha: "sha1" },
    practiceShape: { v: 2 },
    confidence: 0.9,
    overallScore: 70,
  }) as unknown as ScanReport;
const prev = { overallScore: 80 } as unknown as ScanReport;
const OUTCOME = { regressed: true, verdict: null };

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.getOrgId.mockResolvedValue("org_1");
  h.persistScanReport.mockResolvedValue({ deduped: false });
  h.checkAndAlertRegression.mockResolvedValue(OUTCOME);
  h.recordScanMemories.mockResolvedValue(undefined);
  h.reconcilePracticeAdoption.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runScanConsequences", () => {
  it("runs reconcile, then the alert, then the memories, once each, in that order", async () => {
    const r = report();
    await runScanConsequences(prev, r, { orgSlug: "acme", tag: "t" });
    expect(h.reconcilePracticeAdoption).toHaveBeenCalledWith("org_1", "acme/api", "sha1", { v: 2 });
    expect(h.checkAndAlertRegression).toHaveBeenCalledWith(prev, r, { orgId: "org_1", orgSlug: "acme" });
    expect(h.recordScanMemories).toHaveBeenCalledWith("org_1", prev, r, OUTCOME);
    const order = [h.reconcilePracticeAdoption, h.checkAndAlertRegression, h.recordScanMemories].map(
      (f) => f.mock.invocationCallOrder[0]!,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("a throwing reconcile resolves, and the alert and the memory feed still run", async () => {
    h.reconcilePracticeAdoption.mockRejectedValue(new Error("ledger down"));
    await expect(runScanConsequences(prev, report(), { orgSlug: "acme", tag: "t" })).resolves.toBeUndefined();
    expect(h.checkAndAlertRegression).toHaveBeenCalledTimes(1);
    expect(h.recordScanMemories).toHaveBeenCalledTimes(1);
  });

  it("a throwing alert resolves and the memory feed runs with a not-regressed outcome", async () => {
    h.checkAndAlertRegression.mockRejectedValue(new Error("smtp"));
    await expect(runScanConsequences(prev, report(), { orgSlug: "acme", tag: "t" })).resolves.toBeUndefined();
    expect(h.recordScanMemories).toHaveBeenCalledWith("org_1", prev, expect.anything(), { regressed: false, verdict: null });
  });

  it("an unresolvable org skips the reconcile and alerts org-less", async () => {
    h.getOrgId.mockResolvedValue(null);
    await runScanConsequences(prev, report(), { orgSlug: "acme", tag: "t" });
    expect(h.reconcilePracticeAdoption).not.toHaveBeenCalled();
    expect(h.checkAndAlertRegression).toHaveBeenCalledWith(prev, expect.anything(), { orgId: undefined, orgSlug: "acme" });
  });
});

describe("persistFleetScan", () => {
  const opts = { orgSlug: "acme", mockRequested: false, prev, tag: "t" };

  it("a NEW row persists and runs every consequence", async () => {
    const out = await persistFleetScan(report(), opts);
    expect(out).toEqual({ degraded: false, persisted: { deduped: false } });
    expect(h.reconcilePracticeAdoption).toHaveBeenCalledTimes(1);
    expect(h.checkAndAlertRegression).toHaveBeenCalledTimes(1);
    expect(h.recordScanMemories).toHaveBeenCalledTimes(1);
  });

  it("a deduped persist runs no consequence (no alert, no reconcile, no memory write)", async () => {
    h.persistScanReport.mockResolvedValue({ deduped: true });
    const out = await persistFleetScan(report(), opts);
    expect(out).toEqual({ degraded: false, persisted: { deduped: true } });
    expect(h.checkAndAlertRegression).not.toHaveBeenCalled();
    expect(h.reconcilePracticeAdoption).not.toHaveBeenCalled();
    expect(h.recordScanMemories).not.toHaveBeenCalled();
  });

  it("a degraded-to-mock report is refused: not persisted, nothing alerted", async () => {
    const out = await persistFleetScan(report("mock"), opts);
    expect(out).toEqual({ degraded: true });
    expect(h.persistScanReport).not.toHaveBeenCalled();
    expect(h.checkAndAlertRegression).not.toHaveBeenCalled();
  });

  it("a REQUESTED mock (free preview) is not degraded and still persists", async () => {
    const out = await persistFleetScan(report("mock"), { ...opts, mockRequested: true });
    expect(out.degraded).toBe(false);
    expect(h.persistScanReport).toHaveBeenCalledTimes(1);
  });
});
