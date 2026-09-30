// Prism masthead. The fleet level is the statement. Headline figures stay paper; status is a glyph and a word.
import { Masthead, type MastheadFigure } from "@/components/kit";
import { benchmarkCaption, coverageLine, noScoreLine, scoreBasisLine } from "@/lib/org/briefing";
import type { OrgBranding } from "@/lib/db/branding";
import { ExecutiveTabActions } from "./ExecutiveTabActions";
import { PaperMovement, scoreTone } from "./executiveMarks";
import type { ExecutiveView } from "./executiveView";

export function executiveBrandStrip(branding: OrgBranding) {
  if (!branding.logoUrl && !branding.brandName) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {branding.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied remote logo; next/image needs a domain allowlist
        <img src={branding.logoUrl} alt="" className="h-6 w-6 object-contain" />
      )}
      {branding.brandName && <span className="type-body font-semibold text-white">{branding.brandName}</span>}
    </div>
  );
}

export function executiveMasthead(v: ExecutiveView) {
  const { briefing, period } = v;
  const scored = briefing.realScoredCount > 0;
  const m = briefing.maturity;
  const basis = scored ? scoreBasisLine(briefing) : noScoreLine(briefing);
  const lede = [period.title, coverageLine(briefing), basis].filter(Boolean).join(" · ");
  const maturity: MastheadFigure = {
    label: "Org maturity",
    value: scored ? m.overall : "not measured",
    tone: scored ? scoreTone(m.overall) : undefined,
    detail: scored && briefing.periodDelta ? <PaperMovement delta={briefing.periodDelta} basis={period.comparisonLabel} /> : undefined,
  };
  const figures: MastheadFigure[] = [
    maturity,
    { label: "AI adoption", value: scored ? m.adoption : "not measured", tone: scored ? scoreTone(m.adoption) : undefined },
    { label: "Engineering rigor", value: scored ? m.rigor : "not measured", tone: scored ? scoreTone(m.rigor) : undefined },
    {
      label: "Corpus percentile",
      value: briefing.benchmark?.percentile == null ? "not measured" : briefing.benchmark.percentile,
      detail: benchmarkCaption(briefing.benchmark),
    },
  ];
  return (
    <Masthead
      pattern="spectral"
      eyebrow="Executive briefing"
      statement={scored ? "The fleet stands at" : "No live score"}
      named={scored ? `${m.levelId} ${m.levelName}` : "this period"}
      lede={lede}
      figures={figures}
      aside={
        <ExecutiveTabActions
          slug={v.slug}
          period={period}
          segmentId={v.segmentId}
          techGroups={v.techGroups}
          activeStack={v.activeStack}
          canShare={v.canShare}
          md={v.md}
        />
      }
    />
  );
}
