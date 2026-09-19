// THE PROPOSAL'S LIFE, at the store level: raised WITH its turn, then claim → run → stamp, with a
// release that can only ever undo a claim.
//
// Two things are pinned here that no higher layer can pin:
//
//   1. ONE TRANSACTION. A proposal whose turn was never written is an Accept button under nothing; a
//      turn pointing at rows that were never inserted is a card painted empty. The assertion is that
//      the proposal writes go through the SAME `tx` handle as the turn write — a spy on `create` alone
//      would pass even if the proposals were written afterwards, outside the transaction.
//   2. THE WHERE-CLAUSES ARE THE SAFETY ARGUMENT. `status = 'open'` is what makes a double-click a
//      409; `resolvedAt IS NULL` is what makes a resolved proposal permanently untouchable; and
//      `status = 'accepted' AND resolvedAt IS NULL` is what confines a release to undoing a claim.
//      They are asserted literally, because each one is one word away from a real incident.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));

import { appendAthenaTurn } from "@/lib/db/athena-threads";
import {
  claimAthenaProposal,
  releaseAthenaProposal,
  stampAthenaProposal,
} from "@/lib/db/athena-proposals";

const turnRow = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  threadId: "th1",
  role: "assistant",
  content: "Here it is.",
  metaJson: "{}",
  inputTokens: null,
  outputTokens: null,
  legs: null,
  createdAt: new Date("2026-01-01"),
  ...over,
});

const proposalRow = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  orgId: "org-1",
  threadId: "th1",
  turnId: "t1",
  kind: "rule_on_finding",
  payloadJson: JSON.stringify({ params: { itemKey: "k" } }),
  status: "open",
  resolvedAt: null,
  resolvedBy: null,
  createdAt: new Date("2026-01-01"),
  ...over,
});

