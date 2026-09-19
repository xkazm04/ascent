// The memory-coverage header strip: how much of the fleet the shared memory actually covers, and
// which repos have gone quiet. Server-safe (no hooks) and co-located with the page it serves.
//
// It leads with the ABSENCE, because the list below can only ever show presence: a store can look
// busy and still be blind to most of the fleet. The denominator is every tracked repo, so the number
// is honest by construction (see src/lib/memory/coverage.ts).
//
// And it leads with it GRAPHICALLY: `BudgetPack` draws covered-of-tracked as the fill and the
// uncovered repos as blocks BESIDE it, split by which kind of absence they are — a repo that went
// quiet (we have a last-memory date; that is a measurement) versus one that never recorded a memory
// at all (no observation ever, so a hatch, and a hatch prints no value). Three tiles below can state
// the numbers; only the bar puts the gap next to the coverage it is a gap in.

import { Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { BudgetPack, Legend, type Omission } from "@/components/org/viz";
import { LEVEL_HEX, scoreHex } from "@/lib/ui";
import type { MemoryCoverage } from "@/lib/memory/coverage";

/** How many stale repos the strip names before falling back to a "+N more" count. */
const STALE_SHOWN = 5;

/** The red→green level ramp, applied to a 0–100 percentage. Never a hand-picked hex (BRAND.md).
 *  Full coverage of zero repos stays neutral rather than celebratory. */
function coverageColor(pct: number, total: number): string | undefined {
  return total === 0 ? undefined : scoreHex(pct);
}

export function MemoryCoverageStrip({ coverage }: { coverage: MemoryCoverage }) {
  const { coveragePct, reposWithFreshMemory, totalTrackedRepos, staleRepos, windowDays } = coverage;
  const shown = staleRepos.slice(0, STALE_SHOWN);
  const more = staleRepos.length - shown.length;

  const wentQuiet = staleRepos.filter((r) => r.lastMemoryAt).length;
  const neverRecorded = staleRepos.length - wentQuiet;
  const omissions: Omission[] = [];
  if (wentQuiet > 0) {
    omissions.push({ id: "quiet", label: "went quiet", count: wentQuiet, state: "measured" });
  }
  if (neverRecorded > 0) {
    omissions.push({ id: "never", label: "never recorded", count: neverRecorded, state: "not-judged" });
  }

  return (
    <section aria-label="Memory coverage">
      {totalTrackedRepos > 0 && (
        <>
          <BudgetPack
            className="mb-3 max-w-md"
            label="Fleet memory coverage"
            used={reposWithFreshMemory}
            budget={totalTrackedRepos}
            unit=" repos"
            omissions={omissions}
          />
          {omissions.length > 0 && (
            <Legend className="mb-3" states={omissions.map((o) => o.state)} />
          )}
        </>
      )}

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
          color={staleRepos.length > 0 ? LEVEL_HEX.L2 : undefined}
        />
      </div>

      {shown.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 type-caption text-slate-500">
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
