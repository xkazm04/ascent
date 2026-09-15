// "What travels, and what is never read" — the house pattern's privacy guarantee, drawn.
//
// Two columns, three rows, and the third row is empty in both. That emptiness is the whole panel:
// a promise that an artifact's contents never travel is worth less than a picture in which the
// contents have nowhere to be.
//
// Server-safe: no hooks, no handlers (`MatrixGrid` and `WhyChip` carry their own client boundary).

import { Kicker } from "@/components/ui";
import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import {
  SHAPE_AXES,
  SHAPE_PRIVACY_HINT,
  SHAPE_PRIVACY_ROWS,
  SHAPE_PRIVACY_STATES,
  shapeScopeLine,
} from "./housePatternViz";

export function HousePatternPrivacy({ reposWithShape }: { reposWithShape: number }) {
  return (
    <div className="rounded-lg border border-divider bg-surface/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5">
          <Kicker tone="muted" as="span">
            what travels
          </Kicker>
          <WhyChip hint={SHAPE_PRIVACY_HINT} label="what travels" />
        </div>
        <span className="type-mono-sm text-slate-500">{shapeScopeLine(reposWithShape)}</span>
      </div>

      <div className="mt-3 max-w-xs">
        <MatrixGrid
          axes={[...SHAPE_AXES]}
          rows={SHAPE_PRIVACY_ROWS}
          title="What a mined shape reads, and what travels between your repositories"
        />
      </div>

      <Legend states={SHAPE_PRIVACY_STATES} className="mt-3" />
    </div>
  );
}
