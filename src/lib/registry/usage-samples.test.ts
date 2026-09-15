// Pure tests for the `usage/` lane fold (#19, sink B). The rule under test is the honest null: a
// contributor that reports a COUNT without a `lastUsed` gives us evidence that the skill ran and no
// evidence of when, and `generatedAt` must never be substituted for the missing instant.

import { describe, expect, it } from "vitest";
import { SKILL_INVOKES_PER_DAY_CEILING, SKILL_INVOKES_PER_WINDOW_CEILING } from "@/lib/mcp/self-report-ceiling";
import { WRITE_TOOL_POLICY } from "@/lib/mcp/write-gate";
import { aggregateUsage, boundContribution, sampleEventStats, type UsageSample } from "./usage-samples";

const SKILLS = [
  { id: "s1", name: "deploy-check" },
  { id: "s2", name: "release-notes" },
];

const sample = (over: Partial<UsageSample> = {}): UsageSample => ({
  contributor: "acme-ci",
  skillName: "deploy-check",
  invokes: 3,
  windowDays: 30,
  lastUsed: "2026-08-20T00:00:00.000Z",
  generatedAt: "2026-08-29T00:00:00.000Z",
  ...over,
});

describe("sampleEventStats", () => {
  it("keys by OrgSkill id and reports the count as `invoke`", () => {
    expect(sampleEventStats([sample()], SKILLS)).toEqual([
      { skillId: "s1", type: "invoke", lastAt: "2026-08-20T00:00:00.000Z", count: 3 },
    ]);
  });

  it("sums across contributors and keeps the LATEST reported instant", () => {
    const stats = sampleEventStats(
      [
        sample({ contributor: "a", invokes: 3, lastUsed: "2026-08-10T00:00:00.000Z" }),
        sample({ contributor: "b", invokes: 4, lastUsed: "2026-08-25T00:00:00.000Z" }),
      ],
      SKILLS,
    );
    expect(stats).toEqual([{ skillId: "s1", type: "invoke", lastAt: "2026-08-25T00:00:00.000Z", count: 7 }]);
  });

  it("reports a count with a NULL instant when no contributor declared lastUsed", () => {
    // THE SUBSTITUTION THIS FORBIDS: falling back to `generatedAt` would report a fresh instant on
    // every publish, making every skill in an actively-regenerated registry read `active` forever.
    const stats = sampleEventStats([sample({ lastUsed: null })], SKILLS);
    expect(stats).toEqual([{ skillId: "s1", type: "invoke", lastAt: null, count: 3 }]);
    expect(stats[0]!.lastAt).not.toBe("2026-08-29T00:00:00.000Z");
  });

  it("lets one contributor's known instant stand for the skill without inventing the others'", () => {
    const stats = sampleEventStats(
      [sample({ contributor: "a", invokes: 2, lastUsed: null }), sample({ contributor: "b", invokes: 5 })],
      SKILLS,
    );
    expect(stats).toEqual([{ skillId: "s1", type: "invoke", lastAt: "2026-08-20T00:00:00.000Z", count: 7 }]);
  });

  it("ignores a sample naming a skill this org does not mirror", () => {
    // A registry may legitimately hold skills an org never adopted; that is not a warning-worthy fault.
    expect(sampleEventStats([sample({ skillName: "not-mirrored" })], SKILLS)).toEqual([]);
  });

  it("drops an unparseable lastUsed rather than passing it downstream", () => {
    expect(sampleEventStats([sample({ lastUsed: "last tuesday" })], SKILLS)[0]!.lastAt).toBeNull();
  });

  it("emits nothing for a skill reported with zero invokes and no instant", () => {
    // Zero-and-silent is not evidence; a stat would only flip the skill out of `unmeasured`.
    expect(sampleEventStats([sample({ invokes: 0, lastUsed: null })], SKILLS)).toEqual([]);
  });

  it("keeps a zero count that DOES carry an instant — someone reported running it", () => {
    const stats = sampleEventStats([sample({ invokes: 0 })], SKILLS);
    expect(stats).toEqual([{ skillId: "s1", type: "invoke", lastAt: "2026-08-20T00:00:00.000Z", count: 0 }]);
  });

  it("handles several skills, deterministically ordered", () => {
    const stats = sampleEventStats(
      [sample({ skillName: "release-notes", invokes: 1 }), sample({ skillName: "deploy-check", invokes: 2 })],
      SKILLS,
    );
    expect(stats.map((s) => s.skillId)).toEqual(["s1", "s2"]);
  });

  it("returns nothing for an empty lane", () => {
    expect(sampleEventStats([], SKILLS)).toEqual([]);
  });

  it("bounds the persisted DECLARED counts at read time, per contributor", () => {
    // Samples persist what the file said; the dormancy count must not inherit an inflated claim.
    const stats = sampleEventStats(
      [sample({ contributor: "honest", invokes: 12 }), sample({ contributor: "inflated", invokes: 1_000_000, windowDays: 365 })],
      SKILLS,
    );
    expect(stats[0]!.count).toBe(12 + SKILL_INVOKES_PER_WINDOW_CEILING);
  });
});

