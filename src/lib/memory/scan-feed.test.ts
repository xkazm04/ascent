// The two properties the scan-feed auto-writer is only useful if it has: it must not duplicate an
// event it already recorded, and it must agree with the rubric about where a maturity band edge is.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import {
  detectLevelChange,
  isClosedRecStatus,
  recordLevelChangeMemory,
  recordRecommendationClosedMemory,
  recordRegressionMemory,
  recordScanMemories,
  SCAN_PIPELINE_SOURCE,
} from "./scan-feed";
import { levelForScore } from "@/lib/maturity/model";
import type { ScanReport } from "@/lib/types";

/** An in-memory OrgMemory table: findMany reads it, create appends — so a second identical write
 *  really does see the first one, which is the whole thing under test. */
function fakeStore(seed: { content: string }[] = []) {
  const rows = seed.map((r, i) => ({ id: `m${i}`, content: r.content }));
  const create = vi.fn(async ({ data }: { data: { content: string } }) => {
    const row = { id: `m${rows.length}`, content: data.content };
    rows.push(row);
    return { id: row.id };
  });
  const findMany = vi.fn(async () => [...rows].reverse());
  mockGetPrisma.mockReturnValue({ orgMemory: { findMany, create } });
  return { rows, create, findMany };
}

const AT = new Date("2026-07-27T10:00:00Z");

beforeEach(() => vi.clearAllMocks());

describe("scan-feed row shape", () => {
  it("writes an episodic, high-confidence, scan-pipeline row namespaced to the repo", async () => {
    const { create } = fakeStore();
    await recordRegressionMemory("org_1", "acme/api", { verdict: null, overallFrom: 72, overallTo: 61 }, AT);

    expect(create).toHaveBeenCalledTimes(1);
    const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      orgId: "org_1",
      namespace: "acme/api",
      kind: "episodic",
      source: SCAN_PIPELINE_SOURCE,
      confidence: 1.0,
    });
    expect(JSON.parse(data.tags as string)).toEqual(["acme/api", "regression"]);
    expect(data.content).toBe("Regression detected on acme/api: overall 72→61 (2026-07-27)");
  });

  it("says WHICH WAY a level change went, in both directions", async () => {
    const { create } = fakeStore();
    await recordLevelChangeMemory("o", "acme/api", levelForScore(50), levelForScore(70), { from: 50, to: 70 }, AT);
    await recordLevelChangeMemory("o", "acme/web", levelForScore(70), levelForScore(50), { from: 70, to: 50 }, AT);

    const contents = create.mock.calls.map((c) => (c[0] as { data: { content: string } }).data.content);
    expect(contents[0]).toContain("Maturity promoted on acme/api: L3 Augmented → L4 Integrated");
    expect(contents[1]).toContain("Maturity demoted on acme/web: L4 Integrated → L3 Augmented");
  });
});

describe("idempotency (the auto-feed must not stack duplicates)", () => {
  it("does not create a second row for an identical event", async () => {
    const { create } = fakeStore();
    const input = { verdict: null, overallFrom: 72, overallTo: 61 };
    const first = await recordRegressionMemory("org_1", "acme/api", input, AT);
    const second = await recordRegressionMemory("org_1", "acme/api", input, AT);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("still records a DIFFERENT regression on the same repo (dedup isn't a mute button)", async () => {
    const { create } = fakeStore();
    await recordRegressionMemory("org_1", "acme/api", { verdict: null, overallFrom: 72, overallTo: 61 }, AT);
    await recordRegressionMemory(
      "org_1",
      "acme/api",
      { verdict: null, overallFrom: 61, overallTo: 40 },
      new Date("2026-08-14T10:00:00Z"),
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("scopes the dedup read to this org, this repo and our own source", async () => {
    const { findMany } = fakeStore();
    await recordRecommendationClosedMemory("org_1", "acme/api", { title: "Add CODEOWNERS", dimension: "D6" }, AT);
    expect((findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where).toMatchObject({
      orgId: "org_1",
      namespace: "acme/api",
      source: SCAN_PIPELINE_SOURCE,
      archived: false,
      supersededBy: null,
    });
  });

  it("swallows a DB failure and returns null (a memory write never fails its caller)", async () => {
    mockGetPrisma.mockReturnValue({
      orgMemory: {
        findMany: vi.fn(async () => {
          throw new Error("connection reset");
        }),
        create: vi.fn(),
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      recordRegressionMemory("o", "acme/api", { verdict: null, overallFrom: 9, overallTo: 1 }, AT),
    ).resolves.toBeNull();
    warn.mockRestore();
  });
});

describe("detectLevelChange band edges", () => {
  // The rubric's bands: L1 0-24 · L2 25-44 · L3 45-64 · L4 65-84 · L5 85-100.
  it.each([
    [24, 25, "promotion", "L1", "L2"],
    [44, 45, "promotion", "L2", "L3"],
    [64, 65, "promotion", "L3", "L4"],
    [84, 85, "promotion", "L4", "L5"],
    [85, 84, "demotion", "L5", "L4"],
    [45, 44, "demotion", "L3", "L2"],
  ])("crosses at %i→%i (%s)", (from, to, direction, fromId, toId) => {
    const c = detectLevelChange(from as number, to as number);
    expect(c.changed).toBe(true);
    expect(c.direction).toBe(direction);
    expect(c.from.id).toBe(fromId);
    expect(c.to.id).toBe(toId);
  });

  it.each([
    [45, 64],
    [64, 45],
    [0, 24],
    [85, 100],
  ])("does not fire WITHIN a band (%i→%i)", (from, to) => {
    const c = detectLevelChange(from as number, to as number);
    expect(c.changed).toBe(false);
    expect(c.direction).toBe("none");
  });
});

describe("recordScanMemories (the scan-finalize aggregate)", () => {
  const report = (overall: number): ScanReport =>
    ({
      repo: { owner: "acme", name: "api" },
      overallScore: overall,
    }) as unknown as ScanReport;

  it("records a level change even when the scan did not regress", async () => {
    const { create } = fakeStore();
    await recordScanMemories("org_1", report(60), report(70), { regressed: false, verdict: null }, AT);
    expect(create).toHaveBeenCalledTimes(1);
    const { data } = create.mock.calls[0]![0] as { data: { content: string } };
    expect(data.content).toContain("Maturity promoted");
  });

  it("records BOTH a regression and a demotion when a scan does both", async () => {
    const { create } = fakeStore();
    await recordScanMemories("org_1", report(70), report(50), { regressed: true, verdict: null }, AT);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("is a no-op with no baseline or no org (a first scan writes nothing)", async () => {
    const { create } = fakeStore();
    await recordScanMemories("org_1", null, report(50), { regressed: true, verdict: null }, AT);
    await recordScanMemories(undefined, report(70), report(50), { regressed: true, verdict: null }, AT);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("isClosedRecStatus", () => {
  it("treats done as closed and dismissed as NOT closed", () => {
    expect(isClosedRecStatus("done")).toBe(true);
    expect(isClosedRecStatus("dismissed")).toBe(false);
    expect(isClosedRecStatus("open")).toBe(false);
    expect(isClosedRecStatus(undefined)).toBe(false);
  });
});
