// Shared markup for the table scene's regions. No hooks, no "use client": a Region is the
// `data-technique` boundary the frame spotlights; the readout, the button skins, the ghost body and the
// scene's keyframes are the small pieces the regions share.

import { Kicker } from "@/components/ui";
import { COLUMNS, ghostWidth } from "./ledger";

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

export const BTN = "focus-ring rounded-md border border-slate-700 px-2 py-1 type-caption text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-40";
export const BTN_ON = "focus-ring rounded-md border border-accent bg-accent/10 px-2 py-1 type-caption text-accent-soft";

/** The placeholder is invisible for its first 150ms in BOTH modes: the window is anti-flash, not decoration. */
export const GHOST_DELAY_MS = 150;
export const SCENE_KEYFRAMES = `
@keyframes ledger-ghost-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ledger-hold { from { opacity: 0; } to { opacity: 1; } }
@keyframes ledger-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
`;
export const ghostAnimation = (reduced: boolean): string => (reduced ? `ledger-hold 1ms linear ${GHOST_DELAY_MS}ms both` : `ledger-ghost-in 200ms ease-out ${GHOST_DELAY_MS}ms both`);
/** A row's entrance on its first appearance; tens of milliseconds of offset, count-capped. Reduced: a 1ms epsilon, never zero, so the `animationend` that marks the seen-set still fires. */
export const riseAnimation = (index: number, reduced: boolean): string => (reduced ? "ledger-hold 1ms linear both" : `ledger-rise 180ms cubic-bezier(0.16, 1, 0.3, 1) ${Math.min(index, 7) * 30}ms both`);

/**
 * Geometry-matched ghost rows UNDER the chrome: the real row height, the real column layout, widths
 * seeded by position so the block reads as rows of data rather than a barcode; hidden from AT.
 */
export function GhostRows({ count, reduced }: { count: number; reduced: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="h-9" aria-hidden data-ghost="true" style={{ animation: ghostAnimation(reduced) }}>
          {COLUMNS.map((c, j) => (
            <td key={c.id} className={`px-3 ${c.align === "right" ? "text-right" : ""}`}>
              <span className="inline-block h-3 rounded bg-slate-800" style={{ width: `${ghostWidth(i, j)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
