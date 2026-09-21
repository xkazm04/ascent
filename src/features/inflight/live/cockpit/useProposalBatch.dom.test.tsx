// @vitest-environment jsdom
//
// THE PROPOSED BATCH DOES NOT GO STALE (2026-09-18). It used to be fetched only when the selection
// changed, so once a run started the ledger kept offering the items that run had just claimed (now
// `in_progress`) as tickable — and kept the operator's pruning of a batch that no longer existed.
// Pinned: a run starting and a run settling each refetch and drop the pruning; a selection change
// refetches and KEEPS it; the batch-size dial travels with every request.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProposalBatch } from "./useProposalBatch";
import type { LoopProposal } from "./loopTypes";

const item = (id: string) =>
  ({ id, repo: "acme/a", title: `gap ${id}`, dimId: "D2", dimLabel: "D2", impact: "high", effort: "low", rationale: "", explore: [], projectedPoints: 3 }) as LoopProposal["items"][number];
const proposal = (repo: string, ids: string[]): LoopProposal => ({ repo, items: ids.map(item), projectedPoints: 3 * ids.length, kind: "backlog", practiceId: null, reason: "" });

const paired = new Set(["acme/a", "acme/b"]);
let answer: LoopProposal[] = [];
const propose = vi.fn(async (...args: [repos: readonly string[], size?: number]) => (args.length > 0 ? answer : []));

beforeEach(() => {
  vi.useFakeTimers();
  answer = [proposal("acme/a", ["pre-1", "pre-2"])];
  propose.mockClear();
});
afterEach(() => vi.useRealTimers());

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(400)));

function mount(initial: { epoch: string; selected?: string[]; batchSize?: number }) {
  return renderHook(
    (p: { epoch: string; selected?: string[]; batchSize?: number }) =>
      useProposalBatch({ selected: new Set(p.selected ?? ["acme/a"]), paired, propose, dimFocus: null, batchSize: p.batchSize ?? 5, epoch: p.epoch }),
    { initialProps: initial },
  );
}

describe("useProposalBatch — the run epoch", () => {
  it("refetches when a run starts, and drops the pruning made against the pre-run batch", async () => {
    const { result, rerender } = mount({ epoch: "idle" });
    await settle();
    expect(result.current.batches).toEqual({ "acme/a": ["pre-1", "pre-2"] });
    act(() => result.current.togglePrune("pre-1"));
    expect(result.current.batches).toEqual({ "acme/a": ["pre-2"] });

    // The run claims pre-1/pre-2; the route now proposes what is left.
    answer = [proposal("acme/a", ["next-1"])];
    rerender({ epoch: "live:run-9" });
    // Never the pre-run items while the refetch is in flight — they are `in_progress` now.
    expect(result.current.proposals).toEqual([]);
    await settle();
    expect(propose).toHaveBeenCalledTimes(2);
    expect(result.current.pruned.size).toBe(0);
    expect(result.current.batches).toEqual({ "acme/a": ["next-1"] });
  });

  it("refetches again when the run settles — the rescan re-minted the ids", async () => {
    const { result, rerender } = mount({ epoch: "live:run-9" });
    await settle();
    act(() => result.current.togglePrune("pre-2"));
    answer = [proposal("acme/a", ["post-1"])];
    rerender({ epoch: "idle" });
    await settle();
    expect(propose).toHaveBeenCalledTimes(2);
    expect(result.current.pruned.size).toBe(0);
    expect(result.current.proposals[0]!.items.map((i) => i.id)).toEqual(["post-1"]);
  });

  it("keeps the pruning across a plain selection change — those ids are still the same items", async () => {
    const { result, rerender } = mount({ epoch: "idle" });
    await settle();
    act(() => result.current.togglePrune("pre-1"));
    answer = [proposal("acme/a", ["pre-1", "pre-2"]), proposal("acme/b", ["b-1"])];
    rerender({ epoch: "idle", selected: ["acme/a", "acme/b"] });
    await settle();
    expect(result.current.pruned.has("pre-1")).toBe(true);
    expect(result.current.batches).toEqual({ "acme/a": ["pre-2"], "acme/b": ["b-1"] });
  });
});

describe("useProposalBatch — the batch-size dial", () => {
  it("sends the dial with the request and refetches when it moves", async () => {
    const { rerender } = mount({ epoch: "idle", batchSize: 5 });
    await settle();
    expect(propose).toHaveBeenLastCalledWith(["acme/a"], 5);
    rerender({ epoch: "idle", batchSize: 12 });
    await settle();
    expect(propose).toHaveBeenCalledTimes(2);
    expect(propose).toHaveBeenLastCalledWith(["acme/a"], 12);
  });
});
