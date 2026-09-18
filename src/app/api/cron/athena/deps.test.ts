// Prefetch into the unattended standing: the Memory tab's coverage and the Skills tab's
// skillUsageMap abandoned fold, with tools kept empty.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  getOrgRollup: vi.fn(),
  getOrgMovers: vi.fn(),
  getOrgSkillUsageRows: vi.fn(),
  getMemoryCoverage: vi.fn(),
  hasFleetGrade: vi.fn(() => true),
  levelForScore: vi.fn(() => ({ name: "Practicing" })),
  resolveWindow: vi.fn(() => ({ start: new Date("2026-07-20"), endExclusive: new Date("2026-07-27") })),
  weekRangeParams: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => ({
  getOrgRollup: h.getOrgRollup,
  getOrgMovers: h.getOrgMovers,
  getOrgSkillUsageRows: h.getOrgSkillUsageRows,
}));

vi.mock("@/lib/memory/coverage", () => ({ getMemoryCoverage: h.getMemoryCoverage }));
vi.mock("@/lib/db/org-shared", () => ({ hasFleetGrade: h.hasFleetGrade }));
vi.mock("@/lib/maturity/model", () => ({ levelForScore: h.levelForScore }));
vi.mock("@/lib/window", () => ({ resolveWindow: h.resolveWindow, weekRangeParams: h.weekRangeParams }));
vi.mock("@/lib/db/athena", () => ({
  appendAthenaTurn: vi.fn(),
  createAthenaThread: vi.fn(),
  getAthenaIdentityPair: vi.fn(),
  latestAthenaActivity: vi.fn(),
  listOpenAthenaProposals: vi.fn(),
  writeAthenaEpisode: vi.fn(),
}));
vi.mock("@/lib/llm/tool-loop", () => ({ runToolLoop: vi.fn() }));

import { buildOrgCycleDeps } from "./deps";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  h.hasFleetGrade.mockReturnValue(true);
  h.levelForScore.mockReturnValue({ name: "Practicing" });
  h.getOrgRollup.mockResolvedValue({
    repoCount: 14,
    scannedCount: 12,
    avgOverall: 62,
    avgAdoption: 50,
    avgRigor: 55,
    deltas: { overall: 0 },
    movement: { cohortSize: 12 },
  });
  h.getOrgMovers.mockResolvedValue({ gainers: [], regressers: [] });
  h.getMemoryCoverage.mockResolvedValue({
    coveragePct: 40,
    reposWithFreshMemory: 8,
    totalTrackedRepos: 20,
    windowDays: 30,
    staleRepos: [
      { fullName: "acme/api", lastMemoryAt: null },
      { fullName: "acme/web", lastMemoryAt: daysAgo(40) },
    ],
  });
  h.getOrgSkillUsageRows.mockResolvedValue({
    skills: [{ id: "b", name: "old-linter", createdAt: daysAgo(300), content: "" }],
    events: [{ skillId: "b", type: "invoke", lastAt: daysAgo(90), count: 1 }],
    adoptions: [],
    samples: [],
  });
});

describe("the unattended standing prefetches the tab instruments", () => {
  it("includes coverage and abandoned from getMemoryCoverage and skillUsageMap", async () => {
    const deps = buildOrgCycleDeps({ org: "acme", orgId: "org_1" });
    const standing = await deps.standing();
    expect(h.getMemoryCoverage).toHaveBeenCalledWith("acme");
    expect(h.getOrgSkillUsageRows).toHaveBeenCalledWith("acme");
    expect(standing).toMatchObject({
      avgOverall: 62,
      coverage: {
        coveragePct: 40,
        reposWithFreshMemory: 8,
        totalTrackedRepos: 20,
        windowDays: 30,
        staleRepos: ["acme/api", "acme/web"],
      },
      abandoned: { count: 1, names: ["old-linter"] },
    });
  });

  it("prefetches those facts by name and keeps the hosted cycle tool-less", () => {
    const src = readFileSync(join(process.cwd(), "src", "app", "api", "cron", "athena", "deps.ts"), "utf8");
    expect(src).toMatch(/\bgetMemoryCoverage\b/);
    expect(src).toMatch(/\bskillUsageMap\b/);
    expect(src).toMatch(/tools:\s*\[\]/);
    expect(src).not.toMatch(/tools:\s*\[[^\s\]]/);
  });

  it("survives a failed coverage or skills read without dropping the scored standing", async () => {
    h.getMemoryCoverage.mockRejectedValue(new Error("coverage down"));
    h.getOrgSkillUsageRows.mockRejectedValue(new Error("skills down"));
    const deps = buildOrgCycleDeps({ org: "acme", orgId: "org_1" });
    const standing = await deps.standing();
    expect(standing).toMatchObject({
      avgOverall: 62,
      coverage: { coveragePct: 0, totalTrackedRepos: 0, staleRepos: [] },
      abandoned: { count: 0, names: [] },
    });
  });
});
