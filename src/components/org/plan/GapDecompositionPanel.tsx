import Link from "next/link";
import { Card, InlineEmpty, SectionHeader, TILE_LEDGER } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import type { OrgGapAnalysis } from "@/lib/db";

// The headline cross-repo reading, and the one a lead has to make before spending anything: is a weak
// dimension an ORG problem (weak in ≥ half the fleet — fix it once as a practice, copying whoever
// already nails it) or a REPO problem (one repo lagging what the rest of the org already handles)?
// The two answers buy completely different work, so they render as two hairline-separated columns,
// never one merged list. Deliberately NOT a second practice list: `getOrgPractices`' gapRepos covers
// per-practice rollout; this panel only makes the org-vs-repo call.

const short = (dimId: string) => DIMENSION_SHORT[dimId as keyof typeof DIMENSION_SHORT] ?? dimId;

/** One column of the decomposition — its own eyebrow, count, and body, on an opaque ledger cell. */
function Column({ kicker, count, sub, children }: { kicker: string; count: number; sub: string; children: React.ReactNode }) {
  return (
    <div className="bg-ink p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Kicker tone={count > 0 ? "accent" : "muted"}>{kicker}</Kicker>
        <span className="font-mono text-sm tabular-nums text-slate-500">{count}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">{sub}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function GapDecompositionPanel({ slug, analysis }: { slug: string; analysis: OrgGapAnalysis | null }) {
  const header = (
    <SectionHeader
      size="sm"
      title="Org problem or repo problem?"
      description="Every weak dimension is one of two things, and they buy different work: a systemic gap the whole fleet shares (fix once, roll it out) or a single repo lagging what the org already handles (go fix that repo)."
      right={analysis ? <span className="font-mono text-sm tabular-nums text-slate-500">{analysis.scanned} scanned</span> : undefined}
    />
  );

  // No rollup at all (DB off, unknown org, or nothing scanned in this scope) — the page's other panels
  // already carry the "scan something" call to action, so stay quiet rather than shouting a second time.
  if (!analysis || analysis.scanned === 0) {
    return (
      <Card>
        {header}
        <InlineEmpty>No scanned repositories in this view yet — nothing to decompose.</InlineEmpty>
      </Card>
    );
  }

  // Population floor (GAP_MIN_REPOS): say so instead of classifying. A 2-repo fleet with one weak repo
  // clears the ≥ half-the-repos test and would be told it has a *systemic org gap* — the single most
  // expensive misread this panel could produce.
  if (analysis.scanned < analysis.minRepos) {
    return (
      <Card>
        {header}
        <InlineEmpty>
          Only {analysis.scanned} scanned repo{analysis.scanned === 1 ? "" : "s"} — too few to tell a fleet-wide pattern from a single
          repo being behind. Scan at least {analysis.minRepos} to get this reading.
        </InlineEmpty>
      </Card>
    );
  }

  const { commonGaps, repoSpecific } = analysis;
  const outlierRepos = new Set(repoSpecific.map((r) => r.fullName)).size;

  // The one-glance verdict. Deliberately a sentence, not a badge: the decision is comparative.
  const verdict =
    commonGaps.length === 0 && repoSpecific.length === 0
      ? "Neither — no dimension is weak across the fleet, and no repo lags the org enough to single out."
      : commonGaps.length > 0 && repoSpecific.length === 0
        ? `Org problem. ${commonGaps.length} dimension${commonGaps.length === 1 ? " is" : "s are"} weak across the fleet; no repo is the outlier.`
        : commonGaps.length === 0 && repoSpecific.length > 0
          ? `Repo problem. The fleet handles these dimensions — ${outlierRepos} repo${outlierRepos === 1 ? "" : "s"} lag${outlierRepos === 1 ? "s" : ""} behind it.`
          : `Both. ${commonGaps.length} systemic gap${commonGaps.length === 1 ? "" : "s"} to fix once, and ${outlierRepos} repo${outlierRepos === 1 ? "" : "s"} trailing the org on dimensions it otherwise handles.`;

  return (
    <Card>
      {header}
      <p className="mt-3 text-base text-slate-200">{verdict}</p>

      <div className={`mt-4 ${TILE_LEDGER} md:grid-cols-2`}>
        <Column
          kicker="Org problem · systemic"
          count={commonGaps.length}
          sub="Weak in at least half the scanned repos. Fix once as a practice; copy the exemplar."
        >
          {commonGaps.length === 0 ? (
            <p className="text-sm text-slate-500">No dimension is weak fleet-wide.</p>
          ) : (
            <ul className="space-y-2.5">
              {commonGaps.map((g) => (
                <li key={g.dimId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  {g.practiceId ? (
                    <Link
                      href={`/org/${slug}/practices#practice-${g.practiceId}`}
                      title={`See the ${short(g.dimId)} practice — the reusable shape that lifts this dimension`}
                      className="focus-ring rounded font-medium text-slate-200 transition hover:text-accent"
                    >
                      {g.dimId} · {g.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-200">
                      {g.dimId} · {g.label}
                    </span>
                  )}
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    weak in {g.weakCount}/{g.total} · avg{" "}
                    <span style={{ color: scoreHex(g.avg) }}>{g.avg}</span>
                  </span>
                  {g.exemplar && (
                    <Link
                      href={`/report/${g.exemplar.fullName}`}
                      title={`${g.exemplar.fullName} already scores ${g.exemplar.score} on ${short(g.dimId)} — copy from its report`}
                      className="focus-ring rounded font-mono text-xs tabular-nums text-slate-400 transition hover:text-accent"
                    >
                      copy {g.exemplar.name} ({g.exemplar.score}) →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Column>

        <Column
          kicker="Repo problem · outliers"
          count={repoSpecific.length}
          sub="A repo well below the org average on a dimension the org generally handles."
        >
          {repoSpecific.length === 0 ? (
            <p className="text-sm text-slate-500">No repo lags the fleet materially.</p>
          ) : (
            <ul className="space-y-2.5">
              {repoSpecific.map((r) => (
                <li key={`${r.fullName}:${r.dimId}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <Link
                    href={`/report/${r.fullName}`}
                    title={`Open ${r.fullName} — ${short(r.dimId)} is ${r.delta} below the org average`}
                    className="focus-ring rounded font-medium text-slate-200 transition hover:text-accent"
                  >
                    {r.name}
                  </Link>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {r.dimId} <span style={{ color: scoreHex(r.score) }}>{r.score}</span> vs org {r.orgAvg} ·{" "}
                    <span className="text-amber-300">−{r.delta}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Column>
      </div>
    </Card>
  );
}
