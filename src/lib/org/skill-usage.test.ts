// Pure tests for the skill dormancy verdict: the download > sync recency ranking, the 30-day window,
// and — the rule most likely to regress — the AGE GUARD that keeps a freshly authored or freshly adopted
// skill out of the "dormant" bucket.
//
// ONE SIGNAL (2026-07-29): `invoke` is gone (it had no producer, so `active` was unreachable), and the
// web-UI Copy/Download path now emits the same `download` event the CLI reports — pinned below by the
// test that a web use and a CLI use land in the SAME verdict.

import { describe, it, expect, vi } from "vitest";

// skill-usage only touches the DB through this one reader; mock the boundary so the fold stays pure.
const { mockRows } = vi.hoisted(() => ({ mockRows: vi.fn() }));
vi.mock("@/lib/db", () => ({ getOrgSkillUsageRows: mockRows }));

import { getOrgSkillUsage } from "./skill-usage-load";
import {
  DORMANCY_WINDOW_DAYS,
  DORMANCY_WINDOW_MAX_DAYS,
  dormancyWindowFor,
  isPruneCandidate,
  skillUsage,
  skillUsageMap,
  usageStateLabel,
  usageSummary,
  usageVerdictLabel,
} from "./skill-usage";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const ev = (type: string, days: number, count = 1) => ({ type, lastAt: daysAgo(days), count });

describe("skillUsage verdicts", () => {
  it("is `new` for a young skill with no uses at all", () => {
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

  it("is `active` when used inside the window", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(200), events: [ev("download", 4, 9)] }, NOW);
    expect(u.verdict).toBe("active");
    expect(u.lastUsedType).toBe("download");
    expect(u.daysSinceUse).toBe(4);
    expect(u.useCount).toBe(9);
  });

  it("is `dormant` when the last use fell outside the window", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(200), events: [ev("download", 90)] }, NOW);
    expect(u.verdict).toBe("dormant");
    expect(u.daysSinceUse).toBe(90);
  });

  it("treats the window boundary as still active, one day past it as dormant", () => {
    const at = skillUsage({ skillId: "s", createdAt: daysAgo(200), events: [ev("download", DORMANCY_WINDOW_DAYS)] }, NOW);
    const past = skillUsage({ skillId: "s", createdAt: daysAgo(200), events: [ev("download", DORMANCY_WINDOW_DAYS + 1)] }, NOW);
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

  it("a young skill already being used reads as active, not new", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(2), events: [ev("download", 1)] }, NOW);
    expect(u.verdict).toBe("active");
  });

  // THE CONTRADICTION THIS DIRECTION CLOSED: a web-UI Copy/Download used to bump only the "N uses"
  // counter (OrgSkillDownload) and never write an OrgSkillEvent, so a heavily-copied skill rendered
  // "40 uses" and "dormant" on the same card. recordSkillDownload now emits the same `download` event
  // the CLI reports, so both producers must fold to an IDENTICAL verdict.
  it("a web-UI download and a CLI-reported download land in the same verdict", () => {
    const base = { skillId: "s1", createdAt: daysAgo(200) };
    const web = skillUsage({ ...base, events: [ev("download", 3, 40)] }, NOW);
    const cli = skillUsage({ ...base, events: [ev("download", 3, 40)] }, NOW);
    expect(web).toEqual(cli);
    expect(web.verdict).toBe("active");
    expect(web.useCount).toBe(40);
    // …and 40 uses can no longer read as dormant.
    expect(web.verdict).not.toBe("dormant");
  });
});

