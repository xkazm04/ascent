"use client";

import type { InvestmentRank } from "@/lib/scoring/orgsim";

/** SIM-3: let the engine rank where to invest, instead of guessing the dimension. */
export function RankPanel({
  ranking,
  rankBusy,
  rankError,
  target,
  onSuggest,
  onLoadMove,
}: {
  ranking: InvestmentRank[] | null;
  rankBusy: boolean;
  rankError: string | null;
  target: number;
  onSuggest: () => void;
  onLoadMove: (r: InvestmentRank) => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm uppercase tracking-widest text-accent">Top moves by projected gain</span>
        <button
          onClick={onSuggest}
          disabled={rankBusy}
          className="rounded-lg border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
        >
          {rankBusy ? "Ranking…" : ranking ? "Refresh" : `Suggest (→ ${target})`}
        </button>
      </div>
      {rankError && <p className="mt-2 font-mono text-sm text-orange-300">{rankError}</p>}
      {ranking &&
        (ranking.length === 0 ? (
          <p className="mt-2 font-mono text-sm text-slate-500">No dimension moves the fleet average at this target/scope.</p>
        ) : (
          <ul className="mt-2 space-y-0.5">
            {ranking.map((r) => (
              <li key={r.dimId}>
                <button
                  onClick={() => onLoadMove(r)}
                  title={`Load ${r.dimId} → ${r.target} into the simulator`}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left font-mono text-sm text-slate-300 transition hover:bg-slate-900"
                >
                  <span className="truncate">
                    {r.dimId} · {r.name}
                  </span>
                  <span className="shrink-0 text-emerald-300">
                    +{r.gain} avg{r.promotions ? ` · ${r.promotions}↑` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
