import { Card, ExportCsvLink, OrgTable, SectionEmpty, SectionHeader, Tile, fmtHours } from "@/components/org/ui";
import { ScopeFilterBar } from "@/components/org/ScopeFilterBar";
import { getOrgActivity, getOrgGovernance, getOrgPrSignals } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

/** YYYY-MM-DD → "Mon D" (UTC, so a date-only string isn't shifted a day by the server's local zone). */
function fmtWeek(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function ActivityChart({ series, oldestWeekIso, latestWeekIso }: { series: number[]; oldestWeekIso: string; latestWeekIso: string }) {
  const max = Math.max(1, ...series);
  // The bars carry their magnitude only as fill height + a hover title — invisible to keyboard/SR users.
  // Give the chart a role="img" with a text summary so non-visual users get the series, not just the
  // heading. (The bar divs are decorative once the summary exists.)
  const total = series.reduce((a, b) => a + b, 0);
  const peak = Math.max(0, ...series);
  const ariaLabel = `Weekly fleet commit activity, week of ${fmtWeek(oldestWeekIso)} to week of ${fmtWeek(latestWeekIso)}: ${total.toLocaleString()} commits over ${series.length} week${series.length === 1 ? "" : "s"}, peak ${peak.toLocaleString()} in a week.`;
  return (
    <div>
      <div className="flex h-28 items-end gap-1" role="img" aria-label={ariaLabel}>
        {series.map((v, i) => (
          <div
            key={i}
            aria-hidden
            className="flex-1 rounded-t bg-accent/70 transition-all hover:bg-accent"
            style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
            title={`${v} commits`}
          />
        ))}
      </div>
      {/* The grid is anchored to the most recent scan and zero-fills gaps, so label the real week dates
          rather than "this week" (which can be weeks stale) / an off-by-one "{length} weeks ago". */}
      <div className="mt-2 flex justify-between font-mono text-sm uppercase tracking-widest text-slate-600">
        <span>wk of {fmtWeek(oldestWeekIso)}</span>
        <span>wk of {fmtWeek(latestWeekIso)}</span>
      </div>
    </div>
  );
}

export default async function OrgDelivery({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // Optional segment + tech-stack scope (bogus id/key → whole fleet) so a leader can read
  // delivery/governance for one business unit or stack; the two filters compose.
  const { barProps, segmentId, techGroupId } = await resolveOrgScope(slug, sp);

  const [pr, gov, activity] = await Promise.all([
    getOrgPrSignals(slug, segmentId, techGroupId),
    getOrgGovernance(slug, segmentId, techGroupId),
    getOrgActivity(slug, segmentId, techGroupId),
  ]);

  const segmentBar = (
    <ScopeFilterBar
      {...barProps}
      className="flex flex-wrap items-center justify-end gap-2"
      gate={false}
    >
      <ExportCsvLink org={slug} kind="delivery" segmentId={segmentId} />
    </ScopeFilterBar>
  );

  if (!pr && !gov && !activity) {
    return (
      <div className="space-y-4">
        {segmentBar}
        <SectionEmpty>
          {segmentId
            ? "No delivery signals for this segment — pick another segment or scan more of its repos (signals need a GitHub token)."
            : "Delivery signals (pull requests, branch governance, commit activity) need a GitHub token. Re-scan with a token configured to populate this tab."}
        </SectionEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {segmentBar}
      {/* Pull request signals */}
      {pr && (
        <div>
          <SectionHeader
            title="Pull request signals"
            description={`How systematically the fleet ships — ${pr.totalPrs} PRs across ${pr.repos} repos.`}
            right={
              pr.tools.length > 0 ? (
                <span className="flex flex-wrap items-center gap-1.5 font-mono text-sm text-slate-500">
                  tools:
                  {pr.tools.map((t) => (
                    <span key={t.name} className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300">
                      {t.name} {t.count}
                    </span>
                  ))}
                </span>
              ) : undefined
            }
          />
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Tile
              label="Review coverage"
              value={pr.avgReviewedRate == null ? "—" : `${pr.avgReviewedRate}%`}
              sub={pr.avgReviewedRate == null ? "no human-merged PRs" : undefined}
              color={pr.avgReviewedRate == null ? "#fff" : scoreHex(pr.avgReviewedRate)}
            />
            <Tile label="Merge rate" value={`${pr.avgMergeRate}%`} color={scoreHex(pr.avgMergeRate)} />
            <Tile label="Small PRs" value={`${pr.avgSmallPrRate}%`} color={scoreHex(pr.avgSmallPrRate)} />
            <Tile label="AI-involved PRs" value={`${pr.avgAiInvolvedRate}%`} color={scoreHex(pr.avgAiInvolvedRate)} />
            <Tile
              label="AI PRs reviewed"
              value={pr.avgAiGovernedRate == null ? "—" : `${pr.avgAiGovernedRate}%`}
              sub="governed AI"
              color={pr.avgAiGovernedRate == null ? "#fff" : scoreHex(pr.avgAiGovernedRate)}
            />
            <Tile label="Typical time-to-merge" value={fmtHours(pr.typicalHoursToMerge)} />
          </div>
        </div>
      )}

      {/* Branch governance */}
      {gov && (
        <div>
          <SectionHeader
            title="Branch governance"
            description={`Guardrails on the default branch — from branch protection & rulesets, across ${gov.repos} repos.`}
          />
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="Protect main" value={`${gov.protectedRate}%`} color={scoreHex(gov.protectedRate)} />
            <Tile label="Require review" value={`${gov.requireReviewRate}%`} color={scoreHex(gov.requireReviewRate)} />
            <Tile label="Require checks" value={`${gov.requireChecksRate}%`} color={scoreHex(gov.requireChecksRate)} />
            <Tile label="Signed commits" value={`${gov.signedRate}%`} color={scoreHex(gov.signedRate)} />
          </div>
          <OrgTable
            className="mt-3"
            caption="Delivery and governance metrics by repository"
            head={
              <tr>
                <th className="px-4 py-2 text-left">Repo</th>
                <th className="px-3 py-2 text-center">Protected</th>
                <th className="px-3 py-2 text-center">Reviews</th>
                <th className="px-3 py-2 text-center">Checks</th>
                <th className="px-3 py-2 text-center">Signed</th>
                <th className="px-3 py-2 text-right">Rules</th>
              </tr>
            }
          >
            {gov.perRepo.map((r) => {
                  const yes = (b: boolean) => (b ? <span className="text-lime-400">✓</span> : <span className="text-slate-600">—</span>);
                  return (
                    <tr key={r.fullName} className="text-slate-300">
                      <td className="px-4 py-2 font-mono text-sm text-white">
                        {r.name}
                        {!r.protected && (
                          <span className="ml-2 rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest text-orange-300">
                            unprotected
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">{yes(r.protected)}</td>
                      <td className="px-3 py-2 text-center font-mono text-sm">
                        {r.requiresPullRequest ? <span className="text-lime-400">{r.requiredApprovals > 0 ? `✓ ${r.requiredApprovals}` : "✓"}</span> : yes(false)}
                      </td>
                      <td className="px-3 py-2 text-center">{yes(r.requiresStatusChecks)}</td>
                      <td className="px-3 py-2 text-center">{yes(r.requiresSignatures)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{r.ruleCount}</td>
                    </tr>
                  );
                })}
          </OrgTable>
        </div>
      )}

      {/* Commit activity (real) */}
      {activity && (
        <Card>
          <SectionHeader
            size="sm"
            title="Commit activity"
            description={
              <>
                Weekly commits across the fleet (real, from GitHub) — {activity.total.toLocaleString()} commits over {activity.weeks} weeks{" "}
                <span className="font-mono text-sm text-slate-600">· {activity.repos} repo{activity.repos > 1 ? "s" : ""} reporting</span>
              </>
            }
          />
          <div className="mt-4">
            <ActivityChart series={activity.series} oldestWeekIso={activity.oldestWeekIso} latestWeekIso={activity.latestWeekIso} />
          </div>
        </Card>
      )}
    </div>
  );
}
