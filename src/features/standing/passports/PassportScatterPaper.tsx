"use client";

// Prism marks for the automation × production scatter. No band hue: a shape names the production
// band, and a placeholder stays the shared not-judged hatch. Altimeter keeps PassportScatter's circles.
import type { LegendExtra } from "@/components/org/viz";
import { stateFill, stateStroke, stateTitle } from "@/components/org/viz";
import { BAND_LABEL } from "@/lib/org/passport-display";
import { PLACEHOLDER_LABEL } from "./PlaceholderMark";
import type { ScatterPoint } from "./PassportScatter";

const GLYPH: Record<string, string> = {
  prototype: "△",
  internal: "◇",
  beta: "○",
  production: "●",
  hardened: "■",
};

export const PAPER_LEGEND: LegendExtra[] = (Object.keys(BAND_LABEL) as (keyof typeof BAND_LABEL)[]).map((b) => ({
  id: b,
  label: BAND_LABEL[b],
  swatch: <span aria-hidden className="inline-block w-3 text-center text-slate-300">{GLYPH[b]}</span>,
}));

function Shape({ band, cx, cy }: { band: string; cx: number; cy: number }) {
  if (band === "prototype") return <polygon points={`${cx},${cy - 6} ${cx - 5.5},${cy + 4} ${cx + 5.5},${cy + 4}`} />;
  if (band === "internal") return <polygon points={`${cx},${cy - 6} ${cx + 5},${cy} ${cx},${cy + 6} ${cx - 5},${cy}`} />;
  if (band === "beta") return <circle cx={cx} cy={cy} r={4.5} fill="none" stroke="currentColor" strokeWidth={1.25} />;
  if (band === "hardened") return <rect x={cx - 4.5} y={cy - 4.5} width={9} height={9} />;
  return <circle cx={cx} cy={cy} r={5} />;
}

export function PaperPoint({
  p,
  cx,
  cy,
  onPoint,
}: {
  p: ScatterPoint;
  cx: number;
  cy: number;
  onPoint?: (name: string) => void;
}) {
  const title = p.placeholder
    ? `${stateTitle("not-judged", p.name)} Automation ${p.x}, production ${p.y} (${p.band}) from a ${PLACEHOLDER_LABEL}.`
    : `${p.name}: automation ${p.x}, production ${p.y} (${p.band})${onPoint && !p.faded ? " · click to open in table" : ""}`;
  const click = onPoint && !p.faded ? () => onPoint(p.name) : undefined;
  const cls = `text-slate-200 transition-opacity duration-300 motion-reduce:transition-none${click ? " cursor-pointer" : ""}`;
  if (p.placeholder) {
    return (
      <circle
        data-state="not-judged"
        cx={cx}
        cy={cy}
        r={5}
        fill={stateFill("not-judged")}
        fillOpacity={1}
        opacity={p.faded ? 0.18 : 1}
        stroke={stateStroke("not-judged")}
        strokeWidth={1.25}
        className={cls}
        onClick={click}
      >
        <title>{title}</title>
      </circle>
    );
  }
  return (
    <g data-state="measured" fill="currentColor" opacity={p.faded ? 0.18 : 1} className={cls} onClick={click}>
      <Shape band={p.band} cx={cx} cy={cy} />
      <title>{title}</title>
    </g>
  );
}
