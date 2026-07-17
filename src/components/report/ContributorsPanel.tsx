"use client";

// Report "Contributors" section — recent commit authors with AI-attribution share, plus PR signals.
// Extracted from ReportView so the orchestrator stays within the file-size budget. Only earns its
// nav item when the scan actually surfaced contributor or PR data (gated by the caller).

import type { ScanReport } from "@/lib/types";
import { PrSignalsPanel } from "@/components/report/PrSignalsPanel";
import { Surface } from "@/components/ui";

// Layout budget for the contributor list — sampled commit history rarely surfaces more than this,
// and a longer list would push the PR-signals panel below the fold. When it IS exceeded, the
// truncation is declared with a "+N more sampled" line instead of silently presenting the top
// rows as everyone (repo-report-shell-tabs #5).
const MAX_CONTRIBUTOR_ROWS = 8;

export function ContributorsPanel({ report }: { report: ScanReport }) {
  const contributors = report.contributors.filter((c) => c.login !== "unknown");
  return (
    <div className="space-y-8" data-testid="report-tab-contributors">
      {contributors.length > 0 && (
        <Surface radius="2xl" className="p-6">
          <h2 className="text-lg font-semibold text-white">Recent contributors</h2>
          <p className="mt-1 text-base text-slate-400">
            From sampled commit history — bar shows the share that&apos;s AI-attributed.
          </p>
          <div className="mt-3 space-y-2">
            {contributors.slice(0, MAX_CONTRIBUTOR_ROWS).map((c) => {
              const pctAI = c.commits ? Math.round((c.aiCommits / c.commits) * 100) : 0;
              return (
                <div key={c.login} className="flex items-center gap-3 text-base">
                  {/* `truncate` can clip a long login — `title` keeps the full name recoverable. */}
                  <span className="w-40 shrink-0 truncate text-slate-200" title={c.login}>
                    {c.login}
                  </span>
                  <div
                    className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800"
                    role="progressbar"
                    aria-valuenow={pctAI}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${c.login}: ${pctAI}% AI-attributed commits`}
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pctAI}%` }} />
                  </div>
                  <span className="w-32 shrink-0 text-right font-mono text-sm text-slate-500">
                    {c.aiCommits}/{c.commits} AI · {pctAI}%
                  </span>
                </div>
              );
            })}
          </div>
          {contributors.length > MAX_CONTRIBUTOR_ROWS && (
            <p className="mt-2 font-mono text-sm text-slate-500">
              +{contributors.length - MAX_CONTRIBUTOR_ROWS} more sampled
            </p>
          )}
        </Surface>
      )}

      {report.prStats && report.prStats.analyzed > 0 && <PrSignalsPanel stats={report.prStats} />}
    </div>
  );
}
