// Pure tests for the `usage/` lane fold (#19, sink B). The rule under test is the honest null: a
// contributor that reports a COUNT without a `lastUsed` gives us evidence that the skill ran and no
// evidence of when, and `generatedAt` must never be substituted for the missing instant.

import { describe, expect, it } from "vitest";
import { sampleEventStats, type UsageSample } from "./usage-samples";

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
});
