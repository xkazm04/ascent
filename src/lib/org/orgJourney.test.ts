import { describe, expect, it } from "vitest";

import { nextMoveFor, ORG_STAGES, ORG_TAB_STAGE, stageOf } from "./orgJourney";
import { ORG_NAV_GROUPS, ORG_TABS_NOT_IN_NAV, type OrgTabId } from "./orgTabs";

const navIds = ORG_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
const staged = Object.keys(ORG_TAB_STAGE) as OrgTabId[];

// The addendum's section 2, Journey B "next move" column (docs/adr/2026-09-14-org-path-of-use.md),
// in ORG_TAB_IDS order. Hand-written on purpose: it is the spec the declaration is checked against.
const B_NEXT_MOVE: Record<string, string> = {
  overview: "proposals",
  executive: "overview",
  digest: "overview",
  repositories: "overview",
  "tech-stacks": "proposals",
  passports: "overview",
  live: "executive",
  proposals: "live",
  lessons: "live",
  security: "proposals",
  adoption: "overview",
  delivery: "overview",
  contributors: "overview",
  teams: "overview",
  practices: "live",
  registry: "repositories",
  skills: "live",
  memory: "executive",
  knowledge: "executive",
  members: "repositories",
  governance: "proposals",
  integrations: "repositories",
  pairing: "repositories",
  audit: "executive",
  settings: "repositories",
};

describe("org journey B declaration", () => {
  it("assigns every on-rail id exactly one stage", () => {
    expect([...staged].sort()).toEqual([...navIds].sort());
    expect(new Set(staged).size).toBe(navIds.length);
    for (const id of navIds) expect(stageOf(id)).toBeDefined();
  });

  it("assigns no stage to an id that is not on the rail", () => {
    for (const id of ORG_TABS_NOT_IN_NAV) {
      expect(ORG_TAB_STAGE[id]).toBeUndefined();
      expect(stageOf(id)).toBeUndefined();
      expect(nextMoveFor(id)).toBeUndefined();
    }
  });

  it("has six stages in order, the first two first-run", () => {
    expect(ORG_STAGES.map((s) => s.id)).toEqual(["connect", "scan", "read", "decide", "apply", "measure"]);
    expect(ORG_STAGES.map((s) => s.firstRun)).toEqual([true, true, false, false, false, false]);
  });

  it("pins the per-stage counts at 5/2/4/4/4/6", () => {
    const counts = ORG_STAGES.map((s) => staged.filter((id) => ORG_TAB_STAGE[id] === s.id).length);
    expect(counts).toEqual([5, 2, 4, 4, 4, 6]);
  });

  it("assigns each stage's entry tab to that stage", () => {
    for (const s of ORG_STAGES) expect(ORG_TAB_STAGE[s.entryTab]).toBe(s.id);
  });

  it("matches the addendum's B next-move column for all 25 rows", () => {
    expect(Object.keys(B_NEXT_MOVE)).toHaveLength(25);
    for (const [id, next] of Object.entries(B_NEXT_MOVE)) {
      expect(nextMoveFor(id as OrgTabId), id).toBe(next);
    }
  });
});
