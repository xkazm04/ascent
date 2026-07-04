// "Where the gaps live" section (common org gaps vs repo-specific outliers) for the overview page.
// Extracted from app/org/[slug]/page.tsx to keep that page under the 300-LOC component limit. Server
// component; the caller keeps the non-empty guard and passes a non-null gap analysis.

import Link from "next/link";
import { Card, InlineEmpty, SectionHeader } from "@/components/org/ui";
import type { OrgGapAnalysis } from "@/lib/db";

export function OrgGapsSection({ gaps, slug }: { gaps: OrgGapAnalysis; slug: string }) {
  return (
    <div>
      <SectionHeader
        title="Where the gaps live"
        description="Common across the org (fix once — reuse a practice) vs repo-specific (outliers lagging what the rest already handles)."
        right={<span className="font-mono text-sm uppercase tracking-widest text-slate-600">current state · not period-scoped</span>}
      />
      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        {/* Common organization gaps */}
        <Card>
          <h3 className="font-mono text-sm uppercase tracking-widest text-accent">Common organization gaps</h3>
          {gaps.commonGaps.length === 0 ? (
            <InlineEmpty>No fleet-wide gaps — strengths are broad.</InlineEmpty>
          ) : (
            <ul className="mt-3 space-y-2">
              {gaps.commonGaps.map((g) => (
                <li key={g.dimId} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base text-white">{g.label}</span>
                    <span className="font-mono text-sm text-orange-300">weak in {g.weakCount}/{g.total}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-slate-500">
                    <span>org avg {g.avg}</span>
                    {g.exemplar && (
                      <span>
                        {/* GA: the exemplar is the internal playbook — open its report to see HOW. */}
                        learn from{" "}
                        <Link
                          href={`/report/${g.exemplar.fullName}`}
                          title={`Open ${g.exemplar.fullName}'s report`}
                          className="focus-ring text-slate-300 transition hover:text-accent"
                        >
                          {g.exemplar.name}
                        </Link>{" "}
                        ({g.exemplar.score})
                      </span>
                    )}
                    {/* GA: deep-link to THIS gap's practice card, not the library index. */}
                    <Link
                      href={g.practiceId ? `/org/${slug}/practices#practice-${g.practiceId}` : `/org/${slug}/practices`}
                      className="focus-ring text-accent transition hover:text-white"
                    >
                      reuse a practice →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Repo-specific gaps */}
        <Card>
          <h3 className="font-mono text-sm uppercase tracking-widest text-slate-400">Repo-specific gaps</h3>
          {gaps.repoSpecific.length === 0 ? (
            <InlineEmpty>No notable outliers — repos move together.</InlineEmpty>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {gaps.repoSpecific.slice(0, 8).map((o, i) => (
                <li key={`${o.fullName}-${o.dimId}-${i}`} className="flex items-center justify-between gap-3 text-base">
                  <span className="min-w-0 truncate">
                    {/* Stored-report permalink (no re-scan) — /report?repo= starts the live scan flow. */}
                    <Link href={`/report/${o.fullName}`} className="focus-ring font-mono text-sm text-white transition hover:text-accent">
                      {o.name}
                    </Link>{" "}
                    <span className="text-slate-500">{o.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-sm text-slate-500">
                    {o.score} vs {o.orgAvg} org
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
