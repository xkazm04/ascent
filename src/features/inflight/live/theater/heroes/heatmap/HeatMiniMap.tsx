// A repo's map in miniature — module blocks only, for a star in the constellation whose lane is not
// on the big map. Same layout and the same heat as the big one (so a lane that just left the map
// still visibly cools here), drawn as SVG in a fixed viewBox that scales with the strip.

import { binaryTreemap, groupModules } from "./heatLayout";
import { fileTone } from "./heatStyle";
import type { RepoHeat } from "./heatTypes";

const W = 200;
const H = 64;
const HUE = { read: "var(--color-accent)", edit: "var(--color-warn)" } as const;

export function HeatMiniMap({ repo, now }: { repo: RepoHeat; now: number }) {
  const groups = groupModules(repo.files);
  const boxes = binaryTreemap(
    groups.map((g) => ({ key: g, weight: g.files.length + 1 })),
    { x: 0, y: 0, w: W, h: H },
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden data-minimap={repo.repo}>
      {boxes.map(({ key: g, rect }) => {
        let best: { kind: "read" | "edit"; h: number } = { kind: "read", h: 0 };
        for (const f of g.files) {
          const t = fileTone(f, now);
          if (t.h > best.h) best = t;
        }
        const edited = g.files.some((f) => f.edited);
        const hue = best.h > 0.05 ? HUE[best.kind] : edited ? HUE.edit : HUE.read;
        const pct = Math.round((edited ? 18 : 8) + 70 * best.h);
        return (
          <rect
            key={g.module || "/"}
            x={rect.x + 1}
            y={rect.y + 1}
            width={Math.max(0, rect.w - 2)}
            height={Math.max(0, rect.h - 2)}
            rx={2}
            style={{ fill: `color-mix(in oklab, ${hue} ${pct}%, var(--color-surface))`, stroke: "var(--color-divider)" }}
          />
        );
      })}
    </svg>
  );
}
