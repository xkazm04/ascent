import { Card, ExportCsvLink, SectionEmpty, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/ui";
import { ScopeFilterBar } from "@/components/org/ScopeFilterBar";
import { DeliveryPriorities } from "@/components/org/delivery/DeliveryPriorities";
import { PrSignalsBand } from "@/components/org/delivery/PrSignalsBand";
import { PrRepoTable } from "@/components/org/delivery/PrRepoTable";
import { GovernanceTable } from "@/components/org/delivery/GovernanceTable";
import { DeliveryActivityChart } from "@/components/org/delivery/DeliveryActivityChart";
import { AiDeliveryModule } from "@/components/org/delivery/ai/AiDeliveryModule";
import { buildAiDeliveryModel } from "@/components/org/delivery/ai/aiDeliveryModel";
import { getOrgActivity, getOrgGovernance, getOrgPrSignals, getOrgUsageRollup } from "@/lib/db";
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

  const [pr, gov, activity, usage] = await Promise.all([
    getOrgPrSignals(slug, segmentId, techGroupId),
    getOrgGovernance(slug, segmentId, techGroupId),
    getOrgActivity(slug, segmentId, techGroupId),
    // Finding A: getOrgUsageRollup is WHOLE-ORG and takes no scope arg. Its measured layer is per-repo
    // (so buildAiDeliveryModel's per-repo lookups already honor the filtered set), but its ALLOCATED
    // layer is a single org-level total with no per-repo breakdown — it genuinely cannot be filtered.
    getOrgUsageRollup(slug),
  ]);

  // AI delivery intelligence: join the real per-repo AI signals above with connected-provider usage
  // (measured/allocated), falling back to a simulated placeholder when nothing is connected. Computed
  // server-side; the client module toggles between the Table and Map views over this one model.
  const aiModel = buildAiDeliveryModel(pr, usage);

  // Finding A (money misattribution): in "allocated" fidelity buildAiDeliveryModel distributes the
  // WHOLE-ORG spend total across only the repos in `pr` (the filtered set) — weightSum shrinks with the
  // filter while the org-total numerator does not, so every $ readout (idle / ungoverned / $-per-AI-PR /
  // annual spend) inflates by (org total)/(filtered subset) under a segment or stack filter, driving
  // wrong "reclaim $X" budget calls. The org total has no per-repo breakdown and getOrgUsageRollup can't
  // be scoped, so rather than mis-attribute it we WITHHOLD the allocated-$ module under a filter and say
  // why. (measured is per-repo and simulated is a placeholder with no real money — both stay filterable.)
  const scoped = segmentId != null || techGroupId != null;
  const withholdAllocatedRoi = aiModel?.fidelity === "allocated" && scoped;

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
          {/* Finding #3: branch on the composed scope (segment OR stack), not `segmentId` alone — a
              stack filter that matched no repo also empties the view, and blaming "no GitHub token"
              sent the user to re-configure a token they already have instead of clearing the filter. */}
          {segmentId || techGroupId
            ? "No delivery signals for this filter — pick another segment/stack or scan more of its repos (signals need a GitHub token)."
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

      {/* AI delivery intelligence — spend × AI output × governance, as a Table and a Map view. */}
      {aiModel && !withholdAllocatedRoi && <AiDeliveryModule model={aiModel} slug={slug} />}
      {/* Finding A: allocated-$ figures are org-wide and can't be split to a filtered scope — refuse to
          render them under a filter instead of showing a total inflated by (org total)/(subset). */}
      {aiModel && withholdAllocatedRoi && (
        <SectionEmpty>
          AI spend for this org is connected only as a whole-org total (allocated), which has no per-repo
          breakdown — splitting it across a filtered segment/stack would inflate the dollar figures. Clear
          the filter to see AI delivery ROI, or connect per-repo telemetry for filterable spend.
        </SectionEmpty>
      )}

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
          <div className="mt-3">
            <PrSignalsBand pr={pr} />
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
          <div className={`mt-3 ${TILE_LEDGER} grid-cols-2 sm:grid-cols-4`}>
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
