// value-1 (executive-briefing-export council r1): "The per-client briefing never names its client".
// A segment-scoped build now carries the segment's name as `segmentName`, read org-constrained, and
// the markdown header (like the PDF and the share page) names the client through briefingSubject. An
// unreadable name fails the build: falling back to the org name would ship the defect back.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(),
  getOrgBenchmark: vi.fn(async () => null),
  getOrgMovers: vi.fn(async () => ({ gainers: [], regressers: [], levelChanges: [], comparedRepos: 0 })),
  listGoals: vi.fn(async () => []),
  getOrgRecommendations: vi.fn(async () => []),
  getOrgPractices: vi.fn(async () => null),
  listPlaybooks: vi.fn(async () => []),
  getPlaybookAdoption: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db/org", () => ({
  getOrgEngineMix: vi.fn(async () => []),
  getOrgRecsActioned: vi.fn(async () => ({ engaged: 0, actioned: 0 })),
}));
vi.mock("@/lib/db/improvement-events", () => ({ getImprovementEvents: vi.fn(async () => []) }));
vi.mock("@/lib/db/segments", () => ({ getSegmentName: vi.fn() }));

import { briefingMarkdown, briefingSubject, buildExecBriefing } from "./briefing";
import * as db from "@/lib/db";
import { getSegmentName } from "@/lib/db/segments";

const mockName = vi.mocked(getSegmentName);
const graded = {
  org: "acme", repoCount: 2, scannedCount: 2, avgOverall: 70, avgAdoption: 66, avgRigor: 74,
  realScoredCount: 2, mockCount: 0, postureCounts: {},
  dimAverages: [{ dimId: "D1", avg: 90 }], repos: [], trend: [], forecast: null, baseline: null, deltas: null, movement: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getOrgRollup).mockResolvedValue(graded as never);
});

describe("buildExecBriefing — a per-client briefing names its client", () => {
  it("carries the segment's name, read under the briefing's org with the scoped segment id", async () => {
    mockName.mockResolvedValue("Globex Corp");
    const b = (await buildExecBriefing("acme", undefined, "all time", "seg_1"))!;
    expect(b.segmentName).toBe("Globex Corp");
    expect(b.org).toBe("acme"); // the org stays the issuer
    expect(mockName).toHaveBeenCalledWith("acme", "seg_1");
    expect(briefingSubject(b)).toBe("Globex Corp");
  });

  it("names the client in the markdown header, not the reseller's account", async () => {
    mockName.mockResolvedValue("Globex Corp");
    const md = briefingMarkdown((await buildExecBriefing("acme", undefined, "all time", "seg_1"))!);
    expect(md.split("\n")[0]).toBe("# Ascent AI-native engineering maturity briefing: Globex Corp");
  });

  it("also names the client on the no-grade (all-mock) path", async () => {
    mockName.mockResolvedValue("Globex Corp");
    vi.mocked(db.getOrgRollup).mockResolvedValue({ ...graded, realScoredCount: 0, mockCount: 2 } as never);
    expect((await buildExecBriefing("acme", undefined, "all time", "seg_1"))!.segmentName).toBe("Globex Corp");
  });

  it("an unscoped briefing is unchanged: no name read, segmentName null, the org heads the markdown", async () => {
    const b = (await buildExecBriefing("acme"))!;
    expect(b.segmentName).toBeNull();
    expect(mockName).not.toHaveBeenCalled();
    expect(briefingMarkdown(b).split("\n")[0]).toBe("# Ascent AI-native engineering maturity briefing: acme");
  });

  it("fails the build when the name cannot be read — never a silent fallback to the org name", async () => {
    mockName.mockRejectedValue(new Error("db down"));
    await expect(buildExecBriefing("acme", undefined, "all time", "seg_1")).rejects.toThrow("db down");
    // Resolved-but-absent with scans present (a segment deleted mid-build) fails the same way.
    mockName.mockResolvedValue(null);
    await expect(buildExecBriefing("acme", undefined, "all time", "seg_1")).rejects.toThrow(/segment name/);
  });

  it("another org's segment id: its scoped rollup is empty, so the build is null and no name surfaces", async () => {
    mockName.mockResolvedValue(null); // org-constrained read: not found in this org
    vi.mocked(db.getOrgRollup).mockResolvedValue({ ...graded, repoCount: 0, scannedCount: 0 } as never);
    expect(await buildExecBriefing("acme", undefined, "all time", "seg_other_org")).toBeNull();
  });
});
