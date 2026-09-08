// The use-over-time lane, pinned without a DOM. Sibling of skillLifecycleViz.test.ts (the 200-LOC
// features cap splits a test file by theme, each carrying its own fixtures).
//
// The claim under test: a lane's silence is a VOID where this org's pathway works and recorded
// nothing, and a HATCH where the pathway has never emitted anything at all. Collapsing the two is
// the bug the whole Skills redesign is about.

import { describe, expect, it } from "vitest";
import { isVoid } from "@/components/org/viz";
import { dormancyLanes, observedAt, trackEnd } from "./skillDormancyTrack";
import type { SkillUsage } from "@/lib/org/skill-usage";
import type { SkillRow } from "@/lib/db";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");

function usage(o: Partial<SkillUsage>): SkillUsage {
  return {
    skillId: "s1",
    verdict: "active",
    state: "active",
    lastUsedAt: "2026-09-05T00:00:00.000Z",
    lastUsedType: "download",
    daysSinceUse: 3,
    useCount: 4,
    invokes: 1,
    eventCount: 4,
    anchorAt: "2026-07-01T00:00:00.000Z",
    ageDays: 69,
    windowDays: 30,
    ...o,
  } as SkillUsage;
}

function skill(o: Partial<SkillRow>): SkillRow {
  return {
    id: "s1",
    name: "pr-review",
    description: "",
    content: "",
    category: "workflow",
    tags: [],
    frontmatter: {} as SkillRow["frontmatter"],
    version: 1,
    contentHash: "",
    downloadCount: 2,
    adoptionCount: 1,
    origin: "hosted",
    registryPath: null,
    registryVersion: null,
    createdBy: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...o,
  };
}

describe("dormancyLanes", () => {
  it("draws the observed span, then a VOID for the silence — never a zero", () => {
    const t = dormancyLanes([skill({})], { s1: usage({ state: "abandoned", verdict: "dormant" }) }, NOW);
    const [lane] = t.rows;
    expect(lane.segments[0].state).toBe("measured");
    expect(lane.segments[1].state).toBe("missing");
    expect(isVoid(lane.segments[1].state)).toBe(true);
    expect(lane.segments[1].to).toBe(trackEnd(NOW));
  });

  it("hatches the silence instead of voiding it when nothing was ever measured", () => {
    const t = dormancyLanes(
      [skill({})],
      { s1: usage({ state: "unmeasured", verdict: "dormant", lastUsedAt: null, lastUsedType: null, daysSinceUse: null }) },
      NOW,
    );
    expect(t.rows[0].segments).toHaveLength(1);
    expect(t.rows[0].segments[0].state).toBe("not-judged");
  });

  it("a sync-only lane is DECLARED, because a background pull is not a use", () => {
    const t = dormancyLanes([skill({})], { s1: usage({ lastUsedType: "sync", state: "unused", verdict: "dormant" }) }, NOW);
    expect(t.rows[0].segments[0].state).toBe("declared");
  });

  it("skips a skill with no usage row rather than inventing an anchor for it", () => {
    expect(dormancyLanes([skill({})], {}, NOW).rows).toHaveLength(0);
  });

  it("day-rounds the window end so the server's picture and the hydrated one agree", () => {
    expect(trackEnd(NOW)).toBe(trackEnd(NOW + 3_600_000));
    expect(trackEnd(NOW) % 86_400_000).toBe(0);
  });
});

describe("observedAt", () => {
  it("recovers the server's clock from the rows, so render never calls one", () => {
    const at = observedAt({ s1: usage({ anchorAt: "2026-07-01T00:00:00.000Z", ageDays: 69 }) });
    expect(at).toBe(Date.parse("2026-09-08T00:00:00.000Z"));
  });

  it("is null for an empty usage map — the caller degrades rather than guessing a window", () => {
    expect(observedAt({})).toBeNull();
  });
});
