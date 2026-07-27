// Pure tests for the skill dormancy verdict: the invoke > download > sync recency ranking, the 30-day
// window, and — the rule most likely to regress — the AGE GUARD that keeps a freshly authored or freshly
// adopted skill out of the "dormant" bucket.

import { describe, it, expect, vi } from "vitest";

// skill-usage only touches the DB through this one reader; mock the boundary so the fold stays pure.
const { mockRows } = vi.hoisted(() => ({ mockRows: vi.fn() }));
vi.mock("@/lib/db", () => ({ getOrgSkillUsageRows: mockRows }));

import {
  DORMANCY_WINDOW_DAYS,
  getOrgSkillUsage,
  skillUsage,
  skillUsageMap,
  usageSummary,
  usageVerdictLabel,
} from "./skill-usage";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const ev = (type: string, days: number, count = 1) => ({ type, lastAt: daysAgo(days), count });

describe("skillUsage verdicts", () => {
  it("is `new` for a young skill with no invokes at all", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(3), events: [] }, NOW);
    expect(u.verdict).toBe("new");
    expect(u.lastUsedAt).toBeNull();
    expect(u.daysSinceUse).toBeNull();
    expect(u.ageDays).toBe(3);
  });

  it("is `dormant` for an old skill that was never used", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(120), events: [] }, NOW);
    expect(u.verdict).toBe("dormant");
    expect(u.lastUsedAt).toBeNull();
  });

  it("is `active` when invoked inside the window", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(200), events: [ev("invoke", 4, 9)] }, NOW);
    expect(u.verdict).toBe("active");
    expect(u.lastUsedType).toBe("invoke");
    expect(u.daysSinceUse).toBe(4);
    expect(u.invokeCount).toBe(9);
  });

  it("is `dormant` when the last invoke fell outside the window", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(200), events: [ev("invoke", 90)] }, NOW);
    expect(u.verdict).toBe("dormant");
    expect(u.daysSinceUse).toBe(90);
  });

  it("treats the window boundary as still active, one day past it as dormant", () => {
    const at = skillUsage({ skillId: "s", createdAt: daysAgo(200), events: [ev("invoke", DORMANCY_WINDOW_DAYS)] }, NOW);
    const past = skillUsage({ skillId: "s", createdAt: daysAgo(200), events: [ev("invoke", DORMANCY_WINDOW_DAYS + 1)] }, NOW);
    expect(at.verdict).toBe("active");
    expect(past.verdict).toBe("dormant");
  });

  it("AGE GUARD: an old skill re-adopted last week is `new`, not dormant", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(400), events: [], adoptedAt: [daysAgo(200), daysAgo(6)] }, NOW);
    expect(u.verdict).toBe("new");
    expect(u.anchorAt).toBe(daysAgo(6));
    expect(u.ageDays).toBe(6);
  });

  it("AGE GUARD does not rescue a skill adopted long ago", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(400), events: [], adoptedAt: [daysAgo(90)] }, NOW);
    expect(u.verdict).toBe("dormant");
  });

  it("a young skill already being invoked reads as active, not new", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(2), events: [ev("invoke", 1)] }, NOW);
    expect(u.verdict).toBe("active");
  });
});

describe("skillUsage lastUsedAt ranking", () => {
  it("prefers the latest invoke even when a download is more recent", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(60), events: [ev("invoke", 10), ev("download", 2)] }, NOW);
    expect(u.lastUsedType).toBe("invoke");
    expect(u.daysSinceUse).toBe(10);
  });

  it("falls back to download, then to a passive sync", () => {
    const dl = skillUsage({ skillId: "s1", createdAt: daysAgo(60), events: [ev("download", 5), ev("sync", 1)] }, NOW);
    expect(dl.lastUsedType).toBe("download");
    expect(dl.verdict).toBe("active"); // a download IS a real use
    const sync = skillUsage({ skillId: "s1", createdAt: daysAgo(60), events: [ev("sync", 3)] }, NOW);
    expect(sync.lastUsedType).toBe("sync");
  });

  it("a scheduled `sync` alone never keeps an old skill 'active'", () => {
    // The CLI emits sync events on every run (including its drift report) — if a pull counted as use,
    // any repo with a cron sync would mask every dormant skill in the library.
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(300), events: [ev("sync", 0, 40)] }, NOW);
    expect(u.verdict).toBe("dormant");
    expect(u.lastUsedType).toBe("sync");
    expect(u.daysSinceUse).toBe(0);
  });

  it("counts every event type in eventCount but only invokes in invokeCount", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(60), events: [ev("invoke", 1, 4), ev("sync", 1, 7)] }, NOW);
    expect(u.eventCount).toBe(11);
    expect(u.invokeCount).toBe(4);
  });

  it("never reports a negative age from a clock-skewed future timestamp", () => {
    const future = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
    const u = skillUsage({ skillId: "s1", createdAt: future, events: [{ type: "invoke", lastAt: future, count: 1 }] }, NOW);
    expect(u.daysSinceUse).toBe(0);
    expect(u.ageDays).toBe(0);
  });
});

describe("skillUsageMap / usageSummary", () => {
  const rows = {
    skills: [
      { id: "a", name: "A", createdAt: daysAgo(2) },
      { id: "b", name: "B", createdAt: daysAgo(300) },
      { id: "c", name: "C", createdAt: daysAgo(300) },
    ],
    events: [
      { skillId: "b", type: "invoke", lastAt: daysAgo(3), count: 5 },
      { skillId: "c", type: "download", lastAt: daysAgo(200), count: 1 },
    ],
    adoptions: [{ skillId: "c", repoFullName: "acme/api", adoptedAt: daysAgo(210) }],
  };

  it("assigns one verdict per skill and only sees its own events", () => {
    const map = skillUsageMap(rows, NOW);
    expect(map.a.verdict).toBe("new");
    expect(map.b.verdict).toBe("active");
    expect(map.c.verdict).toBe("dormant");
    expect(map.a.eventCount).toBe(0);
  });

  it("summarizes the fleet", () => {
    expect(usageSummary(skillUsageMap(rows, NOW))).toEqual({ total: 3, new: 1, active: 1, dormant: 1 });
  });

  it("getOrgSkillUsage returns {} when persistence is off", async () => {
    mockRows.mockResolvedValueOnce(null);
    expect(await getOrgSkillUsage("acme", NOW)).toEqual({});
    mockRows.mockResolvedValueOnce(rows);
    expect(Object.keys(await getOrgSkillUsage("acme", NOW))).toEqual(["a", "b", "c"]);
  });

  it("labels every verdict", () => {
    expect([usageVerdictLabel("new"), usageVerdictLabel("active"), usageVerdictLabel("dormant")]).toEqual([
      "New",
      "Active",
      "Dormant",
    ]);
  });
});
