// The trend chart's in-plot event marks (G5-18), relocated from TrendChart.tsx to keep that file
// within the 300-LOC limit. Hook-free: rendered inside the client TrendChart.

import type { TrendAnnotation } from "@/app/trends/annotations";
import { deployColor } from "@/app/trends/deployTone";

/**
 * Event markers (level crossings, regressions, rubric changes, deploys), positioned by matching the
 * annotation's `at` against each point's own `at`, NEVER by array index: the range toggle slices
 * `points` while the annotation list is derived from the full history. An annotation whose scan is
 * outside the visible slice simply doesn't render; it is never clamped to an edge, which would plant
 * a marker on a scan it doesn't describe.
 *
 * A deploy marker is its own mark: a toned glyph along the plot floor (red when a deployment in its
 * window failed), so it never stacks its chip on a score event's label at the top.
 */
export function TrendAnnotationMarks({
  marks,
  xFor,
  top,
  innerH,
}: {
  marks: { ann: TrendAnnotation; i: number }[];
  xFor: (i: number) => number;
  top: number;
  innerH: number;
}) {
  return (
    <>
      {marks.map(({ ann, i }) =>
        ann.kind === "deploy" ? (
          <g key={`deploy:${ann.scanId}`} data-deploy-marker={ann.scanId}>
            <text x={xFor(i)} y={top + innerH - 4} textAnchor="middle" fontSize={9} fill={deployColor(ann.deploys)}>
              ◆<title>{ann.detail}</title>
            </text>
          </g>
        ) : (
          <g key={`${ann.kind}:${ann.scanId}`}>
            <line
              x1={xFor(i)}
              x2={xFor(i)}
              y1={top}
              y2={top + innerH}
              stroke="var(--color-divider)"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
            <text x={xFor(i)} y={top - 5} textAnchor="middle" fontSize={8} className="fill-slate-500">
              {ann.label}
              <title>{ann.detail}</title>
            </text>
          </g>
        ),
      )}
    </>
  );
}
