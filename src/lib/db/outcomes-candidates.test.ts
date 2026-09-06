// D11: the reconciler's coverage. `listDoneRecCandidates` decides which closes the intervention
// ledger ever sees, and it got two things wrong that no aggregate could reveal:
//
//   1. it took the 50 newest `done` EVENTS and deduped to one per recommendation afterwards, so a row
//      toggled done → open → done ate three of the fifty slots;
//   2. it had no watermark, so an org past fifty closes re-read the same newest fifty forever and its
//      tail could never become ledger rows — silently, with nothing reporting the shortfall.
//
// The dedupe now happens in the database (one group per recommendation) and the ledger itself is the
// watermark (an already-measured close is excluded in the query), with `remaining`/`truncated` stating
// what a tick did not reach.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  dbReadSafe: async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  },
}));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/db/scans-shared", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/scans-shared")>()),
  resolveOrgId: vi.fn(async () => "org_1"),
}));

import { listDoneRecCandidates, RECONCILE_REMAINING_PROBE } from "./outcomes";

interface DoneEvent {
  recommendationId: string;
  createdAt: Date;
}

const scanFindMany = vi.fn();
const scanFindFirst = vi.fn();

/**
 * A prisma stand-in that honours the parts of the query this read depends on: groupBy dedupes by
 * recommendation and orders by each one's LAST close, and the `notIn` skip set is applied before the
 * take — i.e. the very properties the old in-memory version got wrong.
 */
function harness(events: DoneEvent[], ledgered: string[] = [], laterScans: unknown[] = []) {
  mockIsDbConfigured.mockReturnValue(true);
  const recIds = [...new Set(events.map((e) => e.recommendationId))];
  mockGetPrisma.mockReturnValue({
    interventionOutcome: {
      findMany: async () => ledgered.map((id) => ({ sourceRowId: id })),
    },
    recommendationEvent: {
      groupBy: async ({ where, take }: { where: { recommendationId?: { notIn: string[] } }; take: number }) => {
        const skip = new Set(where.recommendationId?.notIn ?? []);
        const groups = recIds
          .filter((id) => !skip.has(id))
          .map((id) => ({
            recommendationId: id,
            _max: {
              createdAt: events
                .filter((e) => e.recommendationId === id)
                .reduce((max, e) => (e.createdAt > max ? e.createdAt : max), new Date(0)),
            },
          }))
          .sort((a, b) => b._max.createdAt.getTime() - a._max.createdAt.getTime());
        return groups.slice(0, take);
      },
    },
    recommendation: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          dimId: "D2",
          title: `gap ${id}`,
          scanId: `before_${id}`,
          scan: {
            repoId: "repo_1",
            repo: { fullName: "acme/web" },
            dimensions: [{ dimId: "D2", score: 40 }],
          },
        })),
    },
    scan: { findMany: scanFindMany, findFirst: scanFindFirst },
  });
  scanFindMany.mockResolvedValue(laterScans);
}

const close = (id: string, iso: string): DoneEvent => ({ recommendationId: id, createdAt: new Date(iso) });

beforeEach(() => {
  vi.clearAllMocks();
  scanFindMany.mockResolvedValue([]);
});

describe("listDoneRecCandidates — the dedupe happens BEFORE the take", () => {
  it("a row toggled done → open → done consumes ONE slot, not three", async () => {
    harness([
      close("r1", "2026-06-01T00:00:00Z"),
      close("r1", "2026-06-02T00:00:00Z"),
      close("r1", "2026-06-03T00:00:00Z"),
      close("r2", "2026-05-01T00:00:00Z"),
    ]);
    const page = await listDoneRecCandidates("org_1", 2);
    expect(page.candidates.map((c) => c.recommendationId)).toEqual(["r1", "r2"]);
    // …and the LAST close is the intervention instant a later scan is measured against.
    expect(page.candidates[0]!.doneAt.toISOString()).toBe("2026-06-03T00:00:00.000Z");
  });

  it("orders recommendations by their most recent close", async () => {
    harness([close("old", "2026-01-01T00:00:00Z"), close("new", "2026-06-01T00:00:00Z")]);
    const page = await listDoneRecCandidates("org_1", 5);
    expect(page.candidates.map((c) => c.recommendationId)).toEqual(["new", "old"]);
  });
});

