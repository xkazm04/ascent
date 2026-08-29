// The registry `usage/` lane meeting the dormancy verdict (#19, sink B) — `skillUsageMap` folding
// `SkillUsageRows.samples` into the same fold that already reads `OrgSkillEvent`.
//
// Two rules are pinned here and nowhere else:
//   1. a sample WITH a `lastUsed` inside the window makes the skill `active`;
//   2. a sample WITHOUT one contributes a count and leaves the skill `unused` — never `active`.
// (2) is the one worth a test of its own: the fold could so easily reach for `generatedAt`, which a
// registry rewrites on every publish, and every skill in the library would read `active` forever.

import { describe, expect, it } from "vitest";
import { skillUsageMap } from "./skill-usage";
import type { SkillUsageRows } from "@/lib/db";

const NOW = new Date("2026-08-29T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const rows = (over: Partial<SkillUsageRows> = {}): SkillUsageRows => ({
  skills: [{ id: "s1", name: "deploy-check", createdAt: daysAgo(400) }],
  events: [],
  adoptions: [],
  samples: [],
  ...over,
});

const sampleRow = (over: Partial<SkillUsageRows["samples"][number]> = {}) => ({
  registryId: "reg1",
  orgId: "org1",
  contributor: "acme-ci",
  skillName: "deploy-check",
  invokes: 6,
  windowDays: 30,
  lastUsedAt: daysAgo(4),
  generatedAt: daysAgo(0),
  ...over,
});

describe("skillUsageMap with registry usage samples", () => {
  it("makes a skill ACTIVE on a sample whose lastUsed is inside the window", () => {
    const map = skillUsageMap(rows({ samples: [sampleRow()] }), NOW);
    expect(map.s1!.verdict).toBe("active");
    expect(map.s1!.lastUsedType).toBe("invoke");
    expect(map.s1!.invokes).toBe(6);
    expect(map.s1!.daysSinceUse).toBe(4);
  });

  it("leaves a skill UNUSED when the sample reports a count but no lastUsed", () => {
    // FAIL-BEFORE (the bug this forbids): a `generatedAt` fallback would read `daysSinceUse: 0` and
    // flip the verdict to `active` on the strength of the file having been regenerated today.
    const map = skillUsageMap(rows({ samples: [sampleRow({ lastUsedAt: null })] }), NOW);
    expect(map.s1!.verdict).toBe("dormant");
    expect(map.s1!.state).toBe("unused");
    expect(map.s1!.lastUsedAt).toBeNull();
    expect(map.s1!.daysSinceUse).toBeNull();
    // The count is still real and still reaches the card.
    expect(map.s1!.invokes).toBe(6);
    expect(map.s1!.useCount).toBe(6);
  });

  it("a recency-less sample still proves the pathway works — the skill is `unused`, not `unmeasured`", () => {
    const map = skillUsageMap(rows({ samples: [sampleRow({ lastUsedAt: null })] }), NOW);
    expect(map.s1!.state).not.toBe("unmeasured");
  });

  it("is genuinely `unmeasured` when neither an event nor a sample exists anywhere in the org", () => {
    expect(skillUsageMap(rows(), NOW).s1!.state).toBe("unmeasured");
  });

  it("ignores a sample naming a skill the org does not mirror", () => {
    const map = skillUsageMap(rows({ samples: [sampleRow({ skillName: "somebody-elses" })] }), NOW);
    expect(map.s1!.state).toBe("unmeasured");
    expect(map.s1!.invokes).toBe(0);
  });

  it("merges the two sinks: an events-API invoke and a registry sample land on the same skill", () => {
    const map = skillUsageMap(
      rows({
        events: [{ skillId: "s1", type: "invoke", lastAt: daysAgo(10), count: 2 }],
        samples: [sampleRow({ invokes: 6, lastUsedAt: daysAgo(3) })],
      }),
      NOW,
    );
    expect(map.s1!.invokes).toBe(8);
    // The later of the two instants wins — the fold is one timeline, not two.
    expect(map.s1!.daysSinceUse).toBe(3);
  });

  it("does not let an out-of-window sample outrank a recent download", () => {
    const map = skillUsageMap(
      rows({
        events: [{ skillId: "s1", type: "download", lastAt: daysAgo(2), count: 1 }],
        samples: [sampleRow({ lastUsedAt: daysAgo(200) })],
      }),
      NOW,
    );
    expect(map.s1!.lastUsedType).toBe("download");
    expect(map.s1!.daysSinceUse).toBe(2);
  });

  it("tolerates rows with no samples key at all (a caller built before the field existed)", () => {
    const legacy = { skills: rows().skills, events: [], adoptions: [] } as unknown as SkillUsageRows;
    expect(skillUsageMap(legacy, NOW).s1!.state).toBe("unmeasured");
  });
});
