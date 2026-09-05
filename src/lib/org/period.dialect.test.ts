// The window DIALECT: `orgWindowBounds` replaced the hand-written inclusive `{ start, end }` pair at
// every org call site (Overview, Security, Executive, the briefing PDF route, the weekly digest cron).
//
// The conversion had ONE criterion — it must not change a single number. `ResolvedWindow.end` is
// `endExclusive − 1ms` and nothing else, so for any period this app can produce (every bound is a
// zoned midnight) the half-open `lt: endExclusive` and the inclusive `lte: end` select exactly the
// same rows at JS millisecond resolution. This file measures that rather than asserting it in prose:
// it drives BOTH forms through the real filter builders (`upperBound` / `dateRange` from the db
// layer) over a fixture of scan timestamps that deliberately includes every boundary instant, and
// then through the real aggregates (`getOrgRollup`, `getOrgMovers`, `getOrgTeamRollup`) with the
// captured `where` fragments replayed against the same fixture. Same rows, both dialects.
//
// The value of the migration is therefore NOT a changed number today — it is that the inclusive form
// can no longer spread. The two forms diverge only on sub-millisecond timestamps, and Postgres
// `timestamp` keeps MICROseconds: a scan landing in the 999µs after `end` matches `lte: end` AND the
// next window's `gte: start`, so abutting windows (the briefing's prior period) double-count it.
// `src/lib/db/org-window.test.ts` is the model for the aggregate harness below.
//
// It also pins the second half of the direction: the three readers pick DIFFERENT endpoints out of
// the same bounds, on purpose (see each reader's header comment).

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));

import { dateRange, upperBound } from "@/lib/db/org-shared";
import { getOrgRollup, type OrgWindow } from "@/lib/db/org-rollup";
import { getOrgMovers } from "@/lib/db/org-insights";
import { getOrgTeamRollup } from "@/lib/db/org-teams";
import { resolveWindow } from "@/lib/window";
import { orgWindowBounds } from "@/lib/org/period";

/** Frozen "now" so the presets resolve to fixed instants. */
const NOW = new Date("2026-06-15T12:34:56.000Z");

/** Every period shape the app can produce, resolved through the real window math. */
const PERIODS = [
  { name: "30d preset", w: resolveWindow({ range: "30d" }, NOW) },
  { name: "90d preset (the default)", w: resolveWindow({ range: "90d" }, NOW) },
  { name: "quarter preset", w: resolveWindow({ range: "quarter" }, NOW) },
  { name: "custom range on day boundaries", w: resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW) },
  { name: "single-day custom range", w: resolveWindow({ range: "custom", from: "2026-02-14", to: "2026-02-14" }, NOW) },
  { name: "all time (open-ended)", w: resolveWindow({ range: "all" }, NOW) },
];

/** Evaluate a Prisma date-filter fragment the way the database would. */
function matches(filter: { gte?: Date; lt?: Date; lte?: Date } | undefined, at: Date): boolean {
  if (!filter) return true;
  if (filter.gte && at.getTime() < filter.gte.getTime()) return false;
  if (filter.lt && at.getTime() >= filter.lt.getTime()) return false;
  if (filter.lte && at.getTime() > filter.lte.getTime()) return false;
  return true;
}

/**
 * Scan timestamps around a window, weighted toward the boundaries — where an off-by-one closure shows
 * up. Includes `start`, `start − 1ms`, the inclusive `end` itself, `endExclusive`, and `endExclusive + 1ms`.
 */
function fixtureTimestamps(w: { start: Date | null; endExclusive: Date | null }): Date[] {
  const anchors: number[] = [NOW.getTime(), new Date("2020-01-01T00:00:00.000Z").getTime()];
  for (const b of [w.start, w.endExclusive]) {
    if (!b) continue;
    const t = b.getTime();
    anchors.push(t - 86_400_000, t - 1, t, t + 1, t + 86_400_000);
  }
  return [...new Set(anchors)].sort((a, b) => a - b).map((t) => new Date(t));
}

