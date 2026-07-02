// The Teams tab's headline signals — the knowledge leader and the top cross-team pairing
// opportunities — as one compact two-column panel instead of two prose cards. Every team name
// deep-links to its row in the matrix below; framed as inputs/invitations, never rankings.
// Server-safe (no hooks).

import Link from "next/link";
import { Surface } from "@/components/ui";
import type { OrgTeamRollup } from "@/lib/db";
import { scoreHex } from "@/lib/ui";
import { teamAnchorId } from "@/components/org/teamsShared";

function TeamAnchor({ slug, label, className = "" }: { slug: string; label: string; className?: string }) {
  return (
    <a
      href={`#${teamAnchorId(slug)}`}
      title={`${slug} — jump to its row`}
      className={`focus-ring rounded font-mono text-white transition hover:text-accent ${className}`}
    >
      {label}
    </a>
  );
}

export function TeamsSignals({
  slug,
  leader,
  pairings,
}: {
  slug: string;
  leader: OrgTeamRollup["knowledgeLeader"];
  pairings: OrgTeamRollup["pairings"];
}) {
  if (!leader && pairings.length === 0) return null;
  return (
    <Surface className="mt-6">
      <div className="grid divide-y divide-divider md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="p-5">
          <div className="font-mono text-sm uppercase tracking-widest text-accent">🧠 Most institutional AI knowledge</div>
          {leader ? (
            <>
              <div className="mt-2 text-lg">
                <TeamAnchor slug={leader.slug} label={leader.slug} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm text-slate-400">
                <span>
                  <span style={{ color: scoreHex(leader.aiCommitShare) }}>{leader.aiCommitShare}%</span> AI-attributed commits
                </span>
                <span>
                  <span style={{ color: scoreHex(leader.avgAdoption) }}>{leader.avgAdoption}</span> adoption avg
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                A natural source of patterns others can borrow — an input, not a verdict.{" "}
                <Link href={`/org/${slug}/contributors`} className="focus-ring rounded text-accent transition hover:text-white">
                  See contributors →
                </Link>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              No AI-attributed activity yet — a leader appears once teams&apos; recent commits carry AI attribution.
            </p>
          )}
        </div>
        <div className="p-5">
          <div className="font-mono text-sm uppercase tracking-widest text-accent">🤝 Pairings to consider</div>
          {pairings.length > 0 ? (
            <>
              <ul className="mt-2 space-y-2">
                {pairings.map((p) => (
                  <li key={p.dimId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-300">{p.label}</span>
                    <TeamAnchor slug={p.mentorSlug} label={p.mentorName} className="text-sm" />
                    <span className="font-mono" style={{ color: scoreHex(p.mentorScore) }}>{p.mentorScore}</span>
                    <span aria-hidden className="text-slate-600">→</span>
                    <TeamAnchor slug={p.learnerSlug} label={p.learnerName} className="text-sm" />
                    <span className="font-mono" style={{ color: scoreHex(p.learnerScore) }}>{p.learnerScore}</span>
                    <span className="font-mono text-xs text-slate-500">{p.gap}-pt gap</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-slate-500">
                The biggest learnable gaps on a shared dimension — invitations to pair, never directives.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              No clear strong→weak gap between teams right now — a pairing appears when one team is strong (≥65) on a
              dimension where another sits below 50.
            </p>
          )}
        </div>
      </div>
    </Surface>
  );
}
