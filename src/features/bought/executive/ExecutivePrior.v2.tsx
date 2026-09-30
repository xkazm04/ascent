// Previous window. Overall, adoption and rigor are not dimensions: paper figures, movement in slate.
import { DimensionLine, Frame, parseDimension, SectionHead, StatStrip, StatTile } from "@/components/kit";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import type { ExecBriefing } from "@/lib/org/briefing";
import { dimensionName, PaperMovement } from "./executiveMarks";

type Prior = NonNullable<ExecBriefing["priorPeriod"]>;
type Now = { overall: number; adoption: number; rigor: number };

const FLOOR = FOLLOW_UP_BELOW / 100;

function headline(label: string, now: number, prior: number, delta: number) {
  return (
    <StatTile
      key={label}
      label={label}
      value={now}
      sub={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>from {prior}</span>
          {delta === 0 ? <span>0</span> : <PaperMovement delta={delta} />}
        </span>
      }
    />
  );
}

export function executivePrior(prior: Prior, now: Now) {
  const dims = prior.dims.filter((d) => d.delta !== 0);
  return (
    <Frame>
      <SectionHead eyebrow="Previous window" title="Vs previous period" />
      <StatStrip cols={3} className="mt-6">
        {headline("Overall", now.overall, prior.overall, prior.dOverall)}
        {headline("Adoption", now.adoption, prior.adoption, prior.dAdoption)}
        {headline("Rigor", now.rigor, prior.rigor, prior.dRigor)}
      </StatStrip>
      {dims.length > 0 && (
        <div className="mt-6">
          {dims.map((d) => {
            const dim = parseDimension(d.dimId);
            if (!dim) {
              return (
                <p key={d.dimId} className="type-body-sm text-slate-400">
                  {d.label}: not measured
                </p>
              );
            }
            return (
              <DimensionLine
                key={d.dimId}
                dimension={dim}
                label={d.label || dimensionName(d.dimId)}
                value={d.now / 100}
                display={String(d.now)}
                floor={FLOOR}
                wide
                detail={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span>from {d.prior}</span>
                    <PaperMovement delta={d.delta} />
                  </span>
                }
              />
            );
          })}
        </div>
      )}
    </Frame>
  );
}
