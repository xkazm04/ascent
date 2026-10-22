// Strengths and weakest dimensions. Hue names the dimension. The L4 floor is a hatch, not a status color.
import { DimensionLine, Frame, parseDimension, SectionHead } from "@/components/kit";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import type { BriefingDim } from "@/lib/org/briefing";
import { practiceHref } from "./briefingShared";

const FLOOR = FOLLOW_UP_BELOW / 100;

function lines(rows: BriefingDim[], slug: string) {
  return rows.map((d) => {
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
        label={d.label}
        value={d.avg / 100}
        display={String(d.avg)}
        floor={FLOOR}
        href={practiceHref(slug, d.dimId)}
        wide
      />
    );
  });
}

export function executiveDims(strengths: BriefingDim[], risks: BriefingDim[], security: BriefingDim | null, slug: string) {
  const extra =
    security && risks.every((r) => r.dimId !== security.dimId) && strengths.every((s) => s.dimId !== security.dimId)
      ? [{ ...security, label: `${security.label} (security)` }]
      : [];
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <Frame>
        <SectionHead eyebrow="Standing" title="Strengths" named="in the fleet" />
        <div className="mt-4">{lines(strengths, slug)}</div>
      </Frame>
      <Frame>
        <SectionHead eyebrow="Standing" title="Weakest dimensions" named="to lift" />
        <div className="mt-4">{lines([...risks, ...extra], slug)}</div>
      </Frame>
    </div>
  );
}
