// v2 masthead for the Overview: the org's standing is the one dominant element (a statement in display type),
// the two axes and the coverage sit beside it as figures, the maturity trend as its aside. Same badges, same
// honesty as the Altimeter strip: "—" is stated as no live score (never a 0), every delta carries its basis,
// an exclusion note rides beside the number it changed.
import { Caption, Masthead, Movement as MovementMark, Trend, type MastheadFigure } from "@/components/kit";
import type { TrendPoint } from "@/components/report/TrendChart";
import { levelForScore } from "@/lib/maturity/model";
import type { ScoreBadge } from "./OrgScoreBadges";

/** Status of a 0..100 score by its maturity level: L4 and up healthy, L3 watch, below that at risk. */
function toneOf(value: string | number): MastheadFigure["tone"] {
  if (typeof value !== "number") return undefined;
  const id = levelForScore(value).id;
  return id === "L4" || id === "L5" ? "good" : id === "L3" ? "watch" : "risk";
}

const COHORT_TITLE = "Cohort-matched movement: measured only over repositories scanned on both sides of the period";

function Movement({ b }: { b: ScoreBadge }) {
  return <MovementMark delta={b.delta} basis={b.deltaLabel} title={COHORT_TITLE} />;
}

function detailOf(b: ScoreBadge) {
  const parts = [
    <Movement key="m" b={b} />,
    b.note && <span key="n">{b.note}</span>,
    b.goal && (
      <span key="g">
        goal {b.goal.target} · {b.goal.label}
      </span>
    ),
  ].filter(Boolean);
  return parts.length ? <span className="flex flex-wrap gap-x-3">{parts}</span> : undefined;
}

export function StandingMasthead({
  slug,
  badges,
  trend,
}: {
  slug: string;
  badges: ScoreBadge[];
  trend: { points: TrendPoint[]; label: string };
}) {
  const [lead, ...rest] = badges;
  if (!lead) return null;
  const measured = typeof lead.value === "number";
  const [levelId, levelName] = (lead.sub ?? "").split(" · ");
  const figures: MastheadFigure[] = rest.map((b) => ({ label: b.label, value: b.value, tone: toneOf(b.value), title: b.title, detail: detailOf(b) }));
  return (
    <Masthead
      eyebrow="Standing"
      statement={measured ? `${slug} stands at` : `${slug} has no live score`}
      named={measured ? `${levelId} · ${lead.value}` : "yet"}
      lede={
        <>
          {measured && levelName ? `${levelName}. ` : ""}
          {lead.title}.
          {(lead.delta ?? 0) !== 0 && (
            <>
              {" "}
              <Movement b={lead} />
            </>
          )}
        </>
      }
      figures={figures}
      aside={
        trend.points.length >= 1 ? (
          <div className="flex flex-col gap-1">
            <Caption>Trend · {trend.label}</Caption>
            <Trend values={trend.points.map((p) => p.score)} label={trend.label} />
          </div>
        ) : undefined
      }
    />
  );
}
