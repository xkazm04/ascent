"use client";

// The detail body for a MINED practice — the adoption reading, the exemplar to learn from, the repos
// that could adopt it next, the reusable (leak-free) shape, and the systematic "apply to a repo"
// action. Extracted verbatim from the old Practice Library card so the SAME body renders inside the
// shared detail modal (layer 2) and the "Current" baseline card, with no behavior change.

import Link from "next/link";
import { Meter } from "@/components/org/shared/ui";
import { PracticeApply } from "@/components/org/plan/practices/PracticeApply";
import { scoreHex } from "@/lib/ui";
import type { OrgPractice } from "@/lib/db";

export function MinedPracticeDetail({ p, onPromote }: { p: OrgPractice; onPromote?: () => void }) {
  // `total` is the # of repos evaluated on this practice's dimension. When it's 0, show a "not yet
  // measured" state instead of a meaningless "0/0 · 0%" that reads as 0% adoption.
  const measured = p.total > 0;
  const adoptionPct = measured ? Math.round((p.strongCount / p.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
          {measured ? "Repos strong" : "Not yet measured"}
        </span>
        <span
          className="font-mono text-xl font-bold tabular-nums"
          style={{ color: measured ? scoreHex(adoptionPct) : undefined }}
        >
          {measured ? `${p.strongCount}/${p.total}` : "—"}
        </span>
      </div>
      {measured && <Meter size="sm" value={adoptionPct} color={scoreHex(adoptionPct)} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Exemplar + gaps */}
        <div className="space-y-3 text-base">
          <div>
            <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Learn from</span>
            {p.exemplar ? (
              <div className="mt-1">
                <Link
                  href={`/report?repo=${encodeURIComponent(p.exemplar.fullName)}`}
                  className="font-mono text-base text-white hover:text-accent"
                >
                  {p.exemplar.name}
                </Link>
                <span className="ml-2 font-mono text-sm" style={{ color: scoreHex(p.exemplar.score) }}>
                  {p.exemplar.score}/100
                </span>
              </div>
            ) : (
              <div className="mt-1 text-sm text-slate-500">No strong exemplar yet. This is greenfield for the org.</div>
            )}
          </div>
          <div>
            <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
              Could adopt next ({p.gapRepos.length})
            </span>
            {p.gapRepos.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {p.gapRepos.slice(0, 12).map((r) => (
                  <span key={r} className="rounded border border-orange-500/30 bg-orange-500/5 px-1.5 py-0.5 font-mono text-sm text-orange-200">
                    {r}
                  </span>
                ))}
                {p.gapRepos.length > 12 && <span className="font-mono text-sm text-slate-600">+{p.gapRepos.length - 12}</span>}
              </div>
            ) : (
              <div className="mt-1 text-sm text-slate-500">No clear gaps: well adopted across the fleet.</div>
            )}
          </div>
        </div>

        {/* Reusable shape (leak-free starter) */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-mono text-sm uppercase tracking-widest text-accent">Reusable shape</div>
            {/* G7-25: the hand-off to the org's OWN standards. A mined practice the fleet has proven
                out had no route into the playbook set — it had to be re-authored from scratch. This
                opens the author form pre-filled from the starter below, so promotion is a review, not
                a re-type. */}
            {onPromote && (
              <button
                onClick={onPromote}
                title="Open the playbook author form pre-filled from this practice"
                className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-2.5 py-1 text-sm font-medium text-white transition hover:bg-accent/20"
              >
                Save as playbook →
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-1 text-base text-slate-300">
            {p.starter.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="select-none text-slate-600">·</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Systematic apply: generate the starter + open a draft PR into a gap repo. */}
      <PracticeApply practiceId={p.id} gapRepos={p.gapRepoRefs} openPrs={p.openPrs} />
    </div>
  );
}
