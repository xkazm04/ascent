// The Delivery tab's core data region — PR signals, branch governance, commit activity and the AI
// delivery ROI/governance read. Moved near-verbatim from the old page.tsx body (docs/ORG-TABS-REFACTOR.md);
// still one Promise.allSettled (G4-10: a failing query degrades only its own section, never the tab).
// The two heaviest client panels (AI delivery module, activity chart) are dynamic-imported via
// DeliveryTabChunks and wrapped in <Defer> so they commit a beat after everything above them.

import { Card, ExportCsvLink, SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { SnapshotScopeNotice } from "@/components/org/shared/SnapshotScopeNotice";
import { Defer } from "@/components/ui/Defer";
import { WhyChip } from "@/components/org/viz";
import { DeliveryPriorities } from "./DeliveryPriorities";
import { DeliveryPrSection } from "./DeliveryPrSection";
import { DeliveryGovernanceSection } from "./DeliveryGovernanceSection";
import { AiDeliveryModuleChunk, DeliveryActivityChartChunk } from "./DeliveryTabChunks";
import { buildAiDeliveryModel } from "./ai/aiDeliveryModel";
import { getOrgActivity, getOrgGovernance, getOrgPrSignals, getOrgUsageRollup } from "@/lib/db";
import { deliveryEmptyMessage, settle } from "./deliveryLoad";
import type { OrgScope } from "@/lib/org/scope";
import type { ResolvedWindow } from "@/lib/window";

export async function DeliveryCorePanel({
  slug,
  scope,
  // Passed down from DeliveryTab (which already resolved it for the trend) rather than re-resolved
  // here: this panel has no `sp`, so a local resolve would silently drop an explicit `?range=` and
  // name the cookie's period on a shared link. Used ONLY to name the window in the notice below —
  // DeliveryTab's header has documented since G7-09 that the trend is the tab's one windowed read
  // while everything in this panel comes off each repo's LATEST scan, and nothing on screen said so,
  // under a period control sitting right above.
  period,
}: {
  slug: string;
  scope: Promise<OrgScope>;
  period: ResolvedWindow;
}) {
  const { barProps, segmentId, techGroupId, activeStack } = await scope;

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
    <ScopeFilterBar {...barProps} className="flex flex-wrap items-center justify-end gap-2" gate={false}>
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

      <SnapshotScopeNotice
        period={period}
        subject="delivery"
        scope="partial"
        detail={
          <>
            The <span className="text-slate-200">trend</span>, unit economics and outcomes are period-scoped.
            Everything below this line is a <span className="text-slate-200">scan-time snapshot</span>.{" "}
            <WhyChip
              hint="Pull request signals, branch governance and commit activity are read off each repo's most recent scan. Scan.prStats is a pre-computed aggregate with no dated PR population to re-cut, so no range can re-scope it — read these as 'the fleet as of its most recent scans'."
              label="why this half is not period-scoped"
            />
          </>
        }
      />

      {/* Fix first — the derived punch list; every priority links to the evidence below. */}
      {(pr || gov) && <DeliveryPriorities pr={pr} gov={gov} />}

      {/* G4-10: a panel whose query THREW gets its own honest "couldn't load" banner instead of just
          vanishing (the old Promise.all behavior blanked ALL FOUR panels on one rejection; the
          allSettled fix above isolates the failure, but a silently-omitted section would still read as
          "nothing here" — success theater by omission, not by false-positive copy). */}
      {prFailed && <SectionEmpty>Pull request signals couldn&apos;t load right now. Try refreshing this page.</SectionEmpty>}
      {govFailed && <SectionEmpty>Branch governance couldn&apos;t load right now. Try refreshing this page.</SectionEmpty>}
      {activityFailed && <SectionEmpty>Commit activity couldn&apos;t load right now. Try refreshing this page.</SectionEmpty>}
      {usageFailed && pr && (
        <SectionEmpty>
          AI usage/spend data couldn&apos;t load right now. The AI delivery figures below (if shown) may be
          missing spend context. Try refreshing this page.
        </SectionEmpty>
      )}

      {/* AI delivery intelligence — spend × AI output × governance, as a Table and a Map view. Below
          the priorities/PR fold and independently fetched-and-computed, so it defers a beat. */}
      {aiModel && !withholdAllocatedRoi && (
        <Defer strategy="idle">
          <AiDeliveryModuleChunk model={aiModel} slug={slug} />
        </Defer>
      )}
      {/* Finding A: allocated-$ figures are org-wide and can't be split to a filtered scope — refuse to
          render them under a filter instead of showing a total inflated by (org total)/(subset). */}
      {aiModel && withholdAllocatedRoi && (
        <SectionEmpty>
          AI spend for this org is connected only as a whole-org total (allocated), which has no per-repo
          breakdown, so splitting it across a filtered segment/stack would inflate the dollar figures. Clear
          the filter to see AI delivery ROI, or connect per-repo telemetry for filterable spend.
        </SectionEmpty>
      )}

      {/* Pull request signals */}
      {pr && <DeliveryPrSection pr={pr} />}

      {/* Branch governance */}
      {gov && <DeliveryGovernanceSection gov={gov} />}

      {/* Commit activity (real, from GitHub) — below the fold, deferred until visible. */}
      {activity && (
        <Defer strategy="visible" placeholder={<div className="reveal-quiet min-h-[16rem]" aria-hidden />}>
          <Card>
            {/* §2.3 — unit and window only; the "real, from GitHub" provenance is the WhyChip. */}
            <SectionHeader
              size="sm"
              title={
                <span className="inline-flex items-center gap-2">
                  Commit activity
                  <WhyChip
                    hint="Weekly commit counts read from GitHub itself, not derived from a scan's aggregates — only the repositories that reported activity in the window contribute."
                    label="where commit activity comes from"
                  />
                </span>
              }
              description={`${activity.total.toLocaleString()} commits · ${activity.weeks} week${
                activity.weeks === 1 ? "" : "s"
              } · ${activity.repos} repo${activity.repos === 1 ? "" : "s"}`}
            />
            <div className="mt-4">
              <DeliveryActivityChartChunk series={activity.series} endWeekStartMs={activity.endWeekStartMs} />
            </div>
          </Card>
        </Defer>
      )}
    </div>
  );
}
