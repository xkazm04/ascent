// Shared markup for the async-ui-states regions. No hooks, no "use client": a Region is the
// `data-technique` boundary the frame spotlights; the ghost rows, the state chip and the readouts are
// the small pieces every panel shares.

import { Kicker } from "@/components/ui";
import { ghostAnimation, ghostWidth, type RegionState } from "./asyncState";

export function Region({ technique, title, note, children, className = "" }: { technique: string; title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section data-technique={technique} className={`rounded-xl border border-divider bg-ink p-4 ${className}`} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="type-body-sm font-semibold text-white">{title}</h3>
        <span className="type-caption text-slate-600">{technique}</span>
      </div>
      {note ? <p className="mb-3 type-caption text-slate-500">{note}</p> : null}
      {children}
    </section>
  );
}

export function Readout({ label, value, tone = "text-slate-200" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Kicker tone="muted" as="span">
        {label}
      </Kicker>
      <span className={`type-mono-sm tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

/**
 * The placeholder: geometry-matched ghost rows (the same row height and columns the content uses),
 * widths seeded by position, hidden from the accessibility tree, and INVISIBLE for the first 150ms in
 * both modes — a response inside the window never paints a pixel of it.
 */
export function GhostRows({ count, reduced, rowClass }: { count: number; reduced: boolean; rowClass: string }) {
  return (
    <ul aria-hidden data-ghost="true" style={{ animation: ghostAnimation(reduced) }} className="space-y-1">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={rowClass}>
          <span className="h-3 rounded bg-slate-800" style={{ width: `${ghostWidth(i, 0)}%` }} />
          <span className="h-3 w-10 rounded bg-slate-800/70" />
        </li>
      ))}
    </ul>
  );
}

const STATE_TONE: Record<RegionState, string> = {
  loading: "border-slate-700 text-slate-400",
  "settled-data": "border-success/50 text-success-soft",
  refreshing: "border-accent/50 text-accent-soft",
  superseded: "border-warn/50 text-warn",
  "settled-empty": "border-slate-700 text-slate-300",
  failed: "border-danger/50 text-danger",
};

/** The region's derived state as a mono chip — the one word every readout below agrees with. */
export function StateChip({ state }: { state: RegionState }) {
  return (
    <span data-state={state} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 type-caption ${STATE_TONE[state]}`}>
      {state === "refreshing" ? <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-accent" /> : null}
      {state}
    </span>
  );
}

export const ROW = "flex h-7 items-center justify-between gap-3 rounded-md border border-divider px-2";
export const BTN = "focus-ring rounded-md border border-slate-700 px-2 py-1 type-caption text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-40";
export const BTN_ON = "focus-ring rounded-md border border-accent bg-accent/10 px-2 py-1 type-caption text-accent-soft";