describe("listDoneRecCandidates — the tail is reached across ticks", () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    close(`r${i}`, new Date(Date.UTC(2026, 5, 1) - i * 86_400_000).toISOString()),
  );

  it("takes a full page and STATES what it did not reach", async () => {
    harness(many);
    const page = await listDoneRecCandidates("org_1", 50);
    expect(page.candidates).toHaveLength(50);
    expect(page.remaining).toBe(10);
    expect(page.truncated).toBe(false); // an exact count, not a floor
  });

  it("reconciles every close across two ticks — the second tick reaches the tail", async () => {
    harness(many);
    const first = await listDoneRecCandidates("org_1", 50);
    // The ledger is the watermark: the 50 measured closes carry an InterventionOutcome row.
    harness(many, first.candidates.map((c) => c.recommendationId));
    const second = await listDoneRecCandidates("org_1", 50);
    expect(second.candidates).toHaveLength(10);
    expect(second.remaining).toBe(0);
    const all = new Set([...first.candidates, ...second.candidates].map((c) => c.recommendationId));
    expect(all.size).toBe(60); // every close reconciled, none twice
  });

  it("marks `remaining` as a FLOOR once more are waiting than the probe counts", async () => {
    const flood = Array.from({ length: 50 + RECONCILE_REMAINING_PROBE + 5 }, (_, i) =>
      close(`r${i}`, new Date(Date.UTC(2026, 5, 1) - i * 3_600_000).toISOString()),
    );
    harness(flood);
    const page = await listDoneRecCandidates("org_1", 50);
    expect(page.remaining).toBe(RECONCILE_REMAINING_PROBE);
    expect(page.truncated).toBe(true);
  });
});

describe("listDoneRecCandidates — the after-scan read is batched", () => {
  it("locates every candidate's after-bookend in ONE query, never one per candidate", async () => {
    harness(
      [close("r1", "2026-06-01T00:00:00Z"), close("r2", "2026-06-02T00:00:00Z")],
      [],
      [
        { id: "after_early", repoId: "repo_1", scannedAt: new Date("2026-06-01T12:00:00Z"), dimensions: [{ dimId: "D2", score: 45 }] },
        { id: "after_late", repoId: "repo_1", scannedAt: new Date("2026-06-03T00:00:00Z"), dimensions: [{ dimId: "D2", score: 51 }] },
      ],
    );
    const page = await listDoneRecCandidates("org_1", 50);
    expect(scanFindMany).toHaveBeenCalledTimes(1);
    expect(scanFindFirst).not.toHaveBeenCalled();
    // Each candidate still picks the FIRST scan after its OWN close.
    const byId = new Map(page.candidates.map((c) => [c.recommendationId, c]));
    expect(byId.get("r1")!.afterScanId).toBe("after_early");
    expect(byId.get("r1")!.afterDimScore).toBe(45);
    expect(byId.get("r2")!.afterScanId).toBe("after_late");
  });

  it("a close with no later scan reports no after-bookend — awaiting a rescan, never a guess", async () => {
    harness([close("r1", "2026-06-01T00:00:00Z")], [], []);
    const page = await listDoneRecCandidates("org_1", 50);
    expect(page.candidates[0]!.afterScanId).toBeNull();
    expect(page.candidates[0]!.afterDimScore).toBeNull();
  });

  it("returns an empty page with persistence off", async () => {
    harness([close("r1", "2026-06-01T00:00:00Z")]);
    mockIsDbConfigured.mockReturnValue(false);
    expect(await listDoneRecCandidates("org_1")).toEqual({ candidates: [], remaining: 0, truncated: false });
  });
});
