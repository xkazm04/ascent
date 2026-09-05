// OrgWindow's HALF-OPEN upper bound — `[start, endExclusive)`.
//
// `src/lib/org/timezone.ts` (policy note 4) made every org interval half-open, and `ResolvedWindow`
// has carried `endExclusive` since. `OrgWindow` — the shape the db layer actually queries with —
// could not carry it, so every fleet aggregate still filtered on the inclusive `lte: end`. The two
// forms agree at MILLISECOND resolution (`end` is `endExclusive − 1ms`), which is why the divergence
// stayed invisible in JS: they diverge only on a timestamp with sub-millisecond precision, and
// Postgres `timestamp` keeps microseconds.
//
// The consequence is not academic where two windows ABUT — the executive briefing's prior period ends
// exactly where the current one starts. Under `lte` a scan landing on the boundary instant is counted
// on BOTH sides: as the prior period's end state and as the current fleet. The movement across that
// boundary is then measured partly against itself.
//
// These tests pin: (a) the bound helper's semantics, including the boundary instant being EXCLUDED;
// (b) that the aggregates emit `lt: endExclusive` rather than `lte: end`; (c) the legacy fallback for
// callers that still only have an inclusive `end`.

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

const START = new Date("2026-05-01T00:00:00.000Z");
const END_EXCLUSIVE = new Date("2026-06-01T00:00:00.000Z");
/** The legacy inclusive end: the last representable MILLISECOND of the same interval. */
const END_INCLUSIVE = new Date(END_EXCLUSIVE.getTime() - 1);

/**
 * Evaluate a Prisma date-filter fragment the way the database would. The point of the test: a scan
 * AT the boundary instant must not match a half-open window.
 */
function matches(filter: { gte?: Date; lt?: Date; lte?: Date }, at: Date): boolean {
  if (filter.gte && at.getTime() < filter.gte.getTime()) return false;
  if (filter.lt && at.getTime() >= filter.lt.getTime()) return false;
  if (filter.lte && at.getTime() > filter.lte.getTime()) return false;
  return true;
}

describe("upperBound — half-open first, inclusive only as a fallback", () => {
  it("prefers lt:endExclusive over lte:end when the window carries both", () => {
    expect(upperBound({ end: END_INCLUSIVE, endExclusive: END_EXCLUSIVE })).toEqual({ lt: END_EXCLUSIVE });
  });

  it("falls back to lte:end for a window that only has the inclusive bound", () => {
    expect(upperBound({ end: END_INCLUSIVE })).toEqual({ lte: END_INCLUSIVE });
  });

  it("is null for an open-ended window (no upper bound at all)", () => {
    expect(upperBound({ start: START } as OrgWindow)).toBeNull();
    expect(upperBound(undefined)).toBeNull();
    expect(upperBound(null)).toBeNull();
  });

  it("EXCLUDES a scan landing exactly on the boundary instant", () => {
    const filter = { gte: START, ...upperBound({ endExclusive: END_EXCLUSIVE })! };
    expect(matches(filter, END_EXCLUSIVE)).toBe(false);
    // ...while the instant one millisecond earlier is still inside.
    expect(matches(filter, new Date(END_EXCLUSIVE.getTime() - 1))).toBe(true);
    // ...and the start instant is inside (the interval is closed on the left).
    expect(matches(filter, START)).toBe(true);
  });

  it("puts a boundary scan in EXACTLY ONE of two abutting windows", () => {
    // The briefing's prior period ends where the current period starts. Under `lte` the boundary scan
    // matched both; under `lt` it belongs to the later window only.
    const prior = { gte: new Date("2026-04-01T00:00:00.000Z"), ...upperBound({ endExclusive: START })! };
    const current = { gte: START, ...(upperBound({ endExclusive: END_EXCLUSIVE }) ?? {}) };
    expect(matches(prior, START)).toBe(false);
    expect(matches(current, START)).toBe(true);
  });

  it("is the bug it replaced: an inclusive end matches the boundary instant in BOTH windows", () => {
    // Regression witness — this is what `lte: end` did when `end` was set to the next window's start.
    const priorInclusive = { gte: new Date("2026-04-01T00:00:00.000Z"), ...upperBound({ end: START })! };
    const current = { gte: START, lt: END_EXCLUSIVE };
    expect(matches(priorInclusive, START)).toBe(true);
    expect(matches(current, START)).toBe(true); // double-counted
  });
});

