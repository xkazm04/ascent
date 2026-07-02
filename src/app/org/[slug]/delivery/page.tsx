import { Card, ExportCsvLink, SectionEmpty, SectionHeader, Tile, fmtHours } from "@/components/org/ui";
import { ScopeFilterBar } from "@/components/org/ScopeFilterBar";
import { DeliveryPriorities } from "@/components/org/delivery/DeliveryPriorities";
import { PrRepoTable } from "@/components/org/delivery/PrRepoTable";
import { GovernanceTable } from "@/components/org/delivery/GovernanceTable";
import { DeliveryActivityChart } from "@/components/org/delivery/DeliveryActivityChart";
import { getOrgActivity, getOrgGovernance, getOrgPrSignals } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

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
  const { segments, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);

  const [pr, gov, activity] = await Promise.all([
    getOrgPrSignals(slug, segmentId, techGroupId),
    getOrgGovernance(slug, segmentId, techGroupId),
    getOrgActivity(slug, segmentId, techGroupId),
  ]);

  const segmentBar = (
    <ScopeFilterBar
      segments={segments}
      segmentId={segmentId}
      techGroups={techGroups}
      activeStack={activeStack}
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

      {/* Fix first — the derived punch list; every priority links to the evidence below. */}
      {(pr || gov) && <DeliveryPriorities pr={pr} gov={gov} />}

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
              sub={pr.avgReviewedRate == null ? "no human-merged PRs" : "target ≥80%"}
              color={pr.avgReviewedRate == null ? "#fff" : scoreHex(pr.avgReviewedRate)}
            />
            <Tile label="Merge rate" value={`${pr.avgMergeRate}%`} color={scoreHex(pr.avgMergeRate)} />
            <Tile label="Small PRs" value={`${pr.avgSmallPrRate}%`} sub="≤200 changed lines" color={scoreHex(pr.avgSmallPrRate)} />
            <Tile label="AI-involved PRs" value={`${pr.avgAiInvolvedRate}%`} color={scoreHex(pr.avgAiInvolvedRate)} />
            <Tile
              label="AI PRs reviewed"
              value={pr.avgAiGovernedRate == null ? "—" : `${pr.avgAiGovernedRate}%`}
              sub={pr.avgAiGovernedRate == null ? "sample too small" : "governed AI"}
              color={pr.avgAiGovernedRate == null ? "#fff" : scoreHex(pr.avgAiGovernedRate)}
            />
            <Tile label="Typical time-to-merge" value={fmtHours(pr.typicalHoursToMerge)} />
          </div>

          {/* The averages above are only readable with the spread behind them: who drags the mean. */}
          {pr.perRepo.length > 0 && (
            <div id="per-repo" className="mt-5 scroll-mt-24">
              <SectionHeader
                size="sm"
                title="By repository"
                description="Riskiest first — lowest review coverage, then slowest merges. Click a repo for its full report."
              />
              <div className="mt-3">
                <PrRepoTable rows={pr.perRepo} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Branch governance */}
      {gov && (
        <div id="governance" className="scroll-mt-24">
          <SectionHeader
            title="Branch governance"
            description={`Guardrails on the default branch — from branch protection & rulesets, across ${gov.repos} repos. Gaps first; the governed tail is folded.`}
          />
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="Protect main" value={`${gov.protectedRate}%`} color={scoreHex(gov.protectedRate)} />
            <Tile label="Require review" value={`${gov.requireReviewRate}%`} sub="≥1 approving review" color={scoreHex(gov.requireReviewRate)} />
            <Tile label="Require checks" value={`${gov.requireChecksRate}%`} color={scoreHex(gov.requireChecksRate)} />
            <Tile label="Signed commits" value={`${gov.signedRate}%`} color={scoreHex(gov.signedRate)} />
          </div>
          <div className="mt-3">
            <GovernanceTable gov={gov} />
          </div>
        </div>
      )}

      {/* Commit activity (real, from GitHub) */}
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
            <DeliveryActivityChart series={activity.series} endWeekStartMs={activity.endWeekStartMs} />
          </div>
        </Card>
      )}
    </div>
  );
}
