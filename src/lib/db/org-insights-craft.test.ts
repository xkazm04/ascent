// THE CRAFT LEDGER — the odometer's read, and the guarantee that craft stays out of every debt path.
//
// Two halves, both structural rather than cosmetic:
//   1. `getCraftLedger` / `getCraftItems` / `getCraftBuilt` ask for `kind: "craft"` and count only
//      BUILT rungs, deduped on the recommendation's stable identity.
//   2. Every DEBT and FINDING query in the codebase filters `kind: "gap"` at the `where` — asserted
//      by recording the args each one actually sends to Prisma. This is the assertion that matters:
//      a craft entry that leaked into the backlog would be indistinguishable from debt at every
//      surface downstream (the overdue tile, the nav badge, the drive's stop condition), and the leak
//      would be invisible until a green repo reported gaps it does not have.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  dbReadSafe: async <T>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
}));

import { getCraftBuilt, getCraftItems, getCraftLedger } from "./org-insights-craft";
import { getOrgBacklog } from "./org-insights";
import { getOrgNavCounts } from "./org-nav-counts";

type Args = Record<string, unknown>;
type Rec = { dimId: string; title: string; craftAxis: string | null };

/** Records every recommendation query's args so the `where` can be asserted, not the payload. */
function prismaDouble(recs: Array<Record<string, unknown>>) {
  const recCalls: Args[] = [];
  return {
    recCalls,
    client: {
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme", timezone: null })) },
      repository: {
        findUnique: vi.fn(async () => ({ id: "repo_1", fullName: "acme/widget" })),
        findMany: vi.fn(async () => [{ id: "repo_1", fullName: "acme/widget", name: "widget", scans: [{ recommendations: [] }] }]),
      },
      scan: {
        findFirst: vi.fn(async () => ({ id: "scan_1" })),
        findMany: vi.fn(async () => []),
        groupBy: vi.fn(async () => []),
      },
      scanDimension: { findMany: vi.fn(async () => []) },
      recommendation: {
        findMany: vi.fn(async (args: Args = {}) => {
          recCalls.push(args);
          return recs;
        }),
      },
      recommendationEvent: { groupBy: vi.fn(async () => []) },
      repoContributor: { findMany: vi.fn(async () => []) },
      invite: { count: vi.fn(async () => 0) },
    },
  };
}

const rec = (dimId: string, title: string, craftAxis: string | null): Rec => ({ dimId, title, craftAxis });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getCraftLedger — the odometer", () => {
  it("counts BUILT rungs per axis, with every axis present at zero", async () => {
    const d = prismaDouble([
      rec("D2", "A performance budget that fails CI", "performance"),
      rec("D3", "A chaos drill for the queue", "robustness"),
      rec("D2", "A second budget, for bundle size", "performance"),
    ]);
    mockGetPrisma.mockReturnValue(d.client);

    const ledger = await getCraftLedger("acme", "acme/widget");
    expect(ledger.total).toBe(3);
    expect(ledger.byAxis.performance).toBe(2);
    expect(ledger.byAxis.robustness).toBe(1);
    // Untouched axes are present at zero, never absent — callers never hole-fill.
    expect(ledger.byAxis.architecture).toBe(0);
    expect(ledger.byAxis.dx).toBe(0);
  });

  it("asks only for craft rows that are DONE", async () => {
    const d = prismaDouble([]);
    mockGetPrisma.mockReturnValue(d.client);
    await getCraftLedger("acme", "acme/widget");
    const where = d.recCalls[0]!.where as Args;
    expect(where.kind).toBe("craft");
    expect(where.status).toBe("done");
  });

  it("counts a rung ONCE even when a later scan re-raised and re-closed it", async () => {
    // Rows carry forward across re-scans; the same rung closing twice is one rung climbed.
    const d = prismaDouble([
      rec("D2", "A performance budget that fails CI", "performance"),
      rec("D2", "a performance budget that fails CI.", "performance"),
    ]);
    mockGetPrisma.mockReturnValue(d.client);
    const ledger = await getCraftLedger("acme", "acme/widget");
    expect(ledger.total).toBe(1);
    expect(ledger.byAxis.performance).toBe(1);
  });

  it("records a rung with an unrecognised or absent axis as `unaxised`, never as a guessed axis", async () => {
    const d = prismaDouble([rec("D2", "An old rung from before the column", null), rec("D3", "Nonsense axis", "vibes")]);
    mockGetPrisma.mockReturnValue(d.client);
    const ledger = await getCraftLedger("acme", "acme/widget");
    expect(ledger.total).toBe(2);
    expect(ledger.unaxised).toBe(2);
    expect(Object.values(ledger.byAxis).every((n) => n === 0)).toBe(true);
  });

  it("degrades to an empty ledger when the DB is off — never throws into a scan", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const ledger = await getCraftLedger("acme", "acme/widget");
    expect(ledger.total).toBe(0);
    expect(ledger.unaxised).toBe(0);
  });
});

