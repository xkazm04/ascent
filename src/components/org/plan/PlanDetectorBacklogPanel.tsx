// Calibration: the LLM-as-auditor detector backlog — where the scan's LLM auditor suspects the
// deterministic detectors missed something. Its own <Suspense> boundary in PlanTab (getOrgDiscrepancies
// is an independent read from the tab's other panels).

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { getOrgDiscrepancies } from "@/lib/db";

export async function PlanDetectorBacklogPanel({ slug }: { slug: string }) {
  const discrepancies = await getOrgDiscrepancies(slug);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Detector backlog"
        description="Where the scan's LLM auditor suspects the deterministic detectors missed something: a prioritized list of calibration work."
      />
      {!discrepancies || discrepancies.total === 0 ? (
        <p className="mt-4 text-base text-slate-500">
          No flagged detector misses across {discrepancies?.scanned ?? 0} scanned repos; the auditor and the detectors agree.
        </p>
      ) : (
        <>
          <p className="mt-2 font-mono text-sm text-slate-500">
            {discrepancies.total} flags across {discrepancies.flaggedRepos}/{discrepancies.scanned} repos
          </p>
          <div className="mt-3 space-y-3">
            {discrepancies.groups.map((g) => (
              <div key={g.dimId} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-base font-medium text-white">
                    {g.dimId} · {g.label}
                  </div>
                  <span className="font-mono text-sm text-amber-300">
                    {g.count} flag{g.count === 1 ? "" : "s"} · {g.repos.length} repo{g.repos.length === 1 ? "" : "s"}
                  </span>
                </div>
                {g.examples.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-slate-400">
                    {g.examples.map((e, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="select-none text-slate-600">·</span>
                        <span>{e}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
