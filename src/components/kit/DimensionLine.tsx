// DimensionLine: the labelled spectral line. Id (mono, hue) + name + a bar whose WIDTH is the value, hue =
// --spec-n. Colour never appears without naming a dimension. `value` is 0..1 (a weight or a normalised score);
// `display` is the text shown at the right (the caller formats it: "15%", "82"). A figure the surface did not
// measure passes `honesty` so the tag renders beside it.
import type { ReactNode } from "react";
import Link from "next/link";
import { HonestyTag, type HonestyKind } from "./Marks";

export type DimensionId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function DimensionLine({
  dimension,
  label,
  value,
  display,
  href,
  honesty,
  selected = false,
  floor,
  detail,
  wide = false,
  className = "",
}: {
  dimension: DimensionId;
  label: string;
  /** 0..1, clamped. The bar width. `null` = not measured: an empty track and the display text carries the reason. */
  value: number | null;
  display?: string;
  href?: string;
  honesty?: HonestyKind;
  selected?: boolean;
  /** 0..1: a reference mark on the track (e.g. the green floor). Drawn with `data-role="dimension-floor"`. */
  floor?: number;
  /** A second line under the row (reading, movement, named affordances). It may hold links, so a row with a
   *  `detail` is never itself a link: `href` is ignored when `detail` is given. */
  detail?: ReactNode;
  /** The bar is the dominant track (label column fixed, bar takes the rest): for a ledger of lines. */
  wide?: boolean;
  className?: string;
}) {
  const w = value === null ? 0 : Math.max(0, Math.min(1, value));
  const inner = (
    <>
      <span data-role="dimension-id" className="font-mono type-mono-sm" style={{ color: `var(--spec-${dimension}, var(--color-accent))` }}>
        D{dimension}
      </span>
      <span data-role="dimension-label" className="min-w-0 truncate type-body-sm text-slate-100">
        {label}
      </span>
      <span aria-hidden data-role="dimension-track" className="relative h-1 w-full min-w-16 rounded-[2px] bg-slate-800">
        <span
          data-role="dimension-bar"
          className="absolute inset-y-0 left-0 rounded-[2px]"
          style={{ width: `${w * 100}%`, background: `var(--spec-${dimension}, var(--color-accent))` }}
        />
        {floor != null && (
          <span
            data-role="dimension-floor"
            className="absolute -inset-y-1 w-px bg-slate-300/50"
            style={{ left: `${Math.max(0, Math.min(1, floor)) * 100}%` }}
          />
        )}
      </span>
      <span data-role="dimension-value" className="flex items-center gap-2 font-mono type-mono-sm tabular-nums text-slate-400">
        {display ?? (value === null ? "unmeasured" : `${Math.round(w * 100)}%`)}
        {honesty && <HonestyTag kind={honesty} />}
      </span>
    </>
  );
  const cols = wide ? "grid-cols-[2rem_minmax(6rem,11rem)_minmax(6rem,1fr)_auto]" : "grid-cols-[2rem_minmax(0,1fr)_minmax(4rem,7rem)_auto]";
  const cls = `grid ${cols} items-center gap-3 border-b border-divider py-3`;
  const attrs = { "data-kit": "dimension-line", "data-dimension": dimension, "data-selected": selected || undefined, "data-role": "dimension-line" } as const;
  if (detail != null) {
    return (
      <div className={`${cls} gap-y-1 ${className}`} {...attrs}>
        {inner}
        <div data-role="dimension-detail" className="col-span-full col-start-2 min-w-0 pb-1 type-caption text-slate-400">
          {detail}
        </div>
      </div>
    );
  }
  return href ? (
    <Link href={href} className={`${cls} focus-ring hover:bg-white/[0.03] ${className}`} aria-label={`${label}, dimension D${dimension}`} {...attrs}>
      {inner}
    </Link>
  ) : (
    <div className={`${cls} ${className}`} {...attrs}>
      {inner}
    </div>
  );
}
