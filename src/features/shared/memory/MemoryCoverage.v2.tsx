// Prism coverage. The percentage of a tracked fleet is a real measurement and stays paper. A repo
// that never recorded a memory is not measured. An empty fleet has no percentage at all.
import { Caption, Chip, ChipRow, Frame, Ladder, SectionHead, StatStrip, StatTile, VoidMark } from "@/components/kit";
import type { MemoryCoverage } from "@/lib/memory/coverage";
import { coverageBands, staleWindow } from "./memoryView";

export function MemoryCoverageV2({ coverage }: { coverage: MemoryCoverage }) {
  const { coveragePct, reposWithFreshMemory, totalTrackedRepos, staleRepos, windowDays } = coverage;
  const split = staleWindow(staleRepos);

  return (
    <Frame aria-label="Memory coverage">
      <SectionHead
        eyebrow="Coverage"
        title="Fleet memory"
        named="coverage"
        lede={`Tracked repos with a memory in the last ${windowDays} days. A repo that never recorded one is not measured.`}
      />
      {totalTrackedRepos === 0 ? (
        <div className="mt-5">
          <VoidMark subject="Fleet memory coverage" label="Memory coverage, not measured" />
          <Caption className="mt-2">No repos tracked yet.</Caption>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <StatStrip cols={3}>
              <StatTile label="Memory coverage" value={`${coveragePct}%`} sub={`of tracked repos, last ${windowDays}d`} />
              <StatTile
                label="Repos with fresh memory"
                value={`${reposWithFreshMemory}/${totalTrackedRepos}`}
                sub="at least 1 active memory in window"
              />
              <StatTile
                label="Going quiet"
                value={staleRepos.length}
                sub={staleRepos.length === 0 ? "every repo is covered" : "no recent memory"}
              />
            </StatStrip>
          </div>
          <div className="mt-5">
            <Ladder
              label="Coverage bands"
              steps={coverageBands({
                fresh: reposWithFreshMemory,
                total: totalTrackedRepos,
                wentQuiet: split.wentQuiet,
                neverRecorded: split.neverRecorded,
              })}
            />
          </div>
          {split.shown.length > 0 && (
            <div className="mt-4">
              <Caption>Stale</Caption>
              <ChipRow>
                {split.shown.map((r) => (
                  <Chip
                    key={r.fullName}
                    tone="neutral"
                    title={
                      r.lastMemoryAt
                        ? `Newest memory ${r.lastMemoryAt.slice(0, 10)}, older than ${windowDays} days`
                        : "No memory has ever been recorded for this repo"
                    }
                  >
                    {r.fullName} <span>{r.lastMemoryAt ? r.lastMemoryAt.slice(0, 10) : "never"}</span>
                  </Chip>
                ))}
                {split.more > 0 && <Caption>+{split.more} more</Caption>}
              </ChipRow>
            </div>
          )}
        </>
      )}
    </Frame>
  );
}
