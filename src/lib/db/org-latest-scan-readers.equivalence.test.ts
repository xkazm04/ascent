// rollups-0 (challenge-2026-10-22): moving the fleet readers onto the latest-scan door changes how
// many Scan rows cross the wire (org-rollup-queries.test.ts) and NOTHING the caller sees.
//
// The oracle is history-independence plus the TIE RULE: each reader, run over a fleet with 30 scans per
// repo (and, on one repo, two scans at the SAME latest instant whose payloads differ), returns exactly
// the object it returns over a fleet holding only the scans the old nested `take` kept - the latest per
// repo (the latest two for the team rollup), an equal `scannedAt` resolved to the greatest id. The
// double serves the old nested shape too, so this suite is green before the migration by design: it
// pins that the migration is invisible, which a red-first test cannot.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({ mockIsDbConfigured: vi.fn(() => true), mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));

import { getOrgDiscrepancies, getOrgGapAnalysis, getOrgPractices, getOrgRecommendations } from "./org-insights";
import { getOrgActivity, getOrgDimensionGaps, getOrgGovernance, getOrgPrSignals } from "./org-signals";
import { getOrgTeamRollup } from "./org-teams";
import { getOrgHeaderSummary, getRepoStates } from "./org-rollup";
import { getOrgRework } from "./org-rework";
import { getOrgNavCounts } from "./org-nav-counts";
import { getOrgPracticeShapes } from "./org-practice-shapes";
import { getStanceRepoFacts } from "./org-stance";
import { enrichFleet, fleetPrisma, makeFleet, oldPick, type Fleet, type FleetScan } from "./org-rollup-latest-scans.test-helpers";

/** 12 repos x 30 scans, plus a TIE on r003: a second scan at its latest instant, a greater id, and a
 *  different payload (scores, blobs, recommendation), so the tie rule is observable in every reader. */
function fixture(): Fleet {
  const fleet = enrichFleet(makeFleet(12, 30));
  const latest = oldPick(fleet, undefined).get("r003")![0]!;
  const twin = enrichFleet({ repos: fleet.repos, scans: [{ ...latest, overallScore: (latest.overallScore + 41) % 100 }] }).scans[0]!;
  return { repos: fleet.repos, scans: [...fleet.scans, { ...twin, id: `${latest.id}-z` } as FleetScan] };
}

/** The fleet as the old nested `take` would have seen it: only the scans it kept. */
function keptOnly(fleet: Fleet, take: number): Fleet {
  return { repos: fleet.repos, scans: [...oldPick(fleet, undefined, take).values()].flat() };
}

async function run(fleet: Fleet, reader: () => Promise<unknown>) {
  mockGetPrisma.mockReturnValue(fleetPrisma(fleet).prisma);
  return reader();
}

const READERS: [string, () => Promise<unknown>, number][] = [
  ["getOrgPractices", () => getOrgPractices("acme"), 1],
  ["getOrgGapAnalysis", () => getOrgGapAnalysis("acme"), 1],
  ["getOrgRecommendations", () => getOrgRecommendations("acme"), 1],
  ["getOrgDiscrepancies", () => getOrgDiscrepancies("acme"), 1],
  ["getOrgPrSignals", () => getOrgPrSignals("acme"), 1],
  ["getOrgGovernance", () => getOrgGovernance("acme"), 1],
  ["getOrgDimensionGaps", () => getOrgDimensionGaps("acme", "D2"), 1],
  ["getOrgActivity", () => getOrgActivity("acme"), 1],
  ["getOrgHeaderSummary", () => getOrgHeaderSummary("acme"), 1],
  ["getRepoStates", () => getRepoStates("acme"), 1],
  ["getOrgRework", () => getOrgRework("acme"), 1],
  ["getOrgNavCounts", () => getOrgNavCounts("acme"), 1],
  ["getOrgPracticeShapes", () => getOrgPracticeShapes("acme"), 1],
  ["getStanceRepoFacts", () => getStanceRepoFacts("acme"), 1],
  ["getOrgTeamRollup", () => getOrgTeamRollup("acme"), 2],
];

beforeEach(() => {
  mockIsDbConfigured.mockReturnValue(true);
});

describe.each(READERS)("%s - same object over the full history as over the kept scans", (_name, reader, take) => {
  it("ignores every scan the old shape discarded, and resolves an equal scannedAt to the greatest id", async () => {
    const fleet = fixture();
    const full = await run(fleet, reader);
    const kept = await run(keptOnly(fleet, take), reader);
    expect(full).not.toBeNull();
    expect(full).toEqual(kept);
  });
});

describe("the fixture really exercises the tie", () => {
  it("r003's kept scan is the greater-id twin, whose payload differs from the scan it ties", () => {
    const fleet = fixture();
    const [kept] = oldPick(fleet, undefined).get("r003")!;
    expect(kept!.id.endsWith("-z")).toBe(true);
    const tied = fleet.scans.find((s) => s.repoId === "r003" && s.scannedAt.getTime() === kept!.scannedAt.getTime() && s.id !== kept!.id)!;
    expect(tied.prStats).not.toEqual(kept!.prStats);
  });
});
