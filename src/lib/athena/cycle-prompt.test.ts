// The unattended briefing prompt is pure, so the silence path, the prefetched standing extras, and
// the "no tools" contract are assertable as exact strings rather than as comments.

import { describe, it, expect } from "vitest";
import { skillUsageMap } from "@/lib/org/skill-usage";
import { ATHENA_ACTION_CONTRACT } from "@/lib/athena/actions";
import { ATHENA_TONE_CONTRACT, ATHENA_BLOCK_CONTRACT } from "@/lib/athena/prompt";
import {
  buildCycleBriefingPrompt,
  cycleStandingExtras,
  CYCLE_SILENCE_TOKEN,
  CYCLE_STANDING_NAMED_LIMIT,
  isCycleSilence,
  type CycleStanding,
} from "./cycle-prompt";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const standing = (over: Partial<CycleStanding> = {}): CycleStanding => ({
  repoCount: 14,
  scannedCount: 12,
  avgOverall: 62,
  level: "Practicing",
  overallDelta: 0,
  cohortSize: 12,
  movers: [],
  coverage: {
    coveragePct: 40,
    reposWithFreshMemory: 8,
    totalTrackedRepos: 20,
    windowDays: 30,
    staleRepos: ["acme/api", "acme/web"],
  },
  abandoned: { count: 2, names: ["old-linter", "release-checklist"] },
  ...over,
});

const promptOf = (over: Partial<CycleStanding> = {}) =>
  buildCycleBriefingPrompt({
    orgSlug: "acme",
    constitution: "Be exact.",
    selfModel: null,
    standing: standing(over),
    openProposals: [],
    periodLabel: "the last day",
  });

describe("silence stays a first-class spelling", () => {
  it("teaches NOTHING TO REPORT as the first-line answer, and still matches it", () => {
    const p = promptOf();
    expect(p).toContain(CYCLE_SILENCE_TOKEN);
    expect(isCycleSilence(CYCLE_SILENCE_TOKEN)).toBe(true);
    expect(isCycleSilence(`${CYCLE_SILENCE_TOKEN}.`)).toBe(true);
    expect(isCycleSilence("The fleet held steady.")).toBe(false);
  });
});

describe("standing includes coverage and abandoned", () => {
  it("names the Memory-tab coverage and the Skills-tab abandoned fold", () => {
    const p = promptOf();
    expect(p).toContain("Memory coverage: 40% (8 of 20 tracked repos with fresh memory in 30d)");
    expect(p).toContain("Going quiet: acme/api, acme/web");
    expect(p).toContain("Abandoned skills (tried, then quiet): 2 — old-linter, release-checklist");
  });

  it("says none when the library has no prune candidates", () => {
    const p = promptOf({ abandoned: { count: 0, names: [] } });
    expect(p).toContain("Abandoned skills (tried, then quiet): none");
  });

  it("reuses identity and the three contracts, and does not offer tools", () => {
    const p = promptOf();
    expect(p).toContain("Be exact.");
    expect(p).toContain(ATHENA_TONE_CONTRACT);
    expect(p).toContain(ATHENA_BLOCK_CONTRACT);
    expect(p).toContain(ATHENA_ACTION_CONTRACT);
    expect(p).not.toContain("You can call tools");
    expect(p).not.toMatch(/\bcall tools\b/i);
  });
});

describe("cycleStandingExtras folds the tab instruments", () => {
  it("caps named stale repos and abandoned skills, and keeps the full count", () => {
    const extras = cycleStandingExtras(
      {
        coveragePct: 10,
        reposWithFreshMemory: 1,
        totalTrackedRepos: 12,
        windowDays: 30,
        staleRepos: Array.from({ length: 8 }, (_, i) => ({ fullName: `acme/r${i}` })),
      },
      Array.from({ length: 7 }, (_, i) => ({ name: `skill-${i}`, daysSinceUse: 40 + i })),
    );
    expect(extras.coverage.staleRepos).toHaveLength(CYCLE_STANDING_NAMED_LIMIT);
    expect(extras.abandoned.count).toBe(7);
    expect(extras.abandoned.names).toHaveLength(CYCLE_STANDING_NAMED_LIMIT);
    expect(extras.abandoned.names[0]).toBe("skill-6"); // longest-quiet first
  });

  it("honest-zeros coverage when the Memory-tab read failed", () => {
    expect(cycleStandingExtras(null, [])).toEqual({
      coverage: {
        coveragePct: 0,
        reposWithFreshMemory: 0,
        totalTrackedRepos: 0,
        windowDays: 0,
        staleRepos: [],
      },
      abandoned: { count: 0, names: [] },
    });
  });

  it("takes abandoned names from the same skillUsageMap fold the Skills tab shows", () => {
    const rows = {
      skills: [
        { id: "a", name: "fresh-note", createdAt: daysAgo(2) },
        { id: "b", name: "old-linter", createdAt: daysAgo(300) },
      ],
      events: [{ skillId: "b", type: "invoke", lastAt: daysAgo(90), count: 1 }],
      adoptions: [],
      samples: [],
    };
    const map = skillUsageMap(rows, NOW);
    expect(map.b?.state).toBe("abandoned");
    const extras = cycleStandingExtras(
      { coveragePct: 50, reposWithFreshMemory: 1, totalTrackedRepos: 2, windowDays: 30, staleRepos: [] },
      Object.values(map)
        .filter((u) => u.state === "abandoned")
        .map((u) => ({
          name: rows.skills.find((s) => s.id === u.skillId)?.name ?? u.skillId,
          daysSinceUse: u.daysSinceUse,
        })),
    );
    expect(extras.abandoned).toEqual({ count: 1, names: ["old-linter"] });
    expect(extras.coverage.coveragePct).toBe(50);
  });
});
