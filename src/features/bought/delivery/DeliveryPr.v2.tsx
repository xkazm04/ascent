// Prism pull-request section. Hairline readings, paper figures. The coverage strip is omitted:
// it paints a status hue. The table keeps the same riskiest-first order.
import type { ReactNode } from "react";
import { Caption, Frame, HairlineGrid, SectionHead, StatTile } from "@/components/kit";
import { WhyChip } from "@/components/org/viz";
import type { OrgPrSignals } from "@/lib/db";
import type { FleetRateId } from "@/lib/db/org-signals";
import { BASIS_HINT, PRS_COLUMN_HINT, fleetBasisCopy, medianBasisCopy, prSectionBasisLine } from "./prBasis";
import { DeliveryIntegrityV2 } from "./DeliveryIntegrity.v2";
import { DeliveryPrTableV2 } from "./DeliveryPrTable.v2";
import { REVIEW_TARGET } from "./PrSignalsBand";
import { coverageTone, hoursLabel, pct, Unknown } from "./deliveryV2Marks";

function Reading({ label, value, sub, title }: { label: string; value: ReactNode; sub?: string; title?: string }) {
  return <StatTile label={<span title={title}>{label}</span>} value={value} sub={sub} />;
}

export function DeliveryPrV2({ pr }: { pr: OrgPrSignals }) {
  const basis = (id: FleetRateId) => fleetBasisCopy(id, pr.rateBasis?.[id]);
  const withFirst = pr.perRepo.filter((r) => r.medianHoursToFirstReview != null).length;
  const withMerge = pr.perRepo.filter((r) => r.medianHoursToMerge != null).length;
  const reviewed = basis("reviewed");
  const first = medianBasisCopy(withFirst, "hours to first review");
  const merge = basis("merge");
  const mergeHours = medianBasisCopy(withMerge, "hours to merge");
  const small = basis("smallPr");
  const revert = basis("revert");
  const ai = basis("aiInvolved");
  const governed = basis("aiGoverned");
  const trailer = basis("aiTrailer");
  const pre = basis("aiPreReviewed");
  const tools = pr.tools.length > 0 ? `Tools: ${pr.tools.map((t) => `${t.name} ${t.count}`).join(", ")}` : undefined;

  return (
    <>
      <Frame>
        <SectionHead
          eyebrow="Pull requests"
          title="Pull request signals"
          named={prSectionBasisLine(pr.totalPrs, pr.repos)}
          lede={<WhyChip hint={BASIS_HINT} label="what each rate is measured over" />}
          actions={tools ? <span className="text-slate-400">{tools}</span> : undefined}
        />
        <HairlineGrid className="mt-6 grid-cols-2 sm:grid-cols-5">
          <Reading label="Review coverage" title={reviewed?.full} sub={reviewed?.short ?? (pr.avgReviewedRate == null ? "no human merges" : `target ${REVIEW_TARGET}%`)} value={pct(pr.avgReviewedRate, coverageTone(pr.avgReviewedRate, REVIEW_TARGET))} />
          <Reading label="First review" title={first?.full} sub={first?.short ?? "no reviews sampled"} value={hoursLabel(pr.typicalHoursToFirstReview) ?? <Unknown label="not measured" />} />
          <Reading label="Merge rate" title={merge?.full} sub={merge?.short} value={pct(pr.avgMergeRate)} />
          <Reading label="Merge time" title={mergeHours?.full} sub={mergeHours?.short ?? "per-repo median"} value={hoursLabel(pr.typicalHoursToMerge) ?? <Unknown label="not measured" />} />
          <Reading label="Small PRs" title={small?.full} sub={small?.short ?? "200 lines or fewer"} value={pct(pr.avgSmallPrRate)} />
          <Reading label="Reverts" title={revert?.full} sub={revert?.short ?? (pr.avgRevertRate == null ? "not in these scans" : "lower is better")} value={pct(pr.avgRevertRate, pr.avgRevertRate != null && pr.avgRevertRate >= 5 ? "risk" : undefined)} />
          <Reading label="AI involved" title={ai?.full} sub={ai?.short ?? "of all PRs"} value={pct(pr.avgAiInvolvedRate)} />
          <Reading label="AI reviewed" title={governed?.full} sub={governed?.short ?? (pr.avgAiGovernedRate == null ? "small sample" : "governed AI")} value={pct(pr.avgAiGovernedRate, coverageTone(pr.avgAiGovernedRate, REVIEW_TARGET))} />
          <Reading label="AI trailers" title={trailer?.full} sub={trailer?.short ?? (pr.avgAiTrailerRate == null ? "not in these scans" : "of merged PRs")} value={pct(pr.avgAiTrailerRate)} />
          <Reading label="AI pre-review" title={pre?.full} sub={pre?.short ?? (pr.avgAiPreReviewedRate == null ? "not in these scans" : "before a human")} value={pct(pr.avgAiPreReviewedRate)} />
        </HairlineGrid>
      </Frame>
      <DeliveryIntegrityV2 pr={pr} />
      {pr.perRepo.length > 0 && (
        <Frame id="per-repo">
          <SectionHead
            eyebrow="Repositories"
            title="By repository"
            named="Riskiest first."
            lede={<WhyChip hint={PRS_COLUMN_HINT} label="the PRs column" align="start" />}
          />
          <Caption className="mt-3">Riskiest first: lowest review coverage, then slowest merges.</Caption>
          <div className="mt-4">
            <DeliveryPrTableV2 rows={pr.perRepo} />
          </div>
        </Frame>
      )}
    </>
  );
}
