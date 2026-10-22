// The batch bar's claim verbs (followups-1): Take over N and Send back N, scoped by the same table the
// row and the route read (claimActionsModel.ts).

import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/followups/claimActionsModel", async (orig) => ({
  ...(await orig<typeof import("@/components/shared/followups/claimActionsModel")>()),
  postClaimVerb: vi.fn(async () => undefined),
}));

import { claimBatchActions } from "./claimBatchActions";
import { postClaimVerb } from "@/components/shared/followups/claimActionsModel";
import type { LoopProposal, ProposalRow, ScanProposal } from "./proposalsModel";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const LIVE = new Date(NOW.getTime() + 30 * 60_000).toISOString();

const scan = (over: Partial<ScanProposal>): ScanProposal =>
  ({ source: "scan", id: "s", repo: "acme/api", status: "in_progress", claimActor: null, claimExecutor: null, leaseUntil: null, needsHuman: false, ...over }) as ScanProposal;
const loop = { source: "loop", id: "run:lane:cover", repo: "acme/api" } as LoopProposal;

const escalation = scan({ id: "esc", needsHuman: true, claimActor: "agent:tok_A", claimExecutor: "remote-agent" });
const leased = scan({ id: "lease", claimActor: "agent:tok_A", claimExecutor: "remote-agent", leaseUntil: LIVE });
const open = scan({ id: "open", status: "open" });

const actionsFor = (admin: boolean, onDone = vi.fn()) => {
  const list = claimBatchActions({ org: "acme", viewer: { login: "ana", admin }, now: NOW, onDone });
  return { take: list.find((a) => a.key === "take-over")!, back: list.find((a) => a.key === "send-back")!, onDone };
};

describe("claimBatchActions", () => {
  it("Take over applies only to needs-human scan rows", () => {
    const { take } = actionsFor(true);
    expect(take.label).toBe("Take over");
    const rows: ProposalRow[] = [escalation, leased, open, loop];
    expect(rows.map((r) => take.appliesTo!(r))).toEqual([true, false, false, false]);
  });

  it("Send back mirrors claimActionsFor for the viewer and never applies to a loop proposal", () => {
    const member = actionsFor(false).back;
    const admin = actionsFor(true).back;
    expect([escalation, leased, open, loop].map((r) => member.appliesTo!(r))).toEqual([true, false, false, false]);
    expect([escalation, leased, open, loop].map((r) => admin.appliesTo!(r))).toEqual([true, true, false, false]);
  });

  it("running an action posts its verb over the applicable scan ids and settles the ledger", async () => {
    const { take, onDone } = actionsFor(false);
    await take.run([escalation]);
    expect(postClaimVerb).toHaveBeenCalledWith("acme", "take-over", ["esc"]);
    expect(onDone).toHaveBeenCalled();
  });
});
