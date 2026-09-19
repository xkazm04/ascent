"use client";

// THE PROPOSED BATCH, as state — what the current selection would actually dispatch.
//
// Extracted from CockpitInspector on 2026-09-17, when the batch stopped being a rail panel and became
// the full-width ledger under the sky (`CockpitBatchLedger`). Two surfaces now read the same batch —
// the ledger draws and curates it, the inspector's CTA composes the request from it — so the state has
// to sit above both of them. The fetch, the debounce, the stale-response guard and the pruning are
// unchanged; only their address moved.
//
// KEYED BY THE SELECTION THEY WERE FETCHED FOR, so a stale response can never be read against a
// selection it does not describe (and an emptied selection needs no state write at all).

import { useEffect, useMemo, useState } from "react";
import { proposalDimensions, sharedDimensions, type SharedDimensions } from "./cockpitDimensions";
import type { LoopProposal } from "./loopTypes";

/** A lasso drags through dozens of intermediate selections; only the one it settles on is queried. */
const PROPOSE_DEBOUNCE_MS = 350;

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
  propose: (repos: readonly string[]) => Promise<LoopProposal[] | null>;
  /** Work only follow-ups on this dimension; null = all of them. */
  dimFocus: string | null;
}): ProposalBatch {
  const { selected, paired, propose, dimFocus } = input;
  const [fetched, setFetched] = useState<{ key: string; proposals: LoopProposal[] }>({ key: "", proposals: [] });
  const [loading, setLoading] = useState(false);
  const [pruned, setPruned] = useState<ReadonlySet<string>>(() => new Set());

  const repos = useMemo(() => [...selected].sort(), [selected]);
  const key = repos.join(",");
  const proposals = useMemo(() => (fetched.key === key ? fetched.proposals : []), [fetched, key]);

  useEffect(() => {
    if (repos.length === 0) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      void propose(repos).then((res) => {
        if (!alive) return;
        setFetched({ key, proposals: res ?? [] });
        setLoading(false);
      });
    }, PROPOSE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // `key` is the stable identity of the selection; `repos` is a fresh array every render.
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
      setPruned((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    unpaired,
    runnable,
    shares,
    dims,
    batches,
  };
}
