// The widest shared gaps across the fleet — companion voice: somewhere to look next, never an order.
// The top card names the single most-shared gap with its engine-true projected maturity gain, why it
// matters for AI-driven development (rationale), and a question to explore; the ranked follow-ons list
// the next-widest gaps. Extracted from app/org/[slug]/executive/page.tsx to keep that page under the
// 300-LOC component limit. Server component; the caller passes a non-empty list.

import Link from "next/link";
import { SectionHeader } from "@/components/org/shared/ui";
import { dimShort, IMPACT_CLASS } from "@/lib/ui";
import type { OrgRec } from "@/lib/db";

/** Engine-true projected-gain phrase for the headline gap, or null when no affected repo had
 *  persisted dimension rows (so we never invent a number). */
function gainPhrase(rec: OrgRec): string | null {
  if (rec.projectedPoints == null) return null;
  const each = `≈ +${rec.projectedPoints} maturity pts on each of ${rec.repoCount} repo${rec.repoCount > 1 ? "s" : ""} if closed`;
  return rec.liftsRepos > 0 ? `${each} · would advance ${rec.liftsRepos} to the next level` : each;
}

function reach(rec: OrgRec): string {
  return `shared by ${rec.repoCount} repo${rec.repoCount > 1 ? "s" : ""}: ${rec.repos.slice(0, 6).join(", ")}${rec.repos.length > 6 ? ` +${rec.repos.length - 6}` : ""}`;
}

export function OrgLeverageMoves({ recs, slug }: { recs: OrgRec[]; slug: string }) {
  const [top, ...rest] = recs;
  return (
    <div>
      <SectionHeader
        title="The widest gap to explore across the fleet"
        description="The gap the most repositories share — ranked by reach × impact × dimension weight, with the engine-true maturity each repo stands to gain if the gap closes. Somewhere to look next, not an order."
        right={<span className="font-mono text-sm uppercase tracking-widest text-slate-600">current state · not period-scoped</span>}
      />
      {top && (
        <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent/20 px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-accent">Explore first</span>
            <span className="font-semibold text-white">{top.title}</span>
            <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
              {dimShort(top.dimId)}
            </span>
          </div>
          {gainPhrase(top) && <div className="mt-1.5 text-sm font-medium text-emerald-300">{gainPhrase(top)}</div>}
          {top.rationale && <p className="mt-1.5 text-sm text-slate-400">{top.rationale}</p>}
          {top.explore[0] && (
            <p className="mt-1.5 flex gap-2 text-sm text-slate-300">
              <span className="select-none text-accent" aria-hidden>?</span>
              <span>{top.explore[0]}</span>
            </p>
          )}
          <div className="mt-1.5 font-mono text-sm text-slate-500">{reach(top)}</div>
        </div>
      )}
      {rest.length > 0 && (
        <div className="mt-3 space-y-2">
          {rest.map((rec, i) => (
            <div key={`${rec.dimId}-${rec.title}`} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 font-mono text-base text-slate-300">{i + 2}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{rec.title}</span>
                  <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
                    {dimShort(rec.dimId)}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-sm ${IMPACT_CLASS[rec.impact] ?? "border-slate-700 text-slate-400"}`}>
                    {rec.impact} impact
                  </span>
                </div>
                <div className="mt-1.5 font-mono text-sm text-slate-500">
                  {rec.projectedPoints != null ? `≈ +${rec.projectedPoints} pts · ` : ""}
                  {reach(rec)}
                </div>
              </div>
              <span className="shrink-0 font-mono text-sm text-slate-500" title="leverage = repos × impact × dimension weight">
                ⚡{rec.leverage}
              </span>
            </div>
          ))}
        </div>
      )}
      <Link href={`/org/${slug}/repositories`} className="mt-3 inline-block font-mono text-sm uppercase tracking-widest text-accent hover:text-white">
        Browse all repositories →
      </Link>
    </div>
  );
}
