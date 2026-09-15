// The live preview: a repository card under the scene's scope root (Scene.tsx stamps the generated
// custom properties there) that references ROLE NAMES only (`var(--sx-surface)`, `var(--sx-space-row)`). Nothing
// below asks which theme, density or scale is active; every region of the scene rebinds part of this
// root and the card follows. The chart is the scripting-layer consumer: its row height is a number
// read from the same authority `scopeVars()` generated `--sx-row-h` from. No hooks, no "use client".

import type { CSSProperties } from "react";
import { chartSeries, PREVIEW_REPO } from "./fixtures";
import { DENSITY, type Density, type ThemeId } from "./tokens";

const v = (role: string) => `var(--sx-${role})`;

export function Preview({ theme, density }: { theme: ThemeId; density: Density }) {
  const series = chartSeries();
  const rowH = DENSITY[density]["row-h"]; // script layer: the authority, not a remembered 36
  const barW = 10;
  const gap = 4;
  const width = series.length * (barW + gap);
  return (
    <div
      data-preview
      data-theme={theme}
      className="rounded-xl border"
      style={
        {
          background: v("surface"),
          color: v("foreground"),
          borderColor: v("border"),
          padding: v("space-card"),
        } as CSSProperties
      }
    >
      <div className="flex flex-wrap items-center justify-between" style={{ gap: v("space-row"), minHeight: v("row-h") }}>
        <div>
          <p className="font-semibold" style={{ fontSize: v("type-body") }}>
            {PREVIEW_REPO.name}
          </p>
          <p data-muted style={{ fontSize: v("type-caption"), color: v("foreground-muted") }}>
            {PREVIEW_REPO.meta}
          </p>
        </div>
        <div className="flex items-center" style={{ gap: v("space-row") }}>
          <span className="font-mono tabular-nums" style={{ fontSize: v("type-figure") }}>
            {PREVIEW_REPO.score}
          </span>
          <span className="rounded-md px-2 font-mono" style={{ background: v("accent"), color: v("on-accent"), fontSize: v("type-caption"), lineHeight: v("row-h") }}>
            {PREVIEW_REPO.level}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between" style={{ gap: v("space-row") }}>
        <svg width={width} height={rowH} viewBox={`0 0 ${width} ${rowH}`} aria-label="Twelve fictional scan scores" role="img" data-row-h={rowH}>
          {series.map((s, i) => {
            const h = Math.max(2, Math.round((s / 100) * rowH));
            return <rect key={i} x={i * (barW + gap)} y={rowH - h} width={barW} height={h} rx={2} style={{ fill: i === series.length - 1 ? v("accent") : v("border") }} />;
          })}
        </svg>
        <button
          type="button"
          className="focus-ring rounded-md px-3 py-1 font-mono hover:scale-105"
          style={{
            background: v("accent"),
            color: v("on-accent"),
            fontSize: v("type-caption"),
            // The button never reads the preference: the ladder it references was rebound at the root.
            transition: `transform ${v("duration-fast")} ${v("ease-move")}`,
          }}
        >
          rescan
        </button>
      </div>
    </div>
  );
}
