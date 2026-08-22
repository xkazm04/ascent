"use client";

// The inspector's two lists: the SHARED-DIMENSION bars (what the selection has in common) and the
// PROPOSED BATCH per repo (what each lane would actually work). Split out of CockpitInspector so the
// inspector stays the controls-and-CTA orchestrator.
//
// The item rows reuse the follow-ups ledger's own chip vocabulary (ImpactEffort / Points) rather than
// a second impact scale invented for this panel — a gap looks the same wherever Ascent shows it.

import { Kicker } from "@/components/ui";
import { InlineEmpty } from "@/components/org/shared/ui";
import { ImpactEffort, Points } from "@/components/org/followups/FollowupChips";
import { isOrgWide, shareLine, type SharedDimensions } from "./cockpitDimensions";
import type { LoopProposal } from "./loopTypes";

export function SharedDimensionBars({ shares }: { shares: SharedDimensions }) {
  if (shares.rows.length === 0) return null;
  return (
    <div className="mt-4">
      <Kicker tone="muted">Shared ground</Kicker>
      <ul className="mt-2 space-y-1.5">
        {shares.rows.slice(0, 6).map((row) => {
          const wide = isOrgWide(row, shares.total);
          return (
            <li key={row.dimId} className="flex items-center gap-2">
              <span className="w-16 shrink-0 font-mono text-xs text-slate-400">{row.dimId}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-divider">
                <span
                  className={`block h-full ${wide ? "bg-accent" : "bg-slate-600"}`}
                  style={{ width: `${Math.round(row.share * 100)}%` }}
                />
              </span>
              <span className={`w-32 shrink-0 text-right font-mono text-xs tabular-nums ${wide ? "text-accent" : "text-slate-500"}`}>
                {wide ? shareLine(row, shares.total) : `${row.repos}/${shares.total}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface ProposalListProps {
  proposals: LoopProposal[];
  /** Item ids the operator pruned out of the batch. */
  pruned: ReadonlySet<string>;
  onTogglePrune: (id: string) => void;
  /** Only show items in this dimension; null = all. */
  dimFocus: string | null;
  /** Repos in the selection that have no local pairing — flagged, and excluded from the run. */
  unpaired: ReadonlySet<string>;
  loading?: boolean;
}

export function ProposalList({ proposals, pruned, onTogglePrune, dimFocus, unpaired, loading = false }: ProposalListProps) {
  if (loading) return <InlineEmpty>Reading each repo&rsquo;s open follow-ups…</InlineEmpty>;
  if (proposals.length === 0) return <InlineEmpty>No open follow-ups in this selection.</InlineEmpty>;

  return (
    <div className="mt-4 space-y-3">
      <Kicker tone="muted">Proposed batch</Kicker>
      {proposals.map((p) => {
        const items = dimFocus ? p.items.filter((i) => i.dimId === dimFocus) : p.items;
        const orphan = unpaired.has(p.repo);
        return (
          <div key={p.repo} className="rounded-lg border border-divider bg-surface/40 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-xs text-slate-300" title={p.repo}>
                {p.repo}
              </span>
              {orphan ? (
                <span className="shrink-0 font-mono text-xs text-warn">not paired · skipped</span>
              ) : (
                <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">+{p.projectedPoints} projected</span>
              )}
            </div>
            {items.length === 0 ? (
              <p className="mt-2 font-mono text-xs text-slate-600">nothing open here</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {items.map((item) => (
                  <li key={item.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id={`batch-${item.id}`}
                      checked={!pruned.has(item.id)}
                      onChange={() => onTogglePrune(item.id)}
                      className="focus-ring mt-1 h-3 w-3 shrink-0 accent-[color:var(--color-accent)]"
                    />
                    <label htmlFor={`batch-${item.id}`} className="min-w-0 flex-1 cursor-pointer text-sm text-slate-300">
                      <span className={pruned.has(item.id) ? "text-slate-600 line-through" : ""}>{item.title}</span>
                      <span className="ml-2 inline-flex items-center gap-2 align-middle">
                        <span className="font-mono text-xs text-slate-500">{item.dimId}</span>
                        <ImpactEffort r={item} />
                        <Points n={item.projectedPoints} />
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
