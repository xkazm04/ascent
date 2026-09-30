import { describe, expect, it } from "vitest";
import type { SkillRow } from "@/lib/db";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import type { SkillUsage } from "@/lib/org/skill-usage";
import { USES_COLUMN_TITLE } from "./SkillsLibraryTable";
import {
  adoptedMark,
  dormancyMark,
  fleetLadder,
  outcomeHeadline,
  outcomeMark,
  ranMark,
  skillFigures,
  skillLadder,
  skillRowDetail,
  USES_CAPTION,
  usesWord,
  wideWindowNote,
} from "./skillSceneModel";
import type { LadderStep } from "@/components/kit";

function skill(over: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "s1",
    name: "review",
    description: "",
    content: "body",
    category: "workflow",
    tags: [],
    frontmatter: { name: "review", description: "d", category: "workflow", tags: [], cadenceDays: null },
    version: 1,
    contentHash: "sha256-n1:aa",
    downloadCount: 0,
    adoptionCount: 0,
    origin: "hosted",
    registryPath: null,
    registryVersion: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...over,
  };
}

function usage(over: Partial<SkillUsage> = {}): SkillUsage {
  return {
    skillId: "s1",
    verdict: "new",
    state: "new",
    lastUsedAt: null,
    lastUsedType: null,
    lastUsedSource: null,
    daysSinceUse: null,
    useCount: 0,
    invokes: 0,
    eventCount: 0,
    anchorAt: "2026-01-01T00:00:00.000Z",
    ageDays: 10,
    windowDays: 30,
    ...over,
  };
}

function outcome(over: Partial<SkillOutcome>): SkillOutcome {
  return {
    skillId: "s1",
    repoFullName: "acme/app",
    adoptedAt: "2026-03-01T00:00:00.000Z",
    status: "no-after-scan",
    before: null,
    after: null,
    overallDelta: null,
    dimensionDeltas: [],
    beforeGapDays: null,
    afterGapDays: null,
    withinPairingBound: null,
    instrument: null,
    anchor: "adoption",
    ...over,
  };
}

function step(steps: LadderStep[], key: string): LadderStep {
  const found = steps.find((s) => s.key === key);
  if (!found) throw new Error(`missing step ${key}`);
  return found;
}

describe("skill scene model", () => {
  it("keeps the uses-window sentence the table already shows", () => {
    expect(USES_CAPTION).toBe(USES_COLUMN_TITLE);
  });

  it("shows unmeasured as not measured, never a zero", () => {
    const u = usage({ state: "unmeasured", verdict: "dormant", useCount: 0, invokes: 0 });
    expect(dormancyMark(u)).toEqual({ state: "unmeasured", word: "not measured" });
    expect(ranMark(u).word).toBe("not measured");
    expect(usesWord(u)).toBe("uses not measured");
    expect(skillRowDetail(skill(), u, 2)).not.toMatch(/\b0\b/);
    expect(step(skillLadder(skill(), u, 2), "ran").detail).toBe("not measured");
  });

  it("has no adoption share when the fleet has no repositories", () => {
    expect(adoptedMark(skill(), 0)).toEqual({ state: "unmeasured", word: "not measured" });
    expect(step(skillLadder(skill(), undefined, 0), "adopted").state).toBe("unmeasured");
  });

  it("splits dormant into abandoned, unused and new", () => {
    expect(dormancyMark(usage({ state: "abandoned", verdict: "dormant" })).word).toBe("dormant");
    expect(step(skillLadder(skill(), usage({ state: "abandoned", verdict: "dormant" }), 2), "drift").state).toBe("current");
    expect(dormancyMark(usage({ state: "unused", verdict: "dormant" })).word).toBe("never used");
    expect(step(skillLadder(skill(), usage({ state: "unused", verdict: "dormant" }), 2), "drift").state).toBe("open");
    expect(dormancyMark(usage({ state: "active", verdict: "active", invokes: 2, useCount: 2 })).word).toBe("active");
    expect(dormancyMark(usage()).word).toBe("new");
    expect(ranMark(usage()).word).toBe("not run");
  });

  it("treats a whole library with no events as unmeasured", () => {
    const rows = [skill(), skill({ id: "s2", name: "other" })];
    const ladder = fleetLadder(rows, {}, 2);
    expect(step(ladder, "ran").state).toBe("unmeasured");
    expect(step(ladder, "ran").detail).toBe("not measured");
    expect(skillFigures(rows, {}, 2).map((f) => f.value)).toContain("not measured");
    expect(skillFigures(rows, {}, 2).some((f) => f.label === "Active")).toBe(false);
  });

  it("does not call an all-unmeasured library a counted zero", () => {
    const row = skill();
    const map = { s1: usage({ state: "unmeasured", verdict: "dormant" }) };
    expect(step(fleetLadder([row], map, 2), "drift").detail).toBe("not measured");
  });

  it("names a partial adoption and a measured outcome without inventing a delta", () => {
    expect(adoptedMark(skill({ adoptionCount: 1 }), 2).word).toBe("50% adopted");
    const gap = outcome({ status: "instrument-unknown" });
    expect(outcomeMark(gap.status).state).toBe("unmeasured");
    expect(outcomeHeadline([gap])).toContain("not comparable");
    expect(outcomeHeadline([gap])).not.toContain("pts");
    const missing = outcome({ status: "no-after-scan" });
    expect(outcomeMark(missing.status).state).toBe("missing");
    expect(outcomeHeadline([missing])).not.toMatch(/\b0 pts\b/);
    const moved = outcome({
      status: "measured",
      overallDelta: 4,
      withinPairingBound: false,
      beforeGapDays: 200,
      afterGapDays: 1,
      before: { id: "a", scannedAt: "2026-01-01T00:00:00.000Z", overallScore: 40 },
      after: { id: "b", scannedAt: "2026-06-01T00:00:00.000Z", overallScore: 44 },
    });
    expect(outcomeHeadline([moved])).toContain("+4 pts mean");
    expect(wideWindowNote(moved)).toContain("Wide window");
  });
});
