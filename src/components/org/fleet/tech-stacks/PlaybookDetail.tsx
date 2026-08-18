// The deepened transformation content for one move — shared by both combined variants. Renders the
// change-type tags, the ordered structural steps, the proposed Practices artifact (with a generate
// handoff), and the adoption checklist (with a "make it an owned goal in Plan" handoff). The
// tech-stacks module stops at proposing structure; the specifics live in Practices & Plan, which each
// block links to. Server-safe (links only). See transferPlaybook.ts for the generated content.

import Link from "next/link";
import { ChangeTag, CoverageChip } from "@/components/org/fleet/tech-stacks/analysisShared";
import { coverageOf, type DimInsight } from "@/components/org/fleet/tech-stacks/fleetAnalysis";
import type { AnalysisScope } from "@/components/org/fleet/tech-stacks/analysisScope";
import { buildPlaybook } from "@/components/org/fleet/tech-stacks/transferPlaybook";

function Handoff({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-mono text-xs text-accent transition hover:text-white">
      {children}
    </Link>
  );
}

export function PlaybookDetail({ org, d, scope }: { org: string; d: DimInsight; scope: AnalysisScope }) {
  const p = buildPlaybook(d);
  const cov = coverageOf(d);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {p.changeTypes.map((t) => (
            <ChangeTag key={t} type={t} />
          ))}
          <span className="text-sm text-slate-400">{p.summary}.</span>
        </div>
        <span className="flex shrink-0 items-center gap-3 font-mono text-xs text-slate-500">
          <CoverageChip d={d} nounPlural={scope.nounPlural} />
          <span>
            target{" "}
            <span className="tabular-nums text-slate-300">
              {d.laggard.value} → {p.target}
            </span>
          </span>
        </span>
      </div>
      {cov.level === "low" && (
        // The recommendation still stands and is still actionable — the reader just gets to weigh it
        // against how much of the fleet it was inferred from, instead of reading a minority pattern
        // as a fleet-wide one.
        <p className="text-sm text-warn">
          Weigh this plan accordingly: it is inferred from {cov.count} of {cov.of} scored {scope.nounPlural}, not the whole fleet.
        </p>
      )}

      <div>
        <div className="font-mono text-xs uppercase tracking-widest text-slate-500">Moves</div>
        <ol className="mt-1.5 space-y-1.5">
          {p.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-slate-300">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-divider font-mono text-xs text-slate-500">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-divider bg-surface/40 p-3">
          <div className="font-mono text-xs uppercase tracking-widest text-slate-500">Proposed artifact</div>
          <p className="mt-1 text-sm text-slate-200">
            {p.artifact.name} <span className="text-slate-500">· {p.artifact.kind}</span>
          </p>
          <p className="mt-1 text-sm text-slate-500">Generate a ready-to-adopt draft in Practices, scoped to {d.laggard.name}.</p>
          <div className="mt-2">
            <Handoff href={`/org/${org}/practices${scope.scopeQ(d.laggard.id)}`}>generate in Practices →</Handoff>
          </div>
        </div>

        <div className="rounded-xl border border-divider bg-surface/40 p-3">
          <div className="font-mono text-xs uppercase tracking-widest text-slate-500">Adoption checklist</div>
          <ul className="mt-1.5 space-y-1">
            {p.checklist.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <span aria-hidden className="mt-1.5 h-3 w-3 shrink-0 rounded-[3px] border border-slate-600" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {/* The gaps behind this playbook live in the Follow-ups ledger, where a batch becomes a
                fix prompt (initiatives and the Plan tab were retired 2026-08-17). */}
            <Handoff href={`/org/${org}?tab=followups&dim=${d.dimId}`}>work the {d.dimId} gaps in Follow-ups →</Handoff>
          </div>
        </div>
      </div>
    </div>
  );
}
