// The org "Standing" card (corpus percentile + regression badge) for the overview page. Extracted
// from app/org/[slug]/page.tsx to keep that page under the 300-LOC component limit. Server component.

import { Card, InlineEmpty, SectionHeader } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";
import type { OrgBenchmark } from "@/lib/db";

export function OrgStanding({
  benchmark,
  regressionCount,
  periodStart,
}: {
  benchmark: OrgBenchmark | null;
  regressionCount: number;
  periodStart: boolean;
}) {
  return (
    <Card>
      <SectionHeader size="sm" title="Standing" />
      <div className="mt-4 space-y-3 text-base">
        {benchmark && benchmark.overallPercentile != null ? (
          <div className="flex items-baseline justify-between">
            <span className="text-slate-300">vs the Ascent corpus</span>
            <span>
              <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(benchmark.overallPercentile) }}>
                {benchmark.overallPercentile}
              </span>
              <span className="ml-1 font-mono text-sm text-slate-500">pctile · {benchmark.corpusRepos} repos</span>
            </span>
          </div>
        ) : (
          <InlineEmpty>Benchmark fills in once other orgs are scanned.</InlineEmpty>
        )}
        {benchmark && (
          <div className="font-mono text-sm text-slate-500">
            corpus avg: overall {benchmark.corpusAvgOverall} · adopt {benchmark.corpusAvgAdoption} · rigor {benchmark.corpusAvgRigor}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          {regressionCount > 0 ? (
            <span className="rounded-full border border-orange-500/40 bg-orange-500/10 px-2.5 py-1 font-mono text-sm text-orange-300">
              ⚠ {regressionCount} repo{regressionCount > 1 ? "s" : ""} regressed {periodStart ? "this period" : "since last scan"}
            </span>
          ) : (
            <span className="rounded-full border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-400">no regressions</span>
          )}
        </div>
      </div>
    </Card>
  );
}