describe("dateRange — window-shaped bounds", () => {
  it("emits gte + lt for a half-open window", () => {
    expect(dateRange(START, { endExclusive: END_EXCLUSIVE })).toEqual({
      scannedAt: { gte: START, lt: END_EXCLUSIVE },
    });
  });

  it("emits gte + lte for a legacy inclusive window", () => {
    expect(dateRange(START, { end: END_INCLUSIVE })).toEqual({ scannedAt: { gte: START, lte: END_INCLUSIVE } });
  });

  it("stays unbounded when neither edge is given", () => {
    expect(dateRange(null, null)).toEqual({});
    expect(dateRange(null, { end: null, endExclusive: null })).toEqual({});
  });

  it("honors the field override (the recommendation-event query keys on createdAt)", () => {
    expect(dateRange(START, { endExclusive: END_EXCLUSIVE }, "createdAt")).toEqual({
      createdAt: { gte: START, lt: END_EXCLUSIVE },
    });
  });
});

// ── The aggregates actually issue the half-open filter ───────────────────────────────────────────

/** Captures every scan.findMany `where` the aggregate under test issues. */
function fakePrisma() {
  const scanWheres: Record<string, unknown>[] = [];
  const scanFindMany = vi.fn(async (args: { where?: Record<string, unknown>; distinct?: unknown } = {}) => {
    if (args.where) scanWheres.push(args.where);
    return [];
  });
  const repoIncludes: Record<string, unknown>[] = [];
  const prisma = {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", plan: "enterprise", slug: "acme" })) },
    repository: {
      findMany: vi.fn(async (args: { include?: { scans?: Record<string, unknown> } } = {}) => {
        if (args.include?.scans) repoIncludes.push(args.include.scans);
        return [];
      }),
    },
    scan: { findMany: scanFindMany },
    scanDimension: { findMany: vi.fn(async () => []) },
  };
  return { prisma, scanWheres, repoIncludes };
}

describe("the fleet aggregates filter on the half-open bound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
  });

  const half: OrgWindow = { start: START, end: END_INCLUSIVE, endExclusive: END_EXCLUSIVE };
  const legacy: OrgWindow = { start: START, end: END_INCLUSIVE };

  it("getOrgRollup bounds the current fleet snapshot with lt:endExclusive", async () => {
    const { prisma, repoIncludes } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getOrgRollup("acme", half);

    expect(repoIncludes[0]!.where).toEqual({ scannedAt: { lt: END_EXCLUSIVE } });
  });

  it("getOrgRollup bounds the maturity trend query with lt:endExclusive", async () => {
    const { prisma, scanWheres } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getOrgRollup("acme", half);

    const trend = scanWheres.find((w) => (w.scannedAt as { gte?: Date })?.gte);
    expect(trend!.scannedAt).toMatchObject({ lt: END_EXCLUSIVE });
    expect(trend!.scannedAt).not.toHaveProperty("lte");
  });

  it("getOrgRollup still honors a legacy inclusive-only window (lte:end)", async () => {
    const { prisma, repoIncludes } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getOrgRollup("acme", legacy);

    expect(repoIncludes[0]!.where).toEqual({ scannedAt: { lte: END_INCLUSIVE } });
  });

  it("getOrgMovers bounds its in-window query with lt:endExclusive — a boundary scan is not 'now'", async () => {
    const { prisma, scanWheres } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getOrgMovers("acme", half);

    const inWindow = scanWheres.find((w) => (w.scannedAt as { gte?: Date })?.gte)!;
    expect(inWindow.scannedAt).toEqual({ gte: START, lt: END_EXCLUSIVE });
    expect(matches(inWindow.scannedAt as { gte: Date; lt: Date }, END_EXCLUSIVE)).toBe(false);
  });

  it("getOrgTeamRollup bounds its in-window query with lt:endExclusive", async () => {
    const { prisma, scanWheres } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getOrgTeamRollup("acme", null, null, half);

    const inWindow = scanWheres.find((w) => (w.scannedAt as { gte?: Date })?.gte)!;
    expect(inWindow.scannedAt).toEqual({ gte: START, lt: END_EXCLUSIVE });
  });
});
