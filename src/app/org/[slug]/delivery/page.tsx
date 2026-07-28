import { Card, ExportCsvLink, SectionEmpty, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
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
import { deliveryEmptyMessage, settle } from "@/components/org/delivery/deliveryLoad";

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
  const { barProps, segmentId, techGroupId, activeStack } = await resolveOrgScope(slug, sp);

  // G4-10: Promise.all rejects on the FIRST failing query, which discarded all four panels — a
  // transient DB blip on, say, the governance rollup used to blank the whole page, including the PR
  // signals and activity chart that would have rendered fine. Promise.allSettled isolates each query so
  // one failure degrades only its own panel. Each panel then gets an explicit "couldn't load" banner
  // below (never a silent empty state) — an empty state reads as "nothing to show," which is a
  // different, false claim when the real story is "the query errored."
  const [prSettled, govSettled, activitySettled, usageSettled] = await Promise.allSettled([
    getOrgPrSignals(slug, segmentId, techGroupId),
    getOrgGovernance(slug, segmentId, techGroupId),
    getOrgActivity(slug, segmentId, techGroupId),
    // Finding A: getOrgUsageRollup is WHOLE-ORG and takes no scope arg. Its measured layer is per-repo
    // (so buildAiDeliveryModel's per-repo lookups already honor the filtered set), but its ALLOCATED
    // layer is a single org-level total with no per-repo breakdown — it genuinely cannot be filtered.
    getOrgUsageRollup(slug),
  ]);
  const { value: pr, failed: prFailed } = settle(prSettled);
  const { value: gov, failed: govFailed } = settle(govSettled);
  const { value: activity, failed: activityFailed } = settle(activitySettled);
  const { value: usage, failed: usageFailed } = settle(usageSettled);
  // Surface the rejection server-side — a swallowed error here would be the exact "no signal that
  // anything went wrong" failure this fix exists to close, just moved from the page to the log.
  for (const [label, r] of [
    ["getOrgPrSignals", prSettled],
    ["getOrgGovernance", govSettled],
    ["getOrgActivity", activitySettled],
    ["getOrgUsageRollup", usageSettled],
  ] as const) {
    if (r.status === "rejected") console.error(`[delivery/${slug}] ${label} failed:`, r.reason);
  }

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
      {...barProps}
      className="flex flex-wrap items-center justify-end gap-2"
      gate={false}
    >
      <ExportCsvLink org={slug} kind="delivery" segmentId={segmentId} stack={activeStack?.key} />
    </ScopeFilterBar>
  );

  if (!pr && !gov && !activity) {
    // G4-10: distinguish "nothing to show" from "couldn't load it" — if any of the three queries
    // actually THREW (not just legitimately returned null for a token-less/unmatched-filter org), telling
    // the reader to go configure a GitHub token they may already have is actively wrong. A query error
    // gets its own honest copy and never the token-setup nudge. (deliveryEmptyMessage is pure/unit-tested.)
    const anyFailed = prFailed || govFailed || activityFailed;
    return (
      <div className="space-y-4">
        {segmentBar}
        <SectionEmpty>{deliveryEmptyMessage({ anyFailed, segmentId, techGroupId })}</SectionEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {segmentBar}

      {/* Fix first — the derived punch list; every priority links to the evidence below. */}
      {(pr || gov) && <DeliveryPriorities pr={pr} gov={gov} />}

      {/* G4-10: a panel whose query THREW gets its own honest "couldn't load" banner instead of just
          vanishing (the old Promise.all behavior blanked ALL FOUR panels on one rejection; the
          allSettled fix above isolates the failure, but a silently-omitted section would still read as
          "nothing here" — success theater by omission, not by false-positive copy). */}
      {prFailed && <SectionEmpty>Pull request signals couldn&apos;t load right now — try refreshing this page.</SectionEmpty>}
      {govFailed && <SectionEmpty>Branch governance couldn&apos;t load right now — try refreshing this page.</SectionEmpty>}
      {activityFailed && <SectionEmpty>Commit activity couldn&apos;t load right now — try refreshing this page.</SectionEmpty>}
      {usageFailed && pr && (
        <SectionEmpty>
          AI usage/spend data couldn&apos;t load right now — the AI delivery figures below (if shown) may be
          missing spend context. Try refreshing this page.
        </SectionEmpty>
      )}

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
