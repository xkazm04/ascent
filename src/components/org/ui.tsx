// Shared presentational primitives for the org dashboard tabs (server-safe, no client hooks).
// These now route through the brand kit (@/components/ui) so the whole fleet view inherits the
// editorial identity from one place; the public API (Tile, Card, SectionHeader, …) is unchanged so
// every org page keeps working.
import { EmptyState } from "@/components/EmptyState";
import { Surface, Stat, SectionHeading } from "@/components/ui";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";

// Re-exported from the brand kit so existing `@/components/org/ui` importers keep resolving them.
export { deltaHex, signedDelta, fmtDelta, DIRECTION_TONE, toneFor } from "@/components/ui";

export const POSTURE_LABEL: Record<string, string> = {
  "ai-native": "AI-Native",
  ungoverned: "Fast & Ungoverned",
  manual: "Solid but Manual",
  early: "Getting Started",
};
export const POSTURE_ORDER = ["ai-native", "ungoverned", "manual", "early"];

/**
 * POSTURE_LABEL lookup with a safe fallback for an unknown/legacy posture id (a new or renamed posture
 * the map doesn't cover yet). Renders a humanized form of the raw id ("ai-native" → "Ai Native")
 * rather than a blank cell or the raw slug, so a fleet table can never show an empty/garbled posture.
 */
export function postureLabel(posture: string | null | undefined): string {
  if (!posture) return "—";
  return POSTURE_LABEL[posture] ?? posture.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
// Heatmap / dimension-average columns, derived from the canonical dimension map (the same source
// that supplies the column labels) so adding a dimension — e.g. D9 Security — widens every fleet
// view automatically. Was frozen at D1–D8, which silently dropped D9 Security from the heatmap.
export const DIMS = Object.keys(DIMENSION_SHORT) as DimensionId[];

/** Canonical summary-tile grid — one column rhythm + gap for every tab's top tiles. */
export const TILE_GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-4";

export const fmtHours = (h: number | null) =>
  h == null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;

/** Summary tile — a brand Stat inside a hairline Surface. */
export function Tile({
  label,
  value,
  sub,
  color,
  delta,
  deltaLabel,
  goal,
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
}) {
  return (
    <Surface radius="xl" className="p-5">
      <Stat label={label} value={value} sub={sub} color={color} delta={delta} deltaLabel={deltaLabel} goal={goal} />
    </Surface>
  );
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

/**
 * Meter — the shared progress bar: one track radius/height, an optional threshold marker
 * and an animated fill width. Pass `color` for a custom fill (else the brand accent).
 */
export function Meter({
  value,
  color,
  threshold,
  size = "md",
  className = "",
}: {
  value: number;
  color?: string;
  threshold?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const h = size === "sm" ? "h-1.5" : "h-2";
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`relative ${h} overflow-hidden rounded-full bg-slate-800 ${className}`}>
      <div
        className={`animate-meter h-full rounded-full ${color ? "" : "bg-accent"}`}
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
      {threshold != null && (
        <div className="absolute inset-y-0 w-px bg-slate-500" style={{ left: `${threshold}%` }} />
      )}
    </div>
  );
}

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

export function OrgEmpty({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return <EmptyState icon="🏔️" title={title} body={body} actions={[{ label: cta ?? "← Home", href: href ?? "/" }]} />;
}
