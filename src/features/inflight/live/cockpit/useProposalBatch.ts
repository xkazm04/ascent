"use client";

// THE PROPOSED BATCH, as state — what the current selection would actually dispatch.
//
// Extracted from CockpitInspector on 2026-09-17, when the batch stopped being a rail panel and became
// the full-width ledger under the sky (`CockpitBatchLedger`). Two surfaces now read the same batch —
// the ledger draws and curates it, the inspector's CTA composes the request from it — so the state has
// to sit above both of them. The fetch, the debounce, the stale-response guard and the pruning are
// unchanged; only their address moved.
//
// KEYED BY WHAT THEY WERE FETCHED FOR — the selection, the batch-size dial and the run EPOCH — so a
// stale response can never be read against a request it does not describe (and an emptied selection
// needs no state write at all).
//
// THE RUN EPOCH (2026-09-18). The batch used to be fetched only when the selection changed, so once a
// run started the ledger kept offering the items that run had just CLAIMED (now `in_progress`) as
// tickable, and after it settled it kept offering ids the rescan had re-minted. The epoch changes when
// a run starts and when it settles; each change refetches and drops the pruning, which named items of
// a batch that no longer exists. A plain selection change keeps the pruning: the ids of the repos
// still selected are the same ids.

import { useEffect, useMemo, useState } from "react";
import { proposalDimensions, sharedDimensions, type SharedDimensions } from "./cockpitDimensions";
import type { LoopProposal } from "./loopTypes";

/** A lasso drags through dozens of intermediate selections; only the one it settles on is queried. */
const PROPOSE_DEBOUNCE_MS = 350;
const NONE: ReadonlySet<string> = new Set();

export interface ProposalBatch {
  /** The selection, sorted — the repos the proposals were fetched for. */
  repos: string[];
  proposals: LoopProposal[];
  loading: boolean;
  /** Item ids the operator pruned out of the batch. */
  pruned: ReadonlySet<string>;
  togglePrune: (id: string) => void;
  /** Selected repos with no local pairing — flagged, and excluded from the run. */
  unpaired: ReadonlySet<string>;
  /** Selected repos a lane can actually be dispatched into. */
  runnable: string[];
  shares: SharedDimensions;
  /** The dimensions these proposals carry — the Focus dial's options. */
  dims: { id: string; label: string }[];
  /** The curated `{repo: itemIds}` the run route takes, under the current focus. Empty = uncurated. */
  batches: Record<string, string[]>;
}

export function useProposalBatch(input: {
  selected: ReadonlySet<string>;
  paired: ReadonlySet<string>;
  propose: (repos: readonly string[], batchSize?: number) => Promise<LoopProposal[] | null>;
  /** Work only follow-ups on this dimension; null = all of them. */
  dimFocus: string | null;
  /** The run-setup dial: the batch is sized exactly as the engine will size the lane. */
  batchSize?: number;
  /** Changes when a run starts or settles (see the header). */
  epoch?: string;
}): ProposalBatch {
  const { selected, paired, propose, dimFocus, batchSize, epoch = "" } = input;
  const [fetched, setFetched] = useState<{ key: string; proposals: LoopProposal[] }>({ key: "", proposals: [] });
  const [loading, setLoading] = useState(false);
  // Pruning is keyed by the epoch it was made in — a new epoch reads as none, with no effect to reset it.
  const [pruning, setPruning] = useState<{ epoch: string; ids: ReadonlySet<string> }>({ epoch: "", ids: NONE });
  const pruned = pruning.epoch === epoch ? pruning.ids : NONE;

  const repos = useMemo(() => [...selected].sort(), [selected]);
  const key = `${repos.join(",")}#${batchSize ?? ""}#${epoch}`;
  const proposals = useMemo(() => (fetched.key === key ? fetched.proposals : []), [fetched, key]);

  useEffect(() => {
    if (repos.length === 0) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      void propose(repos, batchSize).then((res) => {
        if (!alive) return;
        setFetched({ key, proposals: res ?? [] });
        setLoading(false);
      });
    }, PROPOSE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // `key` is the stable identity of the request (selection · dial · epoch); `repos` is a fresh
    // array every render and `batchSize` is already inside `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, propose]);

  const unpaired = useMemo(() => new Set(repos.filter((r) => !paired.has(r))), [repos, paired]);
  const runnable = useMemo(() => repos.filter((r) => paired.has(r)), [repos, paired]);
  const shares = useMemo(() => sharedDimensions(proposals, selected), [proposals, selected]);
  const dims = useMemo(() => proposalDimensions(proposals), [proposals]);

  const batches = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const p of proposals) {
      if (!paired.has(p.repo)) continue;
      const ids = p.items.filter((i) => !pruned.has(i.id) && (!dimFocus || i.dimId === dimFocus)).map((i) => i.id);
      if (ids.length > 0) out[p.repo] = ids;
    }
    return out;
  }, [proposals, paired, pruned, dimFocus]);

  return {
    repos,
    proposals,
    loading,
    pruned,
    togglePrune: (id) =>
      setPruning((prev) => {
        const next = new Set(prev.epoch === epoch ? prev.ids : NONE);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { epoch, ids: next };
      }),
    unpaired,
    runnable,
    shares,
    dims,
    batches,
  };
}
