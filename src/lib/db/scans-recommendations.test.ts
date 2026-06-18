// Pins updateRecommendation — the backlog's only mutation + audit path. The load-bearing invariant:
// a committed field change and its audit row are written TOGETHER inside one $transaction, so a
// refactor that pulls auditLog.create back outside the tx (a documented prior regression) can never
// commit a status/owner/due-date change with no audit row. Also pins audit tenant-scope (orgId
// resolved onto the row so it's readable) and change-detection (a no-op patch writes nothing).
//
// Harness mirrors src/lib/db/credits.test.ts: mock @/lib/db/client, model $transaction(fn) as
// running fn(tx) against a tx whose update / createMany / auditLog.create are vi.fn()s, so we can
// assert WHAT was invoked ON THE TX OBJECT (atomicity) rather than coupling to call order.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { updateRecommendation } from "./scans-recommendations";

/** A minimal Recommendation row that satisfies toPersistedRec's field reads. */
function recRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rec_1",
    title: "Add CI gate",
    dimId: "automation",
    impact: "high",
    effort: "medium",
    rationale: "because",
    explore: "[]",
    levelUnlock: null,
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    ...overrides,
  };
}

/**
 * Fake prisma for updateRecommendation. The top-level client serves the pre-transaction reads:
 *   - findUnique(where:{id})                  -> the current row (or null to force P2025)
 *   - findUnique(where:{id}, select:{...org}) -> the org-resolution chain
 * $transaction(fn) runs fn(tx) against a tx whose update / event-createMany / auditLog.create are
 * spies, so a test can assert all three landed on the SAME tx object (one atomic commit).
 *
 * `orgId` controls the resolved rec->scan->repo->org chain (null models a missing chain).
 */
function fakePrisma(current: ReturnType<typeof recRow> | null, opts: { orgId?: string | null } = {}) {
  const orgId = opts.orgId === undefined ? "org_1" : opts.orgId;

  const tx = {
    recommendation: {
      // The in-tx update returns the patched row so toPersistedRec maps the post-update state.
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...current,
        ...data,
        id: where.id,
      })),
    },
    recommendationEvent: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    auditLog: {
      create: vi.fn(async () => ({ id: "audit_1" })),
    },
  };

  const orgChain = { scan: { repo: { orgId } } };

  // findUnique is called twice: bare {where} -> current row; with a `select` -> the org chain.
  const findUnique = vi.fn(async (args: { where: { id: string }; select?: unknown }) =>
    args.select ? (current ? orgChain : null) : current,
  );

  const prisma = {
    recommendation: { findUnique },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  return { prisma, tx };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("updateRecommendation — atomic mutation + audit", () => {
  it("writes the row update AND the audit row inside the SAME $transaction on a real change", async () => {
    const { prisma, tx } = fakePrisma(recRow({ status: "open" }), { orgId: "org_42" });
    mockGetPrisma.mockReturnValue(prisma);

    await updateRecommendation("rec_1", { status: "in_progress" }, { actor: "alice", note: "starting" });

    // Atomicity: the field change AND its audit row are both invoked on the tx object handed to the
    // transaction callback — never on the top-level client. No committed change without its audit row.
    expect(tx.recommendation.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.recommendationEvent.createMany).toHaveBeenCalledTimes(1);

    // The bare client must NOT carry the audit write (that would be a non-atomic post-tx regression).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // The update applied only the changed field.
    expect(tx.recommendation.update).toHaveBeenCalledWith({
      where: { id: "rec_1" },
      data: { status: "in_progress" },
    });
  });

  it("stamps the audit row with the resolved org scope and the actual change (old -> new)", async () => {
    const { prisma, tx } = fakePrisma(recRow({ status: "open" }), { orgId: "org_42" });
    mockGetPrisma.mockReturnValue(prisma);

    await updateRecommendation("rec_1", { status: "done" }, { actor: "bob" });

    const auditArg = tx.auditLog.create.mock.calls[0][0] as {
      data: { action: string; orgId: string | null; actorId: string | null; meta: string };
    };
    expect(auditArg.data.action).toBe("recommendation.updated");
    expect(auditArg.data.orgId).toBe("org_42"); // readable in the audit viewer (getAuditLog filters by orgId)
    expect(auditArg.data.actorId).toBeNull();

    const meta = JSON.parse(auditArg.data.meta);
    expect(meta).toMatchObject({
      id: "rec_1",
      actor: "bob",
      changes: [{ kind: "status", from: "open", to: "done" }],
    });
  });

  it("records exactly one event per actually-changed field across a multi-field patch", async () => {
    const { prisma, tx } = fakePrisma(
      recRow({ status: "open", assigneeLogin: "old", targetDate: new Date("2026-01-01") }),
    );
    mockGetPrisma.mockReturnValue(prisma);

    // status changes, assignee changes, but targetDate resolves to the SAME calendar day -> no event.
    await updateRecommendation(
      "rec_1",
      { status: "in_progress", assigneeLogin: "new", targetDate: "2026-01-01" },
      { actor: "carol" },
    );

    const events = tx.recommendationEvent.createMany.mock.calls[0][0].data as Array<{
      kind: string;
      fromValue: string | null;
      toValue: string | null;
    }>;
    expect(events.map((e) => e.kind).sort()).toEqual(["assignee", "status"]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "status", fromValue: "open", toValue: "in_progress" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "assignee", fromValue: "old", toValue: "new" }),
    );

    // The audit meta lists exactly the two real changes — its change count equals the event count.
    const auditArg = tx.auditLog.create.mock.calls[0][0] as { data: { meta: string } };
    expect(JSON.parse(auditArg.data.meta).changes).toHaveLength(2);
  });

  it("change-detection: a no-op patch writes NO row update, NO event, NO audit row", async () => {
    const { prisma, tx } = fakePrisma(recRow({ status: "open", assigneeLogin: "alice" }));
    mockGetPrisma.mockReturnValue(prisma);

    // Same status and same (trimmed) assignee -> nothing actually changed.
    const result = await updateRecommendation("rec_1", { status: "open", assigneeLogin: "  alice  " });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.recommendation.update).not.toHaveBeenCalled();
    expect(tx.recommendationEvent.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();

    // Returns the current rec, mapped to the persisted shape.
    expect(result).toMatchObject({ id: "rec_1", status: "open", assigneeLogin: "alice" });
  });

  it("returns null and touches nothing when the DB is disabled", async () => {
    const { prisma, tx } = fakePrisma(recRow());
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReturnValue(prisma);

    const result = await updateRecommendation("rec_1", { status: "done" });

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("throws P2025 (not-found) for a missing id, before any transaction runs", async () => {
    const { prisma, tx } = fakePrisma(null);
    mockGetPrisma.mockReturnValue(prisma);

    await expect(updateRecommendation("missing", { status: "done" })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.recommendation.update).not.toHaveBeenCalled();
  });
});
