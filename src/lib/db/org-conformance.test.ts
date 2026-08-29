// #16 — the per-check ledger writer/readers. Prisma is faked at the seam so the RULES are the thing
// under test, not the driver: a re-run of one commit replaces its findings, a sha-less run appends,
// an invalid id never reaches the table, and a legacy payload lands as `summaryOnly` rather than as a
// report with zero (implicitly passing) checks.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: vi.fn(async () => "org_1") }));

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { listConformanceReports, loadControlMatrix, writeConformanceReport } from "./org-conformance";

const mockGetPrisma = vi.mocked(getPrisma);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockGetOrgId = vi.mocked(getOrgId);

/** A tx double that records what the writer did. `existing` is what findFirst returns. */
function fakeTx(existing: { id: string } | null = null) {
  const conformanceReport = {
    findFirst: vi.fn(async () => existing),
    create: vi.fn(async () => ({ id: "rep_new" })),
    delete: vi.fn(async () => ({})),
    findMany: vi.fn(async () => []),
  };
  const conformanceFinding = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: vi.fn(async () => ({ count: 0 })),
  };
  return { tx: { conformanceReport, conformanceFinding }, conformanceReport, conformanceFinding };
}

const input = (over: Record<string, unknown> = {}) => ({
  repoFullName: "acme/api",
  headSha: "abc1234",
  score: 80,
  fails: 0,
  warns: 1,
  unchecked: 0,
  scored: 5,
  specVersion: "0.3.0",
  runShape: "plain" as const,
  findings: [{ check: "control.prepush.lint", level: "pass" as const, message: "ok" }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgId.mockResolvedValue("org_1");
});

describe("writeConformanceReport", () => {
  it("replaces the previous report for the same (sha, runShape) rather than duplicating the timeline", async () => {
    const { tx, conformanceReport, conformanceFinding } = fakeTx({ id: "rep_old" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeConformanceReport(tx as any, "org_1", input());
    expect(conformanceFinding.deleteMany).toHaveBeenCalledWith({ where: { reportId: "rep_old" } });
    expect(conformanceReport.delete).toHaveBeenCalledWith({ where: { id: "rep_old" } });
    expect(conformanceReport.create).toHaveBeenCalledTimes(1);
  });

  it("a sha-less report APPENDS — the ledger cannot order what it cannot identify", async () => {
    const { tx, conformanceReport } = fakeTx({ id: "rep_old" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeConformanceReport(tx as any, "org_1", input({ headSha: null }));
    expect(conformanceReport.findFirst).not.toHaveBeenCalled();
    expect(conformanceReport.delete).not.toHaveBeenCalled();
    expect(conformanceReport.create).toHaveBeenCalledTimes(1);
  });

  it("stores a payload with NO findings as summaryOnly — absent is not a wall of passes", async () => {
    const { tx, conformanceReport, conformanceFinding } = fakeTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeConformanceReport(tx as any, "org_1", input({ findings: null }));
    expect(conformanceReport.create.mock.calls[0]![0].data.summaryOnly).toBe(true);
    expect(conformanceFinding.createMany).not.toHaveBeenCalled();
  });

  it("an EMPTY findings array is a different statement from an absent one", async () => {
    const { tx, conformanceReport } = fakeTx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeConformanceReport(tx as any, "org_1", input({ findings: [] }));
    expect(conformanceReport.create.mock.calls[0]![0].data.summaryOnly).toBe(false);
  });

  it("drops a malformed id/level and truncates a long message instead of writing junk rows", async () => {
    const { tx, conformanceFinding } = fakeTx();
    await writeConformanceReport(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx as any,
      "org_1",
      input({
        findings: [
          { check: "Bad Id", level: "pass", message: "" },
          { check: "structure", level: "sideways", message: "" },
          { check: "structure", level: "warn", message: "x".repeat(900) },
        ],
      }),
    );
    const rows = conformanceFinding.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.check).toBe("structure");
    expect(rows[0]!.message).toHaveLength(300);
  });
});

describe("listConformanceReports / loadControlMatrix", () => {
  it("return NULL without a database, so 'unavailable' is distinguishable from 'no history'", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await listConformanceReports("acme", "acme/api")).toBeNull();
    expect(await loadControlMatrix("acme")).toBeNull();
  });

  it("return NULL for an unknown org rather than an empty (and reassuring) matrix", async () => {
    mockGetOrgId.mockResolvedValue(null);
    mockGetPrisma.mockReturnValue({} as never);
    expect(await listConformanceReports("nope", "acme/api")).toBeNull();
    expect(await loadControlMatrix("nope")).toBeNull();
  });

  it("map reportedAt to an ISO STRING server-side (wire-safe dates)", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "rep_1",
        repoFullName: "acme/api",
        headSha: null,
        score: 80,
        fails: 0,
        warns: 1,
        unchecked: 0,
        scored: 5,
        specVersion: "0.3.0",
        runShape: "plain",
        summaryOnly: false,
        reportedAt: new Date("2026-06-10T00:00:00.000Z"),
        findings: [{ check: "structure", level: "pass", message: "" }],
      },
    ]);
    mockGetPrisma.mockReturnValue({ conformanceReport: { findMany } } as never);
    const rows = await listConformanceReports("acme", "acme/api");
    expect(rows![0]!.reportedAt).toBe("2026-06-10T00:00:00.000Z");
    expect(typeof rows![0]!.reportedAt).toBe("string");
  });
});
