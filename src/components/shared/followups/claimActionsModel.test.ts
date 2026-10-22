// The human claim verbs (followups-1): which of take over / send back / release a viewer may apply to
// a ledger row, and which picked rows a fix prompt may name.

import { describe, expect, it } from "vitest";
import { claimActionsFor, promptPartition, promptPlan, verbNeedsAdmin, type ClaimState } from "./claimActionsModel";
import { isSelectable, type FollowUpRow } from "./followupsModel";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const LIVE = new Date(NOW.getTime() + 30 * 60_000).toISOString();
const LAPSED = new Date(NOW.getTime() - 60_000).toISOString();

const ana = { login: "ana", admin: false };
const bo = { login: "bo", admin: false };
const boAdmin = { login: "bo", admin: true };

const state = (over: Partial<ClaimState> = {}): ClaimState => ({
  status: "in_progress",
  claimActor: null,
  claimExecutor: null,
  leaseUntil: null,
  needsHuman: false,
  ...over,
});

describe("claimActionsFor: every claim state the ledger renders has the verb that resolves it", () => {
  it("a needs-human row offers take over and send back to any member", () => {
    const row = state({ needsHuman: true, claimExecutor: "remote-agent", claimActor: "agent:tok_A", leaseUntil: null });
    expect(claimActionsFor(row, ana, NOW)).toEqual(["take-over", "send-back"]);
  });

  it("a row under an agent's live lease offers nothing to a member and send back to an admin", () => {
    const row = state({ needsHuman: false, claimExecutor: "remote-agent", claimActor: "agent:tok_A", leaseUntil: LIVE });
    expect(claimActionsFor(row, ana, NOW)).toEqual([]);
    expect(claimActionsFor(row, boAdmin, NOW)).toEqual(["send-back"]);
  });

  it("a human claim offers release to its holder and to an admin, nothing to another member", () => {
    const row = state({ claimExecutor: "human", claimActor: "ana", leaseUntil: null });
    expect(claimActionsFor(row, ana, NOW)).toEqual(["release"]);
    expect(claimActionsFor(row, bo, NOW)).toEqual([]);
    expect(claimActionsFor(row, boAdmin, NOW)).toEqual(["release"]);
  });

  it("an open, done or dismissed row offers no claim verb to anyone", () => {
    for (const status of ["open", "done", "dismissed"] as const) {
      expect(claimActionsFor(state({ status, needsHuman: true }), boAdmin, NOW)).toEqual([]);
    }
  });

  it("verbNeedsAdmin is true only where the admin role is what admits the verb", () => {
    const human = state({ claimExecutor: "human", claimActor: "ana" });
    expect(verbNeedsAdmin(human, "release", "ana", NOW)).toBe(false);
    expect(verbNeedsAdmin(human, "release", "bo", NOW)).toBe(true);
    expect(verbNeedsAdmin(state({ needsHuman: true, claimActor: "agent:tok_A" }), "send-back", "bo", NOW)).toBe(false);
    expect(verbNeedsAdmin(state({ claimActor: "agent:tok_A", leaseUntil: LIVE, claimExecutor: "remote-agent" }), "send-back", "bo", NOW)).toBe(true);
    expect(verbNeedsAdmin(state({ status: "open" }), "take-over", "bo", NOW)).toBe(false);
  });
});

type Picked = ClaimState & { id: string };
const A: Picked = { id: "A", ...state({ status: "open" }) };
const B: Picked = { id: "B", ...state({ claimExecutor: "human", claimActor: "ana" }) };
const C: Picked = { id: "C", ...state({ claimExecutor: "remote-agent", claimActor: "agent:tok_A", leaseUntil: LIVE }) };

describe("promptPartition: a fix prompt names only work the viewer may do", () => {
  it("leaves out a row under another worker's live lease, keeps open rows and the viewer's own claim", () => {
    expect(promptPartition([A, B, C], ana, NOW)).toEqual({
      include: [A, B],
      held: [{ id: "C", holder: "agent:tok_A", until: LIVE }],
    });
  });

  it("the modal's plan builds the prompt from A and B and marks only A", () => {
    const plan = promptPlan([A, B, C], ana, NOW);
    expect(plan.include.map((r) => r.id)).toEqual(["A", "B"]);
    expect(plan.toMark).toEqual(["A"]);
  });

  it("another person's hand-off is held elsewhere; a lapsed lease and a needs-human row are not", () => {
    const D: Picked = { id: "D", ...state({ claimExecutor: "remote-agent", claimActor: "agent:tok_A", leaseUntil: LAPSED }) };
    const E: Picked = { id: "E", ...state({ claimExecutor: "remote-agent", claimActor: "agent:tok_A", needsHuman: true }) };
    const { include, held } = promptPartition([B, D, E], bo, NOW);
    expect(held).toEqual([{ id: "B", holder: "ana", until: null }]);
    expect(include.map((r) => r.id)).toEqual(["D", "E"]);
  });
});

describe("guard: bulk resolve / dismiss selection is unchanged", () => {
  it("isSelectable still admits open and in_progress rows and nothing closed", () => {
    const s = (status: FollowUpRow["status"]) => isSelectable({ status });
    expect([s("open"), s("in_progress"), s("done"), s("dismissed")]).toEqual([true, true, false, false]);
  });
});
