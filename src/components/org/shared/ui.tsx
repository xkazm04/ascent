// Shared presentational primitives for the org dashboard tabs (server-safe, no client hooks).
// These now route through the brand kit (@/components/ui) so the whole fleet view inherits the
// editorial identity from one place; the public API (Tile, Card, SectionHeader, …) is unchanged so
// every org page keeps working.
//
// Pure constants (POSTURE_LABEL, DIMS, TILE_LEDGER/TILE_GRID, fmtHours) live in uiConstants.ts;
// OrgEmpty + ExportCsvLink live in uiEmpty.tsx — both split out to keep this file under the 200-LOC
// cap (docs/ORG-TABS-REFACTOR.md). Both are re-exported below so every existing import of
// "@/components/org/shared/ui" keeps resolving unchanged.
import { EmptyState } from "@/components/EmptyState";
import { Surface, Stat, SectionHeading } from "@/components/ui";

// Re-exported from the brand kit so existing `@/components/org/ui` importers keep resolving them.
export { deltaHex, signedDelta, fmtDelta, DIRECTION_TONE } from "@/components/ui";

export { POSTURE_LABEL, POSTURE_ORDER, postureLabel, DIMS, TILE_LEDGER, TILE_GRID, fmtHours } from "./uiConstants";
export { OrgEmpty, ExportCsvLink } from "./uiEmpty";

/**
 * Summary tile — a brand Stat as a TILE_LEDGER cell (opaque bg so the ledger's 1px bed reads as
 * hairline rules between cells; the ledger frame supplies the border and radius). With `href` the
 * whole cell becomes a deep link to the stat's evidence section (e.g. "#unowned"); the anchor keeps
 * an OPAQUE hover fill so the ledger's divider bed never bleeds through the cell.
 */
export function Tile({
  label,
  value,
  sub,
  color,
  delta,
  deltaLabel,
  goal,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  /** Period-over-period change, rendered as an arrowed badge under the value. null/undefined hides it. */
  delta?: number | null;
  /** Suffix next to the delta, e.g. "vs 90d ago". */
  deltaLabel?: string;
  /** Active goal on this metric: target + a precomputed pace verdict (label + color). */
  goal?: { target: number; label: string; color: string };
  /** Deep link to the stat's evidence (anchor or route); makes the whole cell clickable. */
  href?: string;
}) {
  const stat = <Stat label={label} value={value} sub={sub} color={color} delta={delta} deltaLabel={deltaLabel} goal={goal} />;
  if (href) {
    return (
      <a href={href} className="focus-ring block bg-ink px-5 py-3.5 transition-colors hover:bg-slate-900">
        {stat}
      </a>
    );
  }
  return <div className="bg-ink px-5 py-3.5">{stat}</div>;
}

/**
 * Card — a fleet-view panel. Thin wrapper over the brand Surface so every boxed section shares one
 * radius/border/fill; `id` makes it a scroll anchor (deep-linking to a specific practice/section).
 */
export function Card({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <Surface id={id} className={`p-6 ${className}`}>
      {children}
    </Surface>
  );
}

/**
 * Shared fleet-table chrome — one scroll wrapper, hairline border, header styling, row dividers, and a
 * subtle row hover. Pass the header row via `head` and the body rows as children; `minWidth` keeps a
 * wide table horizontally scrollable.
 */
export function OrgTable({
  head,
  children,
  minWidth = 640,
  className = "",
  caption,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
  /** Accessible name for the table (rendered visually-hidden). */
  caption?: string;
}) {
  return (
    <div className={`overflow-x-auto rounded-2xl border border-divider ${className}`}>
      <table className="w-full text-base" style={{ minWidth: `${minWidth}px` }}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-surface/60 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{head}</thead>
        <tbody className="divide-y divide-divider [&>tr]:transition-colors [&>tr:hover]:bg-surface/40">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/**
 * SectionHeader — a title with an optional description and right-aligned slot, on the brand
 * SectionHeading. `size="lg"` is the standalone section heading; `size="sm"` is the in-card heading.
 */
export function SectionHeader({
  title,
  description,
  right,
  size = "lg",
  className = "",
  descriptionClassName = "",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  right?: React.ReactNode;
  size?: "lg" | "sm";
  className?: string;
  descriptionClassName?: string;
}) {
  return (
    <SectionHeading
      title={title}
      intro={description}
      right={right}
      size={size}
      className={className}
      introClassName={descriptionClassName}
    />
  );
}

// Meter + MeterRow live in the co-located uiMeters.tsx (extracted for the 300-LOC limit);
// re-exported here so every existing import site keeps resolving them unchanged.
export { Meter, MeterRow } from "./uiMeters";

export function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <EmptyState variant="section" body={children} />;
}

/**
 * InlineEmpty — a single muted line for an in-card "no data yet" state, lighter than the dashed
 * EmptyState section variant.
 */
export function InlineEmpty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-slate-500">{children}</p>;
}
