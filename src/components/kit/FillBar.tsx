// FillBar: a thin measured bar whose WIDTH is the value (0..100). In Prism the fill is paper unless the bar
// names a dimension, in which case the caller passes that hue; the track is a hairline wash. BarRow is the
// labelled line a person or a repo sits on: name, bar, readout. Server-safe.
import type { ReactNode } from "react";

const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);

export function FillBar({
  value,
  hue,
  label,
  className = "",
}: {
  value: number;
  /** A CSS colour (a dimension's hue). Omitted = the accent (paper in Prism). */
  hue?: string;
  /** Accessible name; the bar is an image of one number. Omit when the readout beside it says the same. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      data-kit="fill-bar"
      data-role="fill-bar"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`block h-1 rounded-[2px] bg-divider ${className}`}
    >
      <span data-role="fill-bar-fill" className="block h-full rounded-[2px] bg-accent" style={{ width: `${clamp(value)}%`, ...(hue ? { background: hue } : null) }} />
    </span>
  );
}

/** A name, a bar and a readout on one line. `name` is mono when it is an id or a login. */
export function BarRow({
  name,
  value,
  readout,
  label,
  title,
  mono = true,
  className = "",
}: {
  name: ReactNode;
  value: number;
  readout: ReactNode;
  label?: string;
  title?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <li data-kit="bar-row" data-role="bar-row" title={title} className={`grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-4 py-3 ${className}`}>
      <span className={`truncate type-caption text-white ${mono ? "font-mono" : ""}`}>{name}</span>
      <FillBar value={value} label={label} />
      <span className="type-caption tabular-nums text-slate-300">{readout}</span>
    </li>
  );
}
