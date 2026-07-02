// AdoptionSpectrum — the org's contributor population as ONE segmented bar (heavy / partial / none)
// instead of three number cards: the proportions are the story, and every segment ends in a follow-up
// (who to enable, which team leads). Server-safe.

import Link from "next/link";
import { Card, SectionHeader } from "@/components/org/ui";
import type { AdoptionOverview } from "@/lib/org/adoption";

export const BAND = { high: "#16a34a", some: "#3b9eff", none: "#64748b" } as const;

const SEGMENTS = [
  { key: "high", label: "heavy (≥50% AI)" },
  { key: "some", label: "partial (1–49%)" },
  { key: "none", label: "none (0%)" },
] as const;

export function AdoptionSpectrum({
  distribution,
  total,
  knowledgeLeader,
  slug,
  showEnablementLink,
}: {
  distribution: AdoptionOverview["distribution"];
  total: number;
  knowledgeLeader: AdoptionOverview["knowledgeLeader"];
  slug: string;
  /** True when the enablement panel below is rendered, so the "none" follow-up can deep-link to it. */
  showEnablementLink: boolean;
}) {
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const summary = SEGMENTS.map((s) => `${distribution[s.key]} ${s.label}`).join(", ");

  return (
    <Card>
      <SectionHeader size="sm" title="Adoption spread" description="Every contributor, by how much of their own recent work is AI-attributed." />

      <div
        role="img"
        aria-label={`Adoption spread across ${total} contributors: ${summary}`}
        className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-800"
      >
        {SEGMENTS.map((s) =>
          distribution[s.key] > 0 ? (
            <div
              key={s.key}
              title={`${distribution[s.key]} contributors — ${s.label}`}
              style={{ width: `${(distribution[s.key] / total) * 100}%`, backgroundColor: BAND[s.key] }}
            />
          ) : null,
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
        {SEGMENTS.map((s) => (
          <span key={s.key} className="flex items-center gap-2 font-mono text-sm text-slate-400">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: BAND[s.key] }} />
            <span className="font-bold tabular-nums text-slate-200">{distribution[s.key]}</span>
            {s.label}
            <span className="text-slate-600">{pct(distribution[s.key])}%</span>
          </span>
        ))}
      </div>

      {(distribution.none > 0 || knowledgeLeader) && (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-divider pt-3 font-mono text-sm text-slate-500">
          {distribution.none > 0 &&
            (showEnablementLink ? (
              <a href="#enablement" className="transition hover:text-accent">
                → {distribution.none} contributor{distribution.none === 1 ? " has" : "s have"} no AI-attributed commits — see who to enable next
              </a>
            ) : (
              <span>
                {distribution.none} contributor{distribution.none === 1 ? " has" : "s have"} no AI-attributed commits yet
              </span>
            ))}
          {knowledgeLeader && (
            <Link href={`/org/${slug}/teams`} className="transition hover:text-accent">
              → most AI-attributed team: <span className="text-slate-300">{knowledgeLeader.name}</span> · {knowledgeLeader.aiCommitShare}% — Teams
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