// ── The two dialects select the same rows ────────────────────────────────────────────────────────

describe("orgWindowBounds — the half-open form selects exactly the rows the inclusive form did", () => {
  for (const { name, w } of PERIODS) {
    it(`agrees with { start, end } for a ${name}`, () => {
      const inclusive: OrgWindow = { start: w.start, end: w.end };
      const halfOpen = orgWindowBounds(w);

      // The adapter carries the half-open bound and no inclusive alias at all.
      expect(halfOpen).toEqual({ start: w.start, endExclusive: w.endExclusive });
      expect("end" in halfOpen).toBe(false);

      // `end` really is `endExclusive − 1ms` — the whole reason the two forms can agree.
      if (w.endExclusive) expect(w.end!.getTime()).toBe(w.endExclusive.getTime() - 1);
      else expect(w.end).toBeNull();

      const before = dateRange(w.start, inclusive).scannedAt;
      const after = dateRange(w.start, halfOpen).scannedAt;

      // Different fragments (`lte` vs `lt`) …
      if (w.endExclusive) {
        expect(before).toMatchObject({ lte: w.end! });
        expect(after).toMatchObject({ lt: w.endExclusive });
      }
      // … selecting an identical row set, boundary instants included.
      const rows = fixtureTimestamps(w);
      const selectedBefore = rows.filter((t) => matches(before, t)).map((d) => d.toISOString());
      const selectedAfter = rows.filter((t) => matches(after, t)).map((d) => d.toISOString());
      expect(selectedAfter).toEqual(selectedBefore);
      // The fixture is not vacuous: the window really does exclude some of its rows.
      if (w.start) expect(selectedAfter.length).toBeLessThan(rows.length);
    });
  }

  it("upperBound HONOURS endExclusive — the adapter's bound is the one the query gets", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    expect(upperBound(orgWindowBounds(w))).toEqual({ lt: w.endExclusive });
    // And the boundary instant itself is OUT under half-open, exactly as it was under `lte: end`.
    expect(matches(upperBound(orgWindowBounds(w))!, w.endExclusive!)).toBe(false);
    expect(matches({ lte: w.end! }, w.endExclusive!)).toBe(false);
  });

  it("passes an open-ended window through unbounded (no bound invented at the edge)", () => {
    const w = resolveWindow({ range: "all" }, NOW);
    expect(orgWindowBounds(w)).toEqual({ start: null, endExclusive: null });
    expect(dateRange(w.start, orgWindowBounds(w))).toEqual({});
  });
});

// ── The aggregates: same fixture, same period, same rows under both dialects ──────────────────────

/** Captures every `where` the aggregate under test issues (scan queries and the repo sub-select). */
function fakePrisma() {
  const scanWheres: Record<string, unknown>[] = [];
  const repoScanSelects: Record<string, unknown>[] = [];
  const prisma = {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", plan: "enterprise", slug: "acme" })) },
    repository: {
      findMany: vi.fn(async (args: { include?: { scans?: Record<string, unknown> }; select?: { scans?: Record<string, unknown> } } = {}) => {
        const scans = args.select?.scans ?? args.include?.scans;
        if (scans) repoScanSelects.push(scans);
        return [];
      }),
    },
    scan: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
        if (args.where) scanWheres.push(args.where);
        return [];
      }),
    },
    scanDimension: { findMany: vi.fn(async () => []) },
  };
  return { prisma, scanWheres, repoScanSelects };
}

