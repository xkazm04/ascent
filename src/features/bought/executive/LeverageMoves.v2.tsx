// Widest shared gaps as dimension lines. A missing projection is not measured, never a zero-length bar.
import { DimensionLine, Eyebrow, Frame, GhostAction, Lede, parseDimension, SectionHead } from "@/components/kit";
import type { OrgRec } from "@/lib/db";
import { leverageBars, leverageMax, leverageReadout } from "./leverageMoves";

export function leverageMovesV2(recs: OrgRec[], slug: string) {
  const bars = leverageBars(recs);
  const max = leverageMax(bars);
  const top = recs[0];
  return (
    <Frame>
      <SectionHead
        eyebrow="Shared gaps"
        title="Widest shared gaps"
        named="across the fleet"
        lede="Current state, not limited to this period. Somewhere to look next, not an order."
      />
      <div className="mt-6">
        {bars.map((b) => {
          const dim = parseDimension(b.dimId);
          const unmeasured = b.fleetPoints == null || max <= 0;
          const lift = b.liftsRepos > 0 ? ` · crosses a level for ${b.liftsRepos}` : "";
          if (!dim) {
            return (
              <p key={b.id} className="type-body-sm text-slate-400">
                {b.title}: not measured
              </p>
            );
          }
          return (
            <DimensionLine
              key={b.id}
              dimension={dim}
              label={b.title}
              value={unmeasured || b.fleetPoints == null ? null : b.fleetPoints / max}
              display={unmeasured ? "not measured" : leverageReadout(b)}
              wide
              detail={`${b.reach}${lift}`}
            />
          );
        })}
      </div>
      {top && (top.rationale || top.explore[0]) && (
        <div className="mt-6">
          <Eyebrow>{top.title}</Eyebrow>
          {top.rationale && <Lede className="mt-2">{top.rationale}</Lede>}
          {top.explore[0] && <p className="mt-2 type-body-sm text-slate-400">{top.explore[0]}</p>}
        </div>
      )}
      <div className="mt-6">
        <GhostAction href={`/org/${slug}/repositories`}>Browse all repositories</GhostAction>
      </div>
    </Frame>
  );
}
