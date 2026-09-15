// `OrgMemoryCitation` — the rules, with Prisma faked at the seam so what is under test is the
// arithmetic of the vote, not the driver.
//
// The two that matter: a session gets ONE vote per memory (a retried tool call must not double-bump
// `citedCount`, which is the whole reason the counter is worth ranking on), and a memory belonging to
// another org is simply not found — gate-then-constrain, with no write and no confirmation that the
// id exists somewhere else.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: vi.fn(async () => "org_1") }));

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { citationCountsFor, recordMemoryCitation } from "./org-memory-citations";

const mockGetPrisma = vi.mocked(getPrisma);
const mockIsDbConfigured = vi.mocked(isDbConfigured);

/** A prisma double. `memory` null = the id belongs to no memory in THIS org. `existing` = a prior vote. */
function fakePrisma(opts: { memory?: { id: string } | null; existing?: { id: string; used: boolean } | null } = {}) {
  const orgMemory = {
    findFirst: vi.fn(async () => (opts.memory === undefined ? { id: "m1" } : opts.memory)),
    update: vi.fn(async () => ({ citedCount: 1, notUsefulCount: 0 })),
    findMany: vi.fn(async () => [{ id: "m1", citedCount: 3, notUsefulCount: 1 }]),
  };
  const orgMemoryCitation = {
    findUnique: vi.fn(async () => opts.existing ?? null),
    upsert: vi.fn(async () => ({ id: "c1" })),
    findMany: vi.fn(async () => []),
  };
  // The transaction double runs what it was handed and returns both results, which is what the
  // real client does — the point of the assertion below is that BOTH statements are in one array.
  const $transaction = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  return { orgMemory, orgMemoryCitation, $transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("recordMemoryCitation", () => {
  it("records a first vote and bumps citedCount by one", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p as never);

    const res = await recordMemoryCitation("acme", { memoryId: "m1", sessionId: "s1", used: true });

    expect(res.outcome).toBe("created");
    expect(p.orgMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { citedCount: { increment: 1 }, notUsefulCount: { increment: 0 } } }),
    );
  });

  it("counts a NOT-useful vote in its own column, never as a negative citation", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p as never);

    await recordMemoryCitation("acme", { memoryId: "m1", sessionId: "s1", used: false });

    // Two counters, never netted: "nobody has cited this" and "five agents rejected it" need
    // different actions, and a single net score erases the difference.
    expect(p.orgMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { citedCount: { increment: 0 }, notUsefulCount: { increment: 1 } } }),
    );
  });

  it("re-citing the same (memory, session) upserts and does NOT double-bump", async () => {
    const p = fakePrisma({ existing: { id: "c1", used: true } });
    mockGetPrisma.mockReturnValue(p as never);

    const res = await recordMemoryCitation("acme", { memoryId: "m1", sessionId: "s1", used: true });

    expect(res.outcome).toBe("unchanged");
    expect(p.orgMemoryCitation.upsert).toHaveBeenCalledTimes(1);
    expect(p.orgMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { citedCount: { increment: 0 }, notUsefulCount: { increment: 0 } } }),
    );
  });

  it("moves the vote across when a session changes its mind, adding to neither total", async () => {
    const p = fakePrisma({ existing: { id: "c1", used: true } });
    mockGetPrisma.mockReturnValue(p as never);

    const res = await recordMemoryCitation("acme", { memoryId: "m1", sessionId: "s1", used: false });

    expect(res.outcome).toBe("updated");
    expect(p.orgMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { citedCount: { increment: -1 }, notUsefulCount: { increment: 1 } } }),
    );
  });

  it("writes the citation and the counter in ONE transaction", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p as never);
    await recordMemoryCitation("acme", { memoryId: "m1", sessionId: "s1", used: true });
    // A counter that can drift from its own evidence table is worse than no counter: it would rank
    // memories on a number nothing can rebuild.
    expect(p.$transaction).toHaveBeenCalledTimes(1);
    expect((p.$transaction.mock.calls[0]![0] as unknown[]).length).toBe(2);
  });

  it("writes NOTHING for a memory that belongs to another org", async () => {
    const p = fakePrisma({ memory: null });
    mockGetPrisma.mockReturnValue(p as never);

    const res = await recordMemoryCitation("acme", { memoryId: "foreign", sessionId: "s1", used: true });

    expect(res.outcome).toBe("unknown-memory");
    expect(p.orgMemoryCitation.upsert).not.toHaveBeenCalled();
    expect(p.orgMemory.update).not.toHaveBeenCalled();
  });

  it("caps the agent's note rather than storing an essay in a reason column", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p as never);

    await recordMemoryCitation("acme", { memoryId: "m1", sessionId: "s1", used: true, note: "x".repeat(900) });

    const note = (p.orgMemoryCitation.upsert.mock.calls[0]![0] as { create: { note: string } }).create.note;
    expect(note).toHaveLength(500);
  });

  it("reports not-persisted rather than pretending success with no database", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await recordMemoryCitation("acme", { memoryId: "m1", sessionId: "s1", used: true });
    expect(res).toEqual({ outcome: "not-persisted", counts: null });
  });
});

describe("citationCountsFor", () => {
  it("returns counts only for memories in this org, and omits the rest", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p as never);

    const counts = await citationCountsFor("acme", ["m1", "foreign"]);

    // An absent entry is "no evidence", never "zero uses proven" — the caller must not read a
    // missing key as a measured zero.
    expect(counts).toEqual({ m1: { citedCount: 3, notUsefulCount: 1 } });
    expect(counts.foreign).toBeUndefined();
  });

  it("does not query at all for an empty id list", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p as never);
    expect(await citationCountsFor("acme", [])).toEqual({});
    expect(p.orgMemory.findMany).not.toHaveBeenCalled();
  });
});