/** Run an aggregate with a window and return every `scannedAt` fragment it filtered on. */
async function scannedAtFilters(run: (w: OrgWindow) => Promise<unknown>, w: OrgWindow) {
  const { prisma, scanWheres, repoScanSelects } = fakePrisma();
  mockGetPrisma.mockReturnValue(prisma);
  await run(w);
  const fromRepos = repoScanSelects.map((s) => (s.where as { scannedAt?: object } | undefined)?.scannedAt);
  const fromScans = scanWheres.map((s) => s.scannedAt as object | undefined);
  return [...fromRepos, ...fromScans].filter(Boolean) as { gte?: Date; lt?: Date; lte?: Date }[];
}

const PERIOD = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
const INCLUSIVE: OrgWindow = { start: PERIOD.start, end: PERIOD.end };
const HALF_OPEN: OrgWindow = orgWindowBounds(PERIOD);
const ROWS = fixtureTimestamps(PERIOD);

const AGGREGATES: [string, (w: OrgWindow) => Promise<unknown>][] = [
  ["getOrgRollup", (w) => getOrgRollup("acme", w)],
  ["getOrgMovers", (w) => getOrgMovers("acme", w)],
  ["getOrgTeamRollup", (w) => getOrgTeamRollup("acme", null, null, w)],
];

describe("the aggregates select the same rows whichever dialect the call site speaks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
  });

  for (const [name, run] of AGGREGATES) {
    it(`${name}: every filter it issues matches the same fixture rows under both forms`, async () => {
      const before = await scannedAtFilters(run, INCLUSIVE);
      const after = await scannedAtFilters(run, HALF_OPEN);

      expect(after.length).toBe(before.length);
      expect(after.length).toBeGreaterThan(0);
      after.forEach((f, i) => {
        const selectedAfter = ROWS.filter((t) => matches(f, t)).map((d) => d.toISOString());
        const selectedBefore = ROWS.filter((t) => matches(before[i], t)).map((d) => d.toISOString());
        expect(selectedAfter).toEqual(selectedBefore);
      });
      // The migration's actual effect: the emitted SQL now says `lt`, never `lte`.
      expect(after.some((f) => "lt" in f)).toBe(true);
      expect(after.some((f) => "lte" in f)).toBe(false);
      expect(before.some((f) => "lte" in f)).toBe(true);
    });
  }
});

// ── Endpoint semantics: one bounds convention, three deliberate readings ──────────────────────────

describe("what 'now' means differs BY READER — the same bounds, different endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
  });

  it("getOrgRollup's 'current' has NO lower bound — latest scan at-or-before the window end", async () => {
    const { prisma, repoScanSelects } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getOrgRollup("acme", HALF_OPEN);

    // The fleet-snapshot sub-select is bounded on the UPPER side only: a repo last scanned before
    // `start` still carries its most recent score into the fleet average.
    expect(repoScanSelects[0]!.where).toEqual({ scannedAt: { lt: PERIOD.endExclusive } });
    expect(matches(repoScanSelects[0]!.where as never, new Date("2020-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("getOrgMovers' 'now' is bounded on BOTH sides — a repo unscanned in the period has no move", async () => {
    const { prisma, scanWheres } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getOrgMovers("acme", HALF_OPEN);

    const inWindow = scanWheres.find((w) => (w.scannedAt as { gte?: Date })?.gte)!;
    expect(inWindow.scannedAt).toEqual({ gte: PERIOD.start, lt: PERIOD.endExclusive });
    // The exact divergence the headers document: a pre-window scan is IN the rollup, OUT of movers.
    const stale = new Date("2020-01-01T00:00:00.000Z");
    expect(matches(inWindow.scannedAt as never, stale)).toBe(false);
  });

  it("getOrgTeamRollup reads movers' rule, not the rollup's — latest scan INSIDE the window", async () => {
    const { prisma, scanWheres } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getOrgTeamRollup("acme", null, null, HALF_OPEN);

    const inWindow = scanWheres.find((w) => (w.scannedAt as { gte?: Date })?.gte)!;
    expect(inWindow.scannedAt).toEqual({ gte: PERIOD.start, lt: PERIOD.endExclusive });
  });
});