describe("getCraftItems — the loop's craft batch", () => {
  it("returns OPEN craft rows, shaped as follow-up items with a null projection", async () => {
    const d = prismaDouble([
      {
        id: "rec_1",
        title: "A performance budget that fails CI",
        dimId: "D2",
        impact: "medium",
        effort: "low",
        rationale: "The suite measures; nothing fails.",
        explore: '["What is the budget?"]',
        craftAxis: "performance",
      },
    ]);
    mockGetPrisma.mockReturnValue(d.client);

    const items = await getCraftItems("acme", "acme/widget");
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("craft");
    expect(items[0]!.craftAxis).toBe("performance");
    expect(items[0]!.repo).toBe("acme/widget");
    expect(items[0]!.explore).toEqual(["What is the budget?"]);
    // ALWAYS null. A craft rung has no projected gain, and giving it one is the first step to it
    // paying for a score.
    expect(items[0]!.projectedPoints).toBeNull();

    const where = d.recCalls[0]!.where as Args;
    expect(where.kind).toBe("craft");
    expect(where.status).toBe("open");
  });
});

describe("getCraftBuilt — what the prompt is shown", () => {
  it("returns built rungs newest-first with their axis, deduped", async () => {
    const d = prismaDouble([
      rec("D2", "A budget that fails CI", "performance"),
      rec("D2", "A budget that fails CI", "performance"),
      rec("D3", "A chaos drill", "robustness"),
    ]);
    mockGetPrisma.mockReturnValue(d.client);
    const built = await getCraftBuilt("acme", "acme/widget");
    expect(built.map((b) => b.title)).toEqual(["A budget that fails CI", "A chaos drill"]);
    expect(built[1]!.axis).toBe("robustness");
    expect((d.recCalls[0]!.orderBy as Args).createdAt).toBe("desc");
  });
});

describe("craft is excluded from every debt and finding path BY CONSTRUCTION", () => {
  it("getOrgBacklog asks the recommendation table for gaps only", async () => {
    const d = prismaDouble([]);
    // The backlog's plan needs a repo and a latest scan to reach the recommendation read.
    d.client.repository.findMany = vi.fn(async () => [{ id: "repo_1", fullName: "acme/widget", name: "widget" }]) as never;
    d.client.scan.groupBy = vi.fn(async () => [{ repoId: "repo_1", _max: { scannedAt: new Date("2026-06-01T00:00:00Z") } }]) as never;
    d.client.scan.findMany = vi.fn(async () => [{ id: "scan_1", repoId: "repo_1", archetype: "org" }]) as never;
    mockGetPrisma.mockReturnValue(d.client);

    await getOrgBacklog("acme", null, new Date("2026-06-02T00:00:00Z"), null);
    expect(d.recCalls.length).toBeGreaterThan(0);
    for (const call of d.recCalls) expect((call.where as Args).kind).toBe("gap");
  });

  it("getOrgNavCounts's follow-ups badge counts gaps only — a badge must be able to reach zero", async () => {
    const seen: Args[] = [];
    const client = {
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme" })) },
      repository: {
        findMany: vi.fn(async (args: Args = {}) => {
          // The nested select is where the filter lives; reach in and record it.
          const select = (args.select as Args | undefined)?.scans as Args | undefined;
          const inner = (select?.select as Args | undefined)?.recommendations as Args | undefined;
          if (inner) seen.push(inner.where as Args);
          return [{ scans: [{ recommendations: [] }] }];
        }),
      },
      invite: { count: vi.fn(async () => 0) },
    };
    mockGetPrisma.mockReturnValue(client);

    await getOrgNavCounts("acme");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("gap");
  });
});
