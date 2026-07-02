// TeamAdoption — per-team AI commit share (CODEOWNERS attribution), with the one concrete move the
// numbers imply: pair the leading team with the lowest. An invitation to pair, never a directive.
// Server-safe.

import Link from "next/link";
import { Card, InlineEmpty, MeterRow, SectionHeader } from "@/components/org/ui";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { scoreHex } from "@/lib/ui";

const SHOW_LIMIT = 8;

export function TeamAdoption({
  teams,
  pairing,
  slug,
}: {
  teams: AdoptionOverview["teams"];
  pairing: AdoptionOverview["teamPairing"];
  slug: string;
}) {
  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Team adoption"
        description="AI commit share per CODEOWNERS team — where AI habits live, and where they haven't spread yet."
        right={
          <Link href={`/org/${slug}/teams`} className="shrink-0 font-mono text-xs uppercase tracking-widest text-slate-500 transition hover:text-accent">
            Teams →
          </Link>
        }
      />
      {teams.length === 0 ? (
        <InlineEmpty>
          No CODEOWNERS team attribution yet — add CODEOWNERS files to the fleet&apos;s repos and re-scan so adoption can roll up by team.
        </InlineEmpty>
      ) : (
        <>
          <div className="mt-3 space-y-1.5">
            {teams.slice(0, SHOW_LIMIT).map((t) => (
              <MeterRow
                key={t.slug}
                layout="labelled"
                label={t.name}
                labelClassName="w-36 shrink-0 truncate font-mono text-slate-200"
                value={t.aiCommitShare}
                display={`${t.aiCommitShare}% · ${t.aiContributors}/${t.contributors}`}
                color={scoreHex(t.aiCommitShare)}
                meterClassName="flex-1"
                valueClassName="w-28 shrink-0 text-right font-mono text-sm text-slate-400"
              />
            ))}
          </div>
          {teams.length > SHOW_LIMIT && (
            <p className="mt-2 font-mono text-sm text-slate-600">
              +{teams.length - SHOW_LIMIT} more team{teams.length - SHOW_LIMIT === 1 ? "" : "s"} on the Teams tab.
            </p>
          )}
          {pairing && (
            <p className="mt-4 border-l-2 border-accent pl-3 text-sm text-slate-400">
              <span className="font-mono text-xs uppercase tracking-widest text-accent">Suggested pairing</span>
              <br />
              <span className="text-slate-200">{pairing.leader.name}</span> ({pairing.leader.aiCommitShare}%) could mentor{" "}
              <span className="text-slate-200">{pairing.learner.name}</span> ({pairing.learner.aiCommitShare}%) — a {pairing.gap}-point gap in
              working AI patterns to spread team-to-team.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
