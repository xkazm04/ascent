// The Skills tab's encodings, pinned without a DOM.
//
// The bug this file exists to keep dead: `unmeasured` (this org has never emitted a skill event of
// any kind) and `unused` (never used, but the pathway demonstrably works) are DIFFERENT claims, and
// the badge used to render both — plus `abandoned` — as one amber "dormant". A `not-judged` mark
// prints no value by construction (`rendersValue`), so the distinction cannot quietly rot back into
// a shared adjective.

import { describe, expect, it } from "vitest";
import { rendersValue } from "@/components/org/viz";
import {
  OUTCOME_VIZ_STATE,
  REUSE_AXES,
  reuseRows,
  usageBadgeLabel,
  usageDetail,
  usageVizState,
} from "./skillLifecycleViz";
import type { SkillUsage } from "@/lib/org/skill-usage";
import type { SkillRow } from "@/lib/db";

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

describe("usageVizState", () => {
  it("never-measured is NOT the same state as never-used", () => {
    expect(usageVizState(usage({ state: "unmeasured", verdict: "dormant" }))).toBe("not-judged");
    expect(usageVizState(usage({ state: "unused", verdict: "dormant" }))).toBe("declared");
    expect(usageVizState(usage({ state: "abandoned", verdict: "dormant" }))).toBe("measured");
  });

  it("an unmeasured skill can never print a value — the hatch refuses it structurally", () => {
    expect(rendersValue(usageVizState(usage({ state: "unmeasured", verdict: "dormant" })))).toBe(false);
    expect(rendersValue(usageVizState(usage({ state: "unused", verdict: "dormant" })))).toBe(true);
  });

  it("a row carrying only the coarse verdict is not resolved into a finer state", () => {
    // `dormant` with no state could be any of the three; guessing would invent the distinction.
    expect(usageVizState({ ...usage({}), state: undefined as unknown as SkillUsage["state"], verdict: "dormant" })).toBe(
      "not-judged",
    );
  });

  it("has no state for a skill with no usage row at all", () => {
    expect(usageVizState(undefined)).toBe("not-judged");
  });
});

describe("usageBadgeLabel / usageDetail", () => {
  it("says what each dormant state actually is", () => {
    expect(usageBadgeLabel(usage({ state: "abandoned", verdict: "dormant" }))).toBe("dormant");
    expect(usageBadgeLabel(usage({ state: "unused", verdict: "dormant" }))).toBe("never used");
    expect(usageBadgeLabel(usage({ state: "unmeasured", verdict: "dormant" }))).toBe("not measured");
  });

  it("refuses to claim 'never used' for a skill in an org that measured nothing", () => {
    const detail = usageDetail(usage({ state: "unmeasured", verdict: "dormant", lastUsedAt: null, daysSinceUse: null }));
    expect(detail).not.toMatch(/never used/);
    expect(detail).toMatch(/no skill events recorded in this org/);
  });

  it("still says 'never used' where the pathway works and this skill was not reached for", () => {
    expect(usageDetail(usage({ state: "unused", verdict: "dormant", lastUsedAt: null, daysSinceUse: null }))).toMatch(
      /never used/,
    );
  });

  it("keeps the three verbs apart — a sync is not a use", () => {
    expect(usageDetail(usage({ lastUsedType: "invoke" }))).toMatch(/^invoked/);
    expect(usageDetail(usage({ lastUsedType: "download" }))).toMatch(/^used/);
    expect(usageDetail(usage({ lastUsedType: "sync" }))).toMatch(/^synced/);
  });
});

describe("reuseRows", () => {
  it("prints a share only for Adopted, and hatches it when there is no fleet to divide by", () => {
    const [row] = reuseRows([skill({ adoptionCount: 2 })], { s1: usage({}) }, 4);
    expect(REUSE_AXES).toEqual(["Adopted", "Copied", "Ran"]);
    expect(row.cells[0]).toEqual({ state: "measured", score: 50 });
    expect(row.cells[1].score).toBeUndefined();
    expect(row.cells[2].score).toBeUndefined();

    const [noFleet] = reuseRows([skill({ adoptionCount: 2 })], { s1: usage({}) }, 0);
    expect(noFleet.cells[0].state).toBe("not-judged");
    expect(rendersValue(noFleet.cells[0].state)).toBe(false);
  });

  it("an unadopted / uncopied skill is DECLARED — on paper, never observed in use", () => {
    const [row] = reuseRows([skill({ adoptionCount: 0, downloadCount: 0 })], { s1: usage({ invokes: 0 }) }, 4);
    expect(row.cells.map((c) => c.state)).toEqual(["declared", "declared", "declared"]);
  });

  it("hatches Ran where the org has never emitted an event, rather than claiming it never ran", () => {
    const [row] = reuseRows(
      [skill({})],
      { s1: usage({ state: "unmeasured", verdict: "dormant", invokes: 0 }) },
      4,
    );
    expect(row.cells[2].state).toBe("not-judged");
    const [noUsage] = reuseRows([skill({})], {}, 4);
    expect(noUsage.cells[2].state).toBe("not-judged");
  });

  it("ranks by reach and caps the drawn set", () => {
    const many = Array.from({ length: 14 }, (_, i) => skill({ id: `s${i}`, name: `s${i}`, adoptionCount: i }));
    const rows = reuseRows(many, {}, 20);
    expect(rows).toHaveLength(10);
    expect(rows[0].label).toBe("s13");
  });
});

describe("OUTCOME_VIZ_STATE", () => {
  it("a missing side is a void; an incomparable instrument is a hatch that prints no number", () => {
    expect(OUTCOME_VIZ_STATE["no-after-scan"]).toBe("missing");
    expect(OUTCOME_VIZ_STATE["no-before-scan"]).toBe("missing");
    expect(rendersValue(OUTCOME_VIZ_STATE["instrument-mismatch"])).toBe(false);
    expect(rendersValue(OUTCOME_VIZ_STATE["instrument-unknown"])).toBe(false);
    expect(OUTCOME_VIZ_STATE.measured).toBe("measured");
  });
});
