// The retire sweep's pure half. Pins the three things a destructive bulk action must get right before
// any JSX exists: the SCOPE (isPruneCandidate is the only selector, so `unused`/`unmeasured` can never
// be offered), the BLAST RADIUS (the repos/last use/window the panel must show before it asks), and the
// ACCOUNTING (the number the confirm quoted vs the number the server actually retired).

import { describe, expect, it } from "vitest";
import type { SkillAdoption, SkillRow } from "@/lib/db";
import type { SkillUsage, SkillUsageState } from "@/lib/org/skill-usage";
import {
  blastRadiusLabel,
  confirmLine,
  judgedWindowLabel,
  lastUseLabel,
  REGISTRY_REFUSAL,
  RETIRE_SCOPE_SENTENCE,
  retirableIds,
  retireCandidates,
  sweepOutcomeLine,
} from "./skillRetireModel";

function skill(id: string, o: Partial<SkillRow> = {}): SkillRow {
  return {
    id,
    name: id,
    description: "",
    content: "",
    category: "workflow",
    tags: [],
    frontmatter: {} as SkillRow["frontmatter"],
    version: 1,
    contentHash: "",
    downloadCount: 0,
    adoptionCount: 0,
    archived: false,
    origin: "hosted",
    registryPath: null,
    registryVersion: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...o,
  } as SkillRow;
}

function usage(id: string, state: SkillUsageState, o: Partial<SkillUsage> = {}): SkillUsage {
  return {
    skillId: id,
    verdict: state === "new" || state === "active" ? state : "dormant",
    state,
    lastUsedAt: "2026-02-01T00:00:00.000Z",
    lastUsedType: "invoke",
    lastUsedSource: "cli",
    daysSinceUse: 44,
    useCount: 3,
    invokes: 3,
    eventCount: 3,
    anchorAt: "2026-01-01T00:00:00.000Z",
    ageDays: 90,
    windowDays: 30,
    ...o,
  };
}

/** 3 abandoned + 2 unused + 4 unmeasured, the acceptance library. */
function library() {
  const states: [string, SkillUsageState][] = [
    ["a1", "abandoned"],
    ["a2", "abandoned"],
    ["a3", "abandoned"],
    ["u1", "unused"],
    ["u2", "unused"],
    ["m1", "unmeasured"],
    ["m2", "unmeasured"],
    ["m3", "unmeasured"],
    ["m4", "unmeasured"],
  ];
  const skills = states.map(([id]) => skill(id));
  const usageMap: Record<string, SkillUsage> = {};
  for (const [id, state] of states) usageMap[id] = usage(id, state);
  return { skills, usage: usageMap };
}

describe("retireCandidates - scope", () => {
  it("offers exactly the abandoned skills; unused and unmeasured are absent", () => {
    const { skills, usage: u } = library();
    const rows = retireCandidates(skills, u, {});
    expect(rows.map((r) => r.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("offers nothing when no skill is abandoned", () => {
    const skills = [skill("u1"), skill("m1"), skill("n1")];
    const u = { u1: usage("u1", "unused"), m1: usage("m1", "unmeasured"), n1: usage("n1", "new") };
    expect(retireCandidates(skills, u, {})).toEqual([]);
  });

  it("names the preserved core in one sentence, without naming an unrelated state", () => {
    expect(RETIRE_SCOPE_SENTENCE).toMatch(/never used/i);
    expect(RETIRE_SCOPE_SENTENCE).toMatch(/never measured/i);
    expect(RETIRE_SCOPE_SENTENCE).not.toMatch(/—/);
  });

  it("skips a skill with no usage row at all - absent data is never a prune candidate", () => {
    expect(retireCandidates([skill("ghost")], {}, {})).toEqual([]);
  });
});

describe("retireCandidates - blast radius", () => {
  it("carries the adopted repos, the last use, the days since and the judged window", () => {
    const adoption: Record<string, SkillAdoption> = {
      a1: { repos: 2, adoptedRepos: ["o/one", "o/two"] },
    };
    const rows = retireCandidates([skill("a1"), skill("a2")], { a1: usage("a1", "abandoned"), a2: usage("a2", "abandoned", { windowDays: 90, daysSinceUse: 120 }) }, adoption);
    expect(rows[0].adoptedRepos).toEqual(["o/one", "o/two"]);
    expect(rows[0].lastUsedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(rows[0].daysSinceUse).toBe(44);
    expect(rows[0].windowDays).toBe(30);
    expect(rows[1].adoptedRepos).toEqual([]);
    expect(rows[1].windowDays).toBe(90);
    expect(rows[1].daysSinceUse).toBe(120);
  });

  it("reads the repo count as a sentence, singular, plural and none", () => {
    expect(blastRadiusLabel(["o/one", "o/two"])).toBe("2 repos recorded this");
    expect(blastRadiusLabel(["o/one"])).toBe("1 repo recorded this");
    expect(blastRadiusLabel([])).toBe("no repo recorded this");
  });

  it("states the window it was judged against and the last use", () => {
    expect(judgedWindowLabel(30)).toBe("judged against 30 days of silence");
    expect(lastUseLabel("2026-02-01T00:00:00.000Z", 44)).toBe("last used 2026-02-01, 44 days ago");
    expect(lastUseLabel("2026-02-01T00:00:00.000Z", 1)).toBe("last used 2026-02-01, 1 day ago");
    expect(lastUseLabel(null, null)).toBe("never used");
  });
});

describe("retireCandidates - the preserved core", () => {
  it("lists a registry-origin candidate as not retirable, with the reason", () => {
    const rows = retireCandidates(
      [skill("a1"), skill("r1", { origin: "registry", registryPath: "skills/r1/SKILL.md" })],
      { a1: usage("a1", "abandoned"), r1: usage("r1", "abandoned") },
      {},
    );
    expect(rows.map((r) => r.id)).toEqual(["a1", "r1"]);
    expect(rows[0].retirable).toBe(true);
    expect(rows[0].reason).toBeNull();
    expect(rows[1].retirable).toBe(false);
    expect(rows[1].reason).toBe(REGISTRY_REFUSAL);
    expect(REGISTRY_REFUSAL).toMatch(/restore/i);
  });

  it("retirableIds excludes every row the model refused", () => {
    const rows = retireCandidates(
      [skill("a1"), skill("r1", { origin: "registry" }), skill("a2")],
      { a1: usage("a1", "abandoned"), r1: usage("r1", "abandoned"), a2: usage("a2", "abandoned") },
      {},
    );
    expect(retirableIds(rows)).toEqual(["a1", "a2"]);
  });
});

describe("accounting - the confirm quotes a count, the result reconciles it", () => {
  it("quotes the candidate count in the ask", () => {
    expect(confirmLine(3)).toBe("Retire 3 skills?");
    expect(confirmLine(1)).toBe("Retire 1 skill?");
  });

  it("reports the plain count when the server agreed", () => {
    expect(sweepOutcomeLine(3, 3, 0)).toBe("Retired 3 skills.");
    expect(sweepOutcomeLine(1, 1, 0)).toBe("Retired 1 skill.");
  });

  it("reports the DIFFERENCE, not the optimistic number, when the server retired fewer", () => {
    const line = sweepOutcomeLine(3, 2, 1);
    expect(line).toContain("2 of 3");
    expect(line).toMatch(/1 (was )?skipped/i);
    expect(line).not.toBe("Retired 3 skills.");
  });

  it("says so when the server retired nothing", () => {
    expect(sweepOutcomeLine(2, 0, 2)).toContain("0 of 2");
  });
});
