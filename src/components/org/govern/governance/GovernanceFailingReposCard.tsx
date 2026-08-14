// "Failing repos" card — worst-first list with the specific conditions each repo misses. Extracted
// from the old governance page.tsx JSX (docs/ORG-TABS-REFACTOR.md JSX-region split).

import Link from "next/link";
import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { scoreHex } from "@/lib/ui";
import type { GovernanceOverview } from "@/lib/org/governance";

export function GovernanceFailingReposCard({ slug, g }: { slug: string; g: GovernanceOverview }) {
  return (
    <Card>
      <SectionHeader size="sm" title="Failing repos" description="Worst first: the specific conditions each repo misses." />
      {g.failures.length === 0 ? (
        <InlineEmpty>No repos fail the gate. 🎉</InlineEmpty>
      ) : (
        <div className="mt-3 space-y-3">
          {g.failures.map((f) => (
            <div key={f.fullName} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-slate-200">{f.fullName}</span>
                <span className="font-mono text-xs text-slate-500">
                  {f.level} · overall <span style={{ color: scoreHex(f.overall) }}>{f.overall}</span>
                </span>
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {f.reasons.map((reason, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-400">
                    <span aria-hidden className="select-none text-red-400/70">✕</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {/* The headline "Failing" tile is the untruncated total (g.failing), but this list is capped
          server-side. Say so — otherwise the count and the list read as inconsistent ("where are the
          other repos?"). */}
      {g.failing > g.failures.length && (
        <p className="mt-3 font-mono text-sm text-slate-500">
          Showing the worst {g.failures.length} of {g.failing} failing repos. See the{" "}
          <Link href={orgTabHref(slug, "repositories")} className="text-accent hover:text-white">
            Repositories
          </Link>{" "}
          tab for the full list.
        </p>
      )}
    </Card>
  );
}