beforeEach(() => {
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("a turn and the proposals it raised are written in ONE transaction", () => {
  it("creates the proposals on the transaction handle, and stamps their ids onto the turn's meta", async () => {
    const seen: { on: string; model: string }[] = [];
    let updatedMeta = "";

    const tx = {
      __name: "tx",
      athenaTurn: {
        create: vi.fn(async () => {
          seen.push({ on: "tx", model: "turn.create" });
          return turnRow();
        }),
        update: vi.fn(async ({ data }: { data: { metaJson: string } }) => {
          seen.push({ on: "tx", model: "turn.update" });
          updatedMeta = data.metaJson;
          return turnRow({ metaJson: data.metaJson });
        }),
      },
      athenaThread: { update: vi.fn(async () => ({})) },
      athenaProposal: {
        create: vi.fn(async () => {
          seen.push({ on: "tx", model: "proposal.create" });
          return { id: `p${seen.filter((s) => s.model === "proposal.create").length}` };
        }),
      },
    };

    // The OUTER client's proposal writer is a spy that must never fire: if a proposal were written
    // outside the transaction, this is where it would land.
    const outerProposalCreate = vi.fn();
    mockGetPrisma.mockReturnValue({
      athenaThread: { findFirst: async () => ({ id: "th1", title: "Existing" }) },
      athenaProposal: { create: outerProposalCreate },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    });

    const record = await appendAthenaTurn({
      orgId: "org-1",
      threadId: "th1",
      role: "assistant",
      content: "Here it is.",
      meta: { blocks: [] },
      proposals: [
        { kind: "rule_on_finding", payload: { params: { itemKey: "a" } } },
        { kind: "handoff_followups", payload: { params: { ids: ["r1"] } } },
      ],
    });

    expect(outerProposalCreate).not.toHaveBeenCalled();
    expect(seen.map((s) => s.model)).toEqual([
      "turn.create",
      "proposal.create",
      "proposal.create",
      "turn.update",
    ]);
    // Each proposal points at the turn that offered it, and the turn points back at the rows.
    for (const call of tx.athenaProposal.create.mock.calls) {
      expect((call[0] as { data: { turnId: string; orgId: string } }).data).toMatchObject({
        turnId: "t1",
        orgId: "org-1",
        threadId: "th1",
      });
    }
    expect(JSON.parse(updatedMeta)).toEqual({ blocks: [], proposalIds: ["p1", "p2"] });
    expect(record?.meta).toMatchObject({ proposalIds: ["p1", "p2"] });
  });

  it("does not touch the proposal table at all when a turn raises none", async () => {
    const tx = {
      athenaTurn: { create: vi.fn(async () => turnRow()), update: vi.fn() },
      athenaThread: { update: vi.fn(async () => ({})) },
      athenaProposal: { create: vi.fn() },
    };
    mockGetPrisma.mockReturnValue({
      athenaThread: { findFirst: async () => ({ id: "th1", title: "t" }) },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    });

    await appendAthenaTurn({ orgId: "org-1", threadId: "th1", role: "assistant", content: "x" });
    expect(tx.athenaProposal.create).not.toHaveBeenCalled();
    // No second turn write either — the meta was already correct on the create.
    expect(tx.athenaTurn.update).not.toHaveBeenCalled();
  });
});

describe("claim → stamp → release, and the where-clauses that make them safe", () => {
  it("claims only an OPEN row, and leaves resolvedAt NULL", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockGetPrisma.mockReturnValue({
      athenaProposal: { updateMany, findFirst: async () => proposalRow({ status: "accepted", resolvedBy: "dev" }) },
    });

    const row = await claimAthenaProposal("org-1", "p1", "dev");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "p1", orgId: "org-1", status: "open" },
      data: { status: "accepted", resolvedBy: "dev" },
    });
    expect(row?.status).toBe("accepted");
    expect(row?.resolvedAt).toBeNull();
  });

  it("returns null when the claim loses the race — nothing ran, the caller 409s", async () => {
    mockGetPrisma.mockReturnValue({
      athenaProposal: { updateMany: async () => ({ count: 0 }), findFirst: async () => proposalRow() },
    });
    expect(await claimAthenaProposal("org-1", "p1", "dev")).toBeNull();
  });

  it("stamps only an UNRESOLVED row, and MERGES the outcome into the payload beside the ask", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockGetPrisma.mockReturnValue({
      athenaProposal: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(proposalRow({ status: "accepted" }))
          .mockResolvedValueOnce(proposalRow({ status: "accepted", resolvedAt: new Date("2026-01-02") })),
        updateMany,
      },
    });

    await stampAthenaProposal("org-1", "p1", { ok: true, kind: "ruled", detail: "Dismissed." });
    const call = updateMany.mock.calls[0][0] as { where: unknown; data: { payloadJson: string } };
    expect(call.where).toEqual({ id: "p1", orgId: "org-1", resolvedAt: null });
    // The ask survives; the outcome sits beside it. There is no outcome column and must not be one.
    expect(JSON.parse(call.data.payloadJson)).toEqual({
      params: { itemKey: "k" },
      outcome: { ok: true, kind: "ruled", detail: "Dismissed." },
    });
  });

  it("refuses to stamp a row that is already resolved", async () => {
    mockGetPrisma.mockReturnValue({ athenaProposal: { findFirst: async () => null, updateMany: vi.fn() } });
    expect(await stampAthenaProposal("org-1", "p1", { ok: true, kind: "ruled", detail: "" })).toBeNull();
  });

  it("releases ONLY a claim — accepted AND unresolved, so a resolution is untouchable", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockGetPrisma.mockReturnValue({ athenaProposal: { updateMany } });
    expect(await releaseAthenaProposal("org-1", "p1")).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "p1", orgId: "org-1", status: "accepted", resolvedAt: null },
      data: { status: "open", resolvedBy: null },
    });
  });

  it("is a no-op without a database rather than a throw", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await claimAthenaProposal("org-1", "p1", "dev")).toBeNull();
    expect(await stampAthenaProposal("org-1", "p1", {})).toBeNull();
    expect(await releaseAthenaProposal("org-1", "p1")).toBe(false);
  });
});
