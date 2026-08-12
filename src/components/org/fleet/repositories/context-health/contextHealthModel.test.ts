// Half-life panel model — the honesty contracts of the REAL rows (W4):
//  · a repo whose latest scan PREDATES contextHealthJson reads as "not assessed — re-scan"
//    (assessed:false), never as fabricated freshness and never as "no context"
//  · a degraded freshness lookup renders potency:null ("unknown"), while quality/drift stay real
//  · fleet summary: coverage % over ASSESSED repos only, median staleness over KNOWN freshness only
//  · urgency ordering: decayed context first, absent later, unassessed last

import { describe, expect, it } from "vitest";
import type { OrgRepoRow } from "@/lib/db/org-rollup";
import type { ContextHealth } from "@/lib/types";
import { buildContextRows, fleetContextSummary, orderByUrgency } from "./contextHealthModel";

function repoRow(over: Partial<OrgRepoRow> = {}): OrgRepoRow {
  return {
    fullName: "acme/app",
    owner: "acme",
    name: "app",
    isPrivate: false,
    watched: true,
    primaryLanguage: "TypeScript",
    techStack: null,
    passport: null,
    contextHealth: null,
    scanSchedule: "off",
    lastScanAt: "2026-08-01T00:00:00.000Z",
    lastScanStatus: "ok",
    lastScanError: null,
    aiConformance: null,
    activity: { commitsWeekly: [7, 7, 7, 7], prsMerged: 0, prsTotal: 0, locChanged: 0 },
    latest: {
      level: "L3",
      overall: 60,
      adoption: 50,
      rigor: 70,
      posture: "balanced",
      scannedAt: "2026-08-01T00:00:00.000Z",
      engine: "anthropic",
      dims: [],
    },
    ...over,
  };
}

function health(over: Partial<ContextHealth> = {}): ContextHealth {
  return {
    version: "1",
    present: true,
    files: [
      {
        path: "CLAUDE.md",
        lastModifiedAt: "2026-07-01T00:00:00.000Z",
        lastCommitSha: "a".repeat(40),
        bytes: 6000,
        sectionsScore: 60,
      },
    ],
    freshness: { score: 40, ageDays: 42, commitsSinceEdit: 42, approximate: true },
    quality: { score: 60, signals: ["Documents build/test/run commands"] },
    drift: { score: 100, refsTotal: 3, deadRefs: [] },
    score: 55,
    ...over,
  };
}

describe("buildContextRows", () => {
  it("PRE-W4 NULL PATH: a scanned repo without contextHealth is assessed:false with the re-scan verdict", () => {
    const [row] = buildContextRows([repoRow({ contextHealth: null })]);
    expect(row).toMatchObject({
      scanned: true,
      assessed: false,
      present: false,
      potency: null,
      band: null,
      commitsSinceEdit: null,
      verdict: "Not assessed by this scan — re-scan to measure context health",
    });
  });

  it("a never-scanned repo says so", () => {
    const [row] = buildContextRows([repoRow({ latest: null, contextHealth: null, activity: null })]);
    expect(row).toMatchObject({ scanned: false, assessed: false, verdict: "Never scanned" });
  });

  it("an assessed repo maps the persisted signal: potency, ≈staleness, quality, drift, half-life", () => {
    const [row] = buildContextRows([repoRow({ contextHealth: health() })]);
    expect(row).toMatchObject({
      assessed: true,
      present: true,
      primaryPath: "CLAUDE.md",
      potency: 40,
      commitsSinceEdit: 42,
      quality: 60,
      band: "aging",
      commitsPerWeek: 7,
    });
    // tolerance = (6000/1000)×(60/12) = 30 → half-life = 30/7×7 = 30 days.
    expect(row!.halfLifeDays).toBeCloseTo(30);
  });

  it("DEGRADED FRESHNESS: potency null renders as unknown (not a fabricated band), quality/drift kept", () => {
    const [row] = buildContextRows([
      repoRow({
        contextHealth: health({
          freshness: { score: null, ageDays: null, commitsSinceEdit: null, approximate: true },
        }),
      }),
    ]);
    expect(row).toMatchObject({ assessed: true, present: true, potency: null, band: null, quality: 60 });
    expect(row!.verdict).toMatch(/Freshness unknown/);
  });

  it("dead refs surface in the verdict when the file is not yet stale", () => {
    const [row] = buildContextRows([
      repoRow({
        contextHealth: health({
          freshness: { score: 80, ageDays: 3, commitsSinceEdit: 3, approximate: true },
          drift: { score: 33, refsTotal: 3, deadRefs: ["docs/gone.md", "src/old.ts"] },
        }),
      }),
    ]);
    expect(row!.verdict).toBe("References 2 files that no longer exist");
  });

  it("absent context on a moving repo names the unguided rate", () => {
    const [row] = buildContextRows([
      repoRow({ contextHealth: health({ present: false, files: [], score: 0, freshness: { score: null, ageDays: null, commitsSinceEdit: null, approximate: true } }) }),
    ]);
    expect(row).toMatchObject({ assessed: true, present: false, band: "absent" });
    expect(row!.verdict).toMatch(/No agent context — 7 commits\/wk landing unguided/);
  });
});

describe("fleetContextSummary + orderByUrgency", () => {
  const rows = buildContextRows([
    repoRow({ fullName: "acme/stale", name: "stale", contextHealth: health({ freshness: { score: 10, ageDays: 90, commitsSinceEdit: 90, approximate: true } }) }),
    repoRow({ fullName: "acme/fresh", name: "fresh", contextHealth: health({ freshness: { score: 90, ageDays: 2, commitsSinceEdit: 2, approximate: true } }) }),
    repoRow({ fullName: "acme/absent", name: "absent", contextHealth: health({ present: false, files: [] }) }),
    repoRow({ fullName: "acme/pre-w4", name: "pre-w4", contextHealth: null }),
  ]);

  it("coverage % is over ASSESSED repos; staleness median over KNOWN freshness only", () => {
    const s = fleetContextSummary(rows);
    expect(s).toMatchObject({
      repos: 4,
      assessed: 3,
      notAssessed: 1,
      withContext: 2,
      coveragePct: 67, // 2/3 assessed
      freshnessKnown: 2,
      pastHalfLife: 1, // only acme/stale (potency 10 < 50)
      unguidedCommits: 92,
      medianStalenessCommits: 90, // median over [2, 90] → upper-middle by floor(len/2)
      deadRefRepos: 0,
      deadRefsTotal: 0,
    });
  });

  it("orders decayed → fresh → absent → unassessed", () => {
    expect(orderByUrgency(rows).map((r) => r.name)).toEqual(["stale", "fresh", "absent", "pre-w4"]);
  });

  it("empty fleet degrades to nulls, not zeros pretending to be measurements", () => {
    const s = fleetContextSummary([]);
    expect(s.coveragePct).toBeNull();
    expect(s.medianStalenessCommits).toBeNull();
    expect(s.medianHalfLifeDays).toBeNull();
  });
});
