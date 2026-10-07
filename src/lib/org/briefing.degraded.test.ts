// robustness-3: the five optional reads degrade their SECTION, never the briefing (the intent) — but
// each degrade must reach a door: a console.warn naming the read plus reportHandledError.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { reportHandledError } = vi.hoisted(() => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError }));
vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(),
  getOrgBenchmark: vi.fn(async () => null),
  getOrgMovers: vi.fn(async () => ({ gainers: [], regressers: [], levelChanges: [], comparedRepos: 0 })),
  listGoals: vi.fn(async () => []),
  getOrgRecommendations: vi.fn(),
  getOrgPractices: vi.fn(),
  listPlaybooks: vi.fn(),
  getPlaybookAdoption: vi.fn(),
}));
vi.mock("@/lib/db/org", () => ({
  getOrgEngineMix: vi.fn(async () => []),
  getOrgRecsActioned: vi.fn(async () => ({ engaged: 0, actioned: 0 })),
}));
vi.mock("@/lib/db/improvement-events", () => ({ getImprovementEvents: vi.fn() }));

import { buildExecBriefing } from "./briefing";
import * as db from "@/lib/db";
import { getImprovementEvents } from "@/lib/db/improvement-events";

const boom = new Error("db down");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getOrgRollup).mockResolvedValue({
    org: "acme", repoCount: 2, scannedCount: 2, avgOverall: 70, avgAdoption: 66, avgRigor: 74,
    realScoredCount: 2, mockCount: 0, postureCounts: {},
    dimAverages: [{ dimId: "D1", avg: 90 }], repos: [], trend: [], forecast: null, baseline: null, deltas: null, movement: null,
  } as never);
});

describe("buildExecBriefing optional reads", () => {
  it("still builds when every optional read fails, warns naming each, and reports each", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(db.getOrgRecommendations).mockRejectedValue(boom);
    vi.mocked(db.getOrgPractices).mockRejectedValue(boom);
    vi.mocked(db.listPlaybooks).mockRejectedValue(boom);
    vi.mocked(db.getPlaybookAdoption).mockRejectedValue(boom);
    vi.mocked(getImprovementEvents).mockRejectedValue(boom);

    const b = await buildExecBriefing("acme");
    expect(b).not.toBeNull(); // degrading the section stays the intent

    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    for (const read of ["recommendations", "practices", "playbooks", "playbook adoption", "improvement events"]) {
      expect(warned).toContain(`briefing ${read} failed`);
    }
    expect(reportHandledError).toHaveBeenCalledTimes(5);
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.stringContaining("briefing") }));
    warn.mockRestore();
  });

  it("is silent when every optional read succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(db.getOrgRecommendations).mockResolvedValue([]);
    vi.mocked(db.getOrgPractices).mockResolvedValue(null as never);
    vi.mocked(db.listPlaybooks).mockResolvedValue([]);
    vi.mocked(db.getPlaybookAdoption).mockResolvedValue({});
    vi.mocked(getImprovementEvents).mockResolvedValue([]);
    await buildExecBriefing("acme");
    expect(warn).not.toHaveBeenCalled();
    expect(reportHandledError).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
