// One move's transformation content, composition: the change types, the ordered moves, the proposed
// Practices artifact and the adoption checklist as ruled columns (no boxed cards). Same buildPlaybook content
// and the same handoffs as PlaybookDetail. Server-safe (links only).
import Link from "next/link";
import { Caption, Chip } from "@/components/kit";
import { coverageOf, type DimInsight } from "./fleetAnalysis";
import type { AnalysisScope } from "./analysisScope";
import { buildPlaybook } from "./transferPlaybook";
import { DimCoverage } from "./analysisSharedView";
import { buildUrl } from "@/lib/org/orgTabs";

function Handoff({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="focus-ring type-caption text-accent transition hover:text-white">
      {children}
    </Link>
  );
}

export function PlaybookDetail({ org, d, scope }: { org: string; d: DimInsight; scope: AnalysisScope }) {
  const p = buildPlaybook(d);
  const cov = coverageOf(d);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {p.changeTypes.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
          <span className="type-body-sm text-slate-300">{p.summary}.</span>
        </div>
        <span className="flex shrink-0 items-center gap-4 type-caption text-slate-400">
          <DimCoverage d={d} nounPlural={scope.nounPlural} />
          <span>
            target{" "}
            <span className="tabular-nums text-white">
              {d.laggard.value} → {p.target}
            </span>
          </span>
        </span>
      </div>
      {cov.level === "low" && (
        <p className="type-body-sm text-white">
          <span aria-hidden>! </span>
          Weigh this plan accordingly: it is inferred from {cov.count} of {cov.of} scored {scope.nounPlural}, not the whole fleet.
        </p>
      )}
      <div>
        <Caption>Moves</Caption>
        <ol className="mt-2 space-y-2">
          {p.steps.map((s, i) => (
            <li key={i} className="flex gap-3 type-body-sm text-slate-200">
              <span className="tabular-nums text-slate-400">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="grid gap-x-10 gap-y-5 border-t border-divider pt-4 sm:grid-cols-2">
        <div>
          <Caption>Proposed artifact</Caption>
          <p className="mt-1 type-body-sm text-white">
            {p.artifact.name} <span className="text-slate-400">· {p.artifact.kind}</span>
          </p>
          <p className="mt-1 type-body-sm text-slate-400">Generate a ready-to-adopt draft in Practices, scoped to {d.laggard.name}.</p>
          <div className="mt-2">
            <Handoff href={`/org/${org}/practices${scope.scopeQ(d.laggard.id)}`}>generate in Practices →</Handoff>
          </div>
        </div>
        <div>
          <Caption>Adoption checklist</Caption>
          <ul className="mt-2 space-y-1.5">
            {p.checklist.map((c, i) => (
              <li key={i} className="flex items-start gap-2 type-body-sm text-slate-200">
                <span aria-hidden className="mt-1.5 h-3 w-3 shrink-0 rounded-[2px] border border-slate-500" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <Handoff href={buildUrl(org, { tab: "proposals", dim: d.dimId }, "")}>work the {d.dimId} gaps in Proposals →</Handoff>
          </div>
        </div>
      </div>
    </div>
  );
}
