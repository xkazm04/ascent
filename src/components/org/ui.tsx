// Shared presentational primitives for the org dashboard tabs (server-safe, no client hooks).
import { EmptyState } from "@/components/EmptyState";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";

export const POSTURE_LABEL: Record<string, string> = {
  "ai-native": "AI-Native",
  ungoverned: "Fast & Ungoverned",
  manual: "Solid but Manual",
  early: "Getting Started",
};
export const POSTURE_ORDER = ["ai-native", "ungoverned", "manual", "early"];
// Heatmap / dimension-average columns, derived from the canonical dimension map (the same source
// that supplies the column labels) so adding a dimension — e.g. D9 Security — widens every fleet
// view automatically. Was frozen at D1–D8, which silently dropped D9 Security from the heatmap.
export const DIMS = Object.keys(DIMENSION_SHORT) as DimensionId[];

/** Canonical summary-tile grid — one column rhythm + gap for every tab's top tiles. */
export const TILE_GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-4";

export const fmtHours = (h: number | null) =>
  h == null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;

/** Color a positive/negative/flat delta on the dark canvas (lime up · orange down · slate flat). */
export const deltaHex = (d: number): string => (d > 0 ? "#84cc16" : d < 0 ? "#f97316" : "#94a3b8");

/** "+8" / "-5" / "0" — signed delta for inline text. */
export const signedDelta = (d: number): string => `${d > 0 ? "+" : ""}${d}`;

/** "▲+8" / "▼-5" / "→0" — signed, arrowed delta badge. */
export function fmtDelta(d: number): string {
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "→";
  return `${arrow}${signedDelta(d)}`;
}

export function Tile({
  label,
  value,
  sub,
  color,
  delta,
  deltaLabel,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  /** Period-over-period change, rendered as an arrowed badge under the value. null/undefined hides it. */
  delta?: number | null;
  /** Suffix next to the delta, e.g. "vs 90d ago". */
  deltaLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-3xl font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      {delta != null && (
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px]">
          <span style={{ color: deltaHex(delta) }}>{fmtDelta(delta)}</span>
          {deltaLabel && <span className="text-slate-500">{deltaLabel}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Card — the single source of truth for a fleet-view panel: one radius, border and
 * padding for every boxed section. Change the tokens here and every panel ripples.
 */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-800 bg-slate-900/40 p-6 ${className}`}>{children}</div>;
}

/**
 * Shared fleet-table chrome — one scroll wrapper, border radius, header styling, row dividers, and a
 * subtle row hover. Replaces four hand-rolled copies that had drifted on min-width. Pass the header
 * row via `head` and the body rows as children; `minWidth` keeps a wide table horizontally scrollable.
 */
export function OrgTable({
  head,
  children,
  minWidth = 640,
  className = "",
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto rounded-2xl border border-slate-800 ${className}`}>
      <table className="w-full text-sm" style={{ minWidth: `${minWidth}px` }}>
        <thead className="bg-slate-900/60 font-mono text-[10px] uppercase tracking-widest text-slate-500">{head}</thead>
        <tbody className="divide-y divide-slate-800 [&>tr]:transition-colors [&>tr:hover]:bg-slate-900/40">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/**
 * SectionHeader — a title with an optional description and right-aligned slot. `size="lg"`
 * is the standalone section heading; `size="sm"` is the in-card heading next to Tiles/Meters.
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
  const titleCls = size === "lg" ? "text-lg font-semibold text-white" : "text-sm font-semibold text-white";
  const heading = (
    <div>
      <h2 className={titleCls}>{title}</h2>
      {description != null && <p className={`mt-1 text-sm text-slate-400 ${descriptionClassName}`}>{description}</p>}
    </div>
  );
  if (right == null) return <div className={className}>{heading}</div>;
  return (
    <div className={`flex flex-wrap items-end justify-between gap-2 ${className}`}>
      {heading}
      {right}
    </div>
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
  // Section-scale empty — delegates to the canonical EmptyState so every empty state shares one
  // implementation. Keeps the {children}-as-body API so existing call sites stay unchanged.
  return <EmptyState variant="section" body={children} />;
}

/**
 * InlineEmpty — a single muted line for an in-card "no data yet" state, lighter than the dashed
 * EmptyState section variant. One treatment for the per-card empties scattered across the org
 * overview (movers, benchmark, gaps, outliers) so they stop drifting in spacing/markup.
 */
export function InlineEmpty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs text-slate-500">{children}</p>;
}

export function OrgEmpty({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  // Page-scale org empty — delegates to the canonical EmptyState (was a near-duplicate scaffold).
  return <EmptyState icon="🏔️" title={title} body={body} actions={[{ label: cta ?? "← Home", href: href ?? "/" }]} />;
}
