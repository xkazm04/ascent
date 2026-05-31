// Shared presentational primitives for the org dashboard tabs (server-safe, no client hooks).
import Link from "next/link";

export const POSTURE_LABEL: Record<string, string> = {
  "ai-native": "AI-Native",
  ungoverned: "Fast & Ungoverned",
  manual: "Solid but Manual",
  early: "Getting Started",
};
export const POSTURE_ORDER = ["ai-native", "ungoverned", "manual", "early"];
export const DIMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];

export const fmtHours = (h: number | null) =>
  h == null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;

export function Tile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-3xl font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
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
  return (
    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 p-10 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export function OrgEmpty({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <div className="text-4xl">🏔️</div>
      <h1 className="mt-4 text-2xl font-bold text-white">{title}</h1>
      <p className="mt-2 max-w-md text-slate-400">{body}</p>
      <Link
        href={href ?? "/"}
        className="mt-6 rounded-xl border border-slate-700 px-5 py-2.5 text-sm text-slate-300 hover:border-accent hover:text-white"
      >
        {cta ?? "← Home"}
      </Link>
    </div>
  );
}
