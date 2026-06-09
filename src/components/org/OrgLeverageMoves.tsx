// "Gaps to explore across the fleet" — highest-leverage org recommendations for the overview page.
// Extracted from app/org/[slug]/page.tsx to keep that page under the 300-LOC component limit. Server
// component; the caller keeps the non-empty guard and passes a non-empty list.

import Link from "next/link";
import { SectionHeader } from "@/components/org/ui";
import { DIMENSION_SHORT, IMPACT_CLASS } from "@/lib/ui";
import type { OrgRec } from "@/lib/db";

export function OrgLeverageMoves({ recs, slug }: { recs: OrgRec[]; slug: string }) {
  return (
    <div>
      <SectionHeader
        title="Gaps to explore across the fleet"
        description="Trust gaps ranked by how many repos they touch — inputs to explore and apply systematically, not a to-do list."
      />
      <div className="mt-3 space-y-2">
        {recs.map((rec, i) => (
          <div key={`${rec.dimId}-${rec.title}`} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 font-mono text-base text-slate-300">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-white">{rec.title}</span>
                <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
                  {DIMENSION_SHORT[rec.dimId as keyof typeof DIMENSION_SHORT] ?? rec.dimId}
                </span>
                <span className={`rounded border px-1.5 py-0.5 font-mono text-sm ${IMPACT_CLASS[rec.impact] ?? "border-slate-700 text-slate-400"}`}>
                  {rec.impact} impact
                </span>
              </div>
              <div className="mt-1.5 font-mono text-sm text-slate-500">
                affects {rec.repoCount} repo{rec.repoCount > 1 ? "s" : ""}: {rec.repos.slice(0, 6).join(", ")}
                {rec.repos.length > 6 ? ` +${rec.repos.length - 6}` : ""}
              </div>
            </div>
            <span className="shrink-0 font-mono text-sm text-slate-500" title="leverage = repos × impact × dimension weight">
              ⚡{rec.leverage}
            </span>
          </div>
        ))}
      </div>
      <Link href={`/org/${slug}/repositories`} className="mt-3 inline-block font-mono text-sm uppercase tracking-widest text-accent hover:text-white">
        Browse all repositories →
      </Link>
    </div>
  );
}
