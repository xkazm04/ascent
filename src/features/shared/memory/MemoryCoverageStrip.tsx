// The memory-coverage header strip: how much of the fleet the shared memory actually covers, and
// which repos have gone quiet. Server-safe (no hooks) and co-located with the page it serves.
//
// It leads with the ABSENCE, because the list below can only ever show presence: a store can look
// busy and still be blind to most of the fleet. The denominator is every tracked repo, so the number
// is honest by construction (see src/lib/memory/coverage.ts).

import { Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import type { MemoryCoverage } from "@/lib/memory/coverage";

/** How many stale repos the strip names before falling back to a "+N more" count. */
const STALE_SHOWN = 5;

/** Red below a third covered, amber below two thirds, green above — the same at-a-glance banding the
 *  fleet tiles use. Full coverage of zero repos stays neutral rather than celebratory. */
function coverageColor(pct: number, total: number): string | undefined {
  if (total === 0) return undefined;
  if (pct >= 67) return "#34d399";
  if (pct >= 34) return "#fbbf24";
  return "#fb923c";
}

export function MemoryCoverageStrip({ coverage }: { coverage: MemoryCoverage }) {
  const { coveragePct, reposWithFreshMemory, totalTrackedRepos, staleRepos, windowDays } = coverage;
  const shown = staleRepos.slice(0, STALE_SHOWN);
  const more = staleRepos.length - shown.length;

  return (
    <section aria-label="Memory coverage">
      <div className={`${TILE_LEDGER} sm:grid-cols-3`}>
        <Tile
          label="Memory coverage"
          value={totalTrackedRepos === 0 ? "—" : `${coveragePct}%`}
          sub={`of tracked repos, last ${windowDays}d`}
          color={coverageColor(coveragePct, totalTrackedRepos)}
        />
        <Tile
          label="Repos with fresh memory"
          value={`${reposWithFreshMemory}/${totalTrackedRepos}`}
          sub={totalTrackedRepos === 0 ? "no repos tracked yet" : "≥1 active memory in window"}
        />
        <Tile
          label="Going quiet"
          value={staleRepos.length}
          sub={staleRepos.length === 0 ? "every repo is covered" : "no recent memory"}
          color={staleRepos.length > 0 ? "#fb923c" : undefined}
        />
      </div>

      {shown.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-xs text-slate-500">
          <span className="uppercase tracking-[0.2em]">stale</span>
          {shown.map((r) => (
            <span
              key={r.fullName}
              className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-slate-400"
              title={
                r.lastMemoryAt
                  ? `Newest memory ${r.lastMemoryAt.slice(0, 10)}, older than ${windowDays} days`
                  : "No memory has ever been recorded for this repo"
              }
            >
              {r.fullName}
              <span className="ml-1 text-slate-600">{r.lastMemoryAt ? r.lastMemoryAt.slice(0, 10) : "never"}</span>
            </span>
          ))}
          {more > 0 && <span className="text-slate-600">+{more} more</span>}
        </div>
      )}
    </section>
  );
}