describe("skillUsage lastUsedAt ranking", () => {
  it("prefers the latest download even when a sync is more recent", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(60), events: [ev("download", 10), ev("sync", 2)] }, NOW);
    expect(u.lastUsedType).toBe("download");
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

  it("counts every event type in eventCount but only real uses in useCount", () => {
    const u = skillUsage({ skillId: "s1", createdAt: daysAgo(60), events: [ev("download", 1, 4), ev("sync", 1, 7)] }, NOW);
    expect(u.eventCount).toBe(11);
    expect(u.useCount).toBe(4);
  });

  it("never reports a negative age from a clock-skewed future timestamp", () => {
    const future = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
    const u = skillUsage({ skillId: "s1", createdAt: future, events: [{ type: "download", lastAt: future, count: 1 }] }, NOW);
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
      { skillId: "b", type: "download", lastAt: daysAgo(3), count: 5 },
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

  it("summarizes the fleet, splitting the dormant bucket by what is actually known", () => {
    expect(usageSummary(skillUsageMap(rows, NOW))).toEqual({
      total: 3,
      new: 1,
      active: 1,
      dormant: 1,
      abandoned: 1, // …and the one dormant skill is a REAL prune candidate: it was used, then dropped
      unused: 0,
      unmeasured: 0,
    });
  });

  it("an org whose event pathway has NEVER emitted marks its silent skills `unmeasured`", () => {
    const silent = { ...rows, events: [] };
    const map = skillUsageMap(silent, NOW);
    expect(map.b.state).toBe("unmeasured");
    expect(map.b.verdict).toBe("dormant"); // the badge is unchanged…
    expect(isPruneCandidate(map.b)).toBe(false); // …but nothing may be pruned on absent data
    expect(usageSummary(map)).toMatchObject({ dormant: 2, unmeasured: 2, abandoned: 0, unused: 0 });
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

  it("labels each state distinctly — three remedies, three sentences", () => {
    const states = ["new", "active", "abandoned", "unused", "unmeasured"] as const;
    expect(new Set(states.map(usageStateLabel)).size).toBe(5);
  });
});

// ── D24: `dormant` is a badge, not a decision ────────────────────────────────────────────────────
describe("the three states inside dormant", () => {
  const old = (over: Partial<Parameters<typeof skillUsage>[0]> = {}) =>
    skillUsage({ skillId: "s", createdAt: daysAgo(300), events: [], ...over }, NOW);

  it("`abandoned` — really used once, then silence: the honest prune candidate", () => {
    const u = old({ events: [ev("download", 200)] });
    expect(u.state).toBe("abandoned");
    expect(u.verdict).toBe("dormant");
    expect(isPruneCandidate(u)).toBe(true);
  });

  it("`unused` — never touched but the pathway works: a DISCOVERY problem, not a prune candidate", () => {
    const u = old({ orgHasTelemetry: true });
    expect(u.state).toBe("unused");
    expect(u.verdict).toBe("dormant");
    expect(isPruneCandidate(u)).toBe(false);
  });

  it("REGRESSION: an uninstrumented pathway can no longer nominate a skill for deletion", () => {
    // The whole point: before the split, this skill sat in the same `dormant` bucket as the abandoned
    // one above, so a library with NO telemetry at all proposed deleting everything in it.
    const u = old({ orgHasTelemetry: false });
    expect(u.state).toBe("unmeasured");
    expect(isPruneCandidate(u)).toBe(false);
  });

  it("a sync-only skill is still abandoned-by-silence, never `unused`", () => {
    // `sync` is a pull, not a use — but it does prove the pathway emits, so this is not `unmeasured`.
    const u = old({ events: [ev("sync", 1, 40)], orgHasTelemetry: false });
    expect(u.state).toBe("unused");
  });
});

// ── D44: the window is derived from the artifact's own cadence ───────────────────────────────────
describe("dormancyWindowFor", () => {
  it("falls back to the constant when there is no cadence to derive one from", () => {
    expect(dormancyWindowFor({ ageDays: 300, useCount: 0 })).toBe(DORMANCY_WINDOW_DAYS);
    expect(dormancyWindowFor({ ageDays: 300, useCount: 1 })).toBe(DORMANCY_WINDOW_DAYS); // one use is not a cadence
  });

  it("derives a longer window from the observed rhythm, and never a shorter one", () => {
    expect(dormancyWindowFor({ ageDays: 200, useCount: 5 })).toBe(80); // a 40-day rhythm ⇒ 2 cycles
    expect(dormancyWindowFor({ ageDays: 30, useCount: 10 })).toBe(DORMANCY_WINDOW_DAYS); // floor holds
  });

  it("a declared cadence wins, and the derivation is clamped at the ceiling", () => {
    expect(dormancyWindowFor({ cadenceDays: 90, ageDays: 30, useCount: 10 })).toBe(DORMANCY_WINDOW_MAX_DAYS);
    expect(dormancyWindowFor({ cadenceDays: 45, ageDays: 300, useCount: 0 })).toBe(90);
  });

  it("REGRESSION: a quarterly skill used exactly as intended is not branded dormant", () => {
    // A release checklist pulled once a quarter: 4 uses over a year, last used 70 days ago. Under the
    // flat 30-day window this read `dormant` for two months of every three and became a prune candidate.
    const u = skillUsage({ skillId: "s", createdAt: daysAgo(365), events: [ev("download", 70, 4)] }, NOW);
    // 4 uses over a year ⇒ a ~91-day rhythm, 2 cycles = 182, clamped to the 120-day ceiling.
    expect(u.windowDays).toBe(DORMANCY_WINDOW_MAX_DAYS);
    expect(u.verdict).toBe("active");
  });

  it("the SAME window governs the age guard, so nothing can be new and dormant at once", () => {
    // A declared-quarterly skill 100 days old with no uses: the age guard must use the derived 180-day
    // window too, or it would be `dormant` (>30 days silent) and `new` (<180 days old) simultaneously.
    const u = skillUsage({ skillId: "s", createdAt: daysAgo(100), events: [], cadenceDays: 90 }, NOW);
    expect(u.windowDays).toBe(DORMANCY_WINDOW_MAX_DAYS);
    expect(u.verdict).toBe("new");
    expect(u.state).toBe("new");
  });
});
