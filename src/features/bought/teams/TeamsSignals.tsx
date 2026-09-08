// The Teams tab's headline signals — who carries the most institutional AI knowledge, and the
// highest-leverage pairings to spread it. Two columns, both opening on a shape.
//
// The knowledge leader was two coloured numerals and a sentence; it is a `MatrixGrid` row now, the
// same instrument the Adoption tab plots teams with, so the two tabs read as one system. The
// pairings were "platform 78 → mobile 41 · 37-pt gap": a subtraction the reader had to perform, with
// no sense of where on the range either team sits. `TeamsPairingGap` draws the gap.
//
// The two framing sentences ("an input, not a verdict" / "invitations to pair, never directives")
// are load-bearing — they are what keeps this panel from reading as a leaderboard — so they are
// demoted to WhyChips on the headings rather than deleted (§2.1 D). The empty states keep their
// full copy: that is where a reader has nothing to look at and genuinely needs the argument (§2.1 O).

import Link from "next/link";
import { Surface } from "@/components/ui";
import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import type { OrgTeamRollup } from "@/lib/db";
import { orgTabHref } from "@/lib/org/orgTabs";
import { teamAnchorId } from "./teamsShared";
import { TeamsPairingGap } from "./TeamsPairingGap";

const LEADER_HINT =
  "An input, not a verdict: the team whose recent work is most AI-attributed and whose repos are most AI-native, as a natural source of patterns others can borrow. Withheld entirely for teams below the naming floor, because a headline about a two-person team names a person.";
const PAIRING_HINT =
  "Invitations to pair, never directives: the biggest learnable gap on a dimension where one team is strong (65 or above) and another sits below 50. Ascent has no view of either team's capacity to take one on.";

function TeamAnchor({ slug, label, className = "" }: { slug: string; label: string; className?: string }) {
  return (
    <a
      href={`#${teamAnchorId(slug)}`}
      title={`${slug}: jump to its row`}
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
          <div className="flex items-center gap-1.5 type-body-sm font-medium text-accent">
            🧠 Most institutional AI knowledge
            <WhyChip hint={LEADER_HINT} label="what the knowledge leader is" />
          </div>
          {leader ? (
            <>
              <MatrixGrid
                className="mt-3 max-w-xs"
                axes={["AI commits", "Adoption"]}
                rows={[
                  {
                    id: leader.slug,
                    label: leader.name,
                    cells: [
                      { state: "measured", score: leader.aiCommitShare },
                      { state: "measured", score: leader.avgAdoption },
                    ],
                  },
                ]}
                title="Knowledge leader"
              />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <TeamAnchor slug={leader.slug} label={leader.slug} className="type-mono-sm" />
                <Link href={orgTabHref(slug, "contributors")} className="focus-ring rounded type-mono-sm text-accent transition hover:text-white">
                  See contributors →
                </Link>
              </div>
            </>
          ) : (
            // (O) The reader has nothing to look at and a reason to act — the argument belongs here.
            <p className="mt-2 type-body-sm text-slate-500">
              No AI-attributed activity yet. A leader appears once teams&apos; recent commits carry AI attribution — the signal is
              read from commit trailers and PR co-authorship at scan time, so it fills in on the next scan after a team starts
              using an AI assistant that leaves one.
            </p>
          )}
        </div>
        <div className="p-5">
          <div className="flex items-center gap-1.5 type-body-sm font-medium text-accent">
            🤝 Pairings to consider
            <WhyChip hint={PAIRING_HINT} label="how a pairing is chosen" align="end" />
          </div>
          {pairings.length > 0 ? (
            <>
              <ul className="mt-3 space-y-2.5">
                {pairings.map((p) => (
                  <li key={p.dimId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="w-20 shrink-0 truncate type-caption text-slate-400" title={p.label}>
                      {p.label}
                    </span>
                    <TeamsPairingGap pairing={p} />
                    <span className="type-mono-sm text-slate-500">
                      <TeamAnchor slug={p.mentorSlug} label={p.mentorName} className="type-mono-sm" /> →{" "}
                      <TeamAnchor slug={p.learnerSlug} label={p.learnerName} className="type-mono-sm" /> · {p.gap} pts
                    </span>
                  </li>
                ))}
              </ul>
              <Legend
                className="mt-3"
                extra={[
                  {
                    id: "range",
                    label: "0–100 range",
                    swatch: (
                      <svg viewBox="0 0 14 14" width={14} height={14} className="shrink-0" role="img" aria-label="The track spans the full 0 to 100 score range">
                        <line x1={1} x2={13} y1={7} y2={7} stroke="var(--color-divider)" strokeWidth={1} />
                        <circle cx={4} cy={7} r={2.5} fill="var(--color-accent)" />
                        <circle cx={11} cy={7} r={2.5} fill="var(--color-accent-soft)" />
                      </svg>
                    ),
                    hint: "Each track is the full 0–100 score range, so the marks' positions say whether this is a strong team pulling a weak one up or two mid teams a few points apart.",
                  },
                ]}
              />
            </>
          ) : (
            // (O) Same rule: the criteria belong where there is nothing to draw.
            <p className="mt-2 type-body-sm text-slate-500">
              No clear strong→weak gap between teams right now. A pairing appears when one team is strong (≥65) on a
              dimension where another sits below 50.
            </p>
          )}
        </div>
      </div>
    </Surface>
  );
}
