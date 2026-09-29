// DimensionMark: the smallest naming of a dimension: its id in mono, in its hue, with a 4px block. For a table
// cell or a row where a whole DimensionLine (with a bar) is too much. Colour appears only because it names D<n>;
// it takes an id string ("D9") so callers do not parse. An unknown id renders the text in mute, never a hue.
import type { DimensionId } from "./DimensionLine";

export function parseDimension(id: string): DimensionId | null {
  const m = /^D([1-9])$/.exec(id.trim());
  return m ? (Number(m[1]) as DimensionId) : null;
}

export function DimensionMark({ id, label, className = "" }: { id: string; label?: string; className?: string }) {
  const n = parseDimension(id);
  const hue = n ? `var(--spec-${n}, var(--color-accent))` : undefined;
  return (
    <span data-kit="dimension-mark" data-dimension={n ?? undefined} data-role="dimension-mark" title={label} className={`inline-flex items-center gap-2 whitespace-nowrap font-mono type-mono-sm ${n ? "" : "text-slate-400"} ${className}`} style={hue ? { color: hue } : undefined}>
      <span aria-hidden className="h-3 w-1 rounded-[2px]" style={{ background: hue ?? "currentColor" }} />
      {id}
    </span>
  );
}