describe("boundContribution", () => {
  it("normalizes to a 30-day rate from the declared window", () => {
    expect(boundContribution([{ invokes: 90, windowDays: 90 }, { invokes: 7, windowDays: 7 }])).toEqual({
      counts: [30, 30],
      clamped: false,
    });
  });

  it("never rounds a real report to zero", () => {
    expect(boundContribution([{ invokes: 1, windowDays: 365 }]).counts).toEqual([1]);
  });

  it("scales an over-ceiling contributor down proportionally and says so", () => {
    const { counts, clamped } = boundContribution([
      { invokes: 30_000, windowDays: 30 },
      { invokes: 10_000, windowDays: 30 },
    ]);
    expect(clamped).toBe(true);
    expect(counts).toEqual([11_250, 3_750]);
    expect(counts[0]! + counts[1]!).toBeLessThanOrEqual(SKILL_INVOKES_PER_WINDOW_CEILING);
  });

  it("is ONE authority: the MCP invoke door enforces the same daily number", () => {
    expect(WRITE_TOOL_POLICY.report_skill_invoke!.perTokenDailyMax).toBe(SKILL_INVOKES_PER_DAY_CEILING);
  });
});

describe("aggregateUsage: windows and the ceiling", () => {
  const file = (path: string, doc: Record<string, unknown>) => ({
    path,
    text: JSON.stringify({ schema: "rkb-usage/1", generatedAt: "2026-09-15T00:00:00Z", ...doc }),
  });

  it("rejects a contribution with no valid window instead of assuming 30", () => {
    for (const windowDays of [undefined, 0, -30, "30", Number.NaN]) {
      const warnings: string[] = [];
      const usage = aggregateUsage([file("usage/nowin.json", { windowDays, skills: { "deploy-check": { invokes: 9 } } })], warnings);
      expect(usage).toMatchObject({ invokes30d: 0, contributors: 0, bySkill: {}, contributorNames: [] });
      expect(warnings).toEqual([expect.stringContaining("windowDays is missing")]);
    }
  });

  it("T5: an inflated long-window file cannot bury an honest one, and the clamp is visible", () => {
    const honest = file("usage/honest.json", { windowDays: 30, skills: { "deploy-check": { invokes: 12 } } });
    const inflated = file("usage/inflated.json", { windowDays: 365, skills: { "deploy-check": { invokes: 1_000_000 } } });
    const warnings: string[] = [];
    const usage = aggregateUsage([honest, inflated], warnings);
    // Arm A was measured against HEAD c4238053 before this change, with the same two files.
    process.stderr.write(`[T5] arm A (HEAD c4238053): invokes30d=1000012 bySkill["deploy-check"]=1000012 clamped=n/a\n`);
    process.stderr.write(
      `[T5] arm B: invokes30d=${usage.invokes30d} bySkill["deploy-check"]=${usage.bySkill["deploy-check"]} clamped=${usage.clampedContributors}\n`,
    );
    // 1,000,000 over 365 days is 82,192 per 30 days, clamped to 500/day * 30 = 15,000.
    expect(usage.invokes30d).toBe(12 + SKILL_INVOKES_PER_WINDOW_CEILING);
    expect(usage.bySkill["deploy-check"]).toBe(12 + SKILL_INVOKES_PER_WINDOW_CEILING);
    expect(usage.clampedContributors).toBe(1);
    expect(warnings).toEqual([expect.stringContaining("usage/inflated.json")]);
    // The persisted grain keeps what the contributor declared; the read-time fold bounds it again.
    expect(usage.samples.map((s) => [s.invokes, s.windowDays])).toEqual([
      [12, 30],
      [1_000_000, 365],
    ]);
  });

  it("normalizes an unclamped 90-day file to its 30-day rate", () => {
    const usage = aggregateUsage([file("usage/q.json", { windowDays: 90, skills: { "deploy-check": { invokes: 90 } } })], []);
    expect(usage.invokes30d).toBe(30);
    expect(usage.clampedContributors).toBe(0);
  });
});
